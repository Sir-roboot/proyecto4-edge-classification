# Módulo edge-app (P4-2.1): imagen consolidada del portal/backend en ECS
# Fargate detrás de un ALB público y una distribución CloudFront.
#
# App Runner se descartó: la cuenta 685538571046 devuelve
# `SubscriptionRequiredException` al ejecutar `aws apprunner list-services`, y
# AWS dejó de aceptar clientes nuevos el 2026-03-31. El diseño se reemplazó por
# ECS Fargate reutilizando el cluster existente (`module.compute.cluster_id`)
# más un ALB restringido al prefijo gestionado de CloudFront y protegido por el
# header secreto X-Origin-Verify (solo CloudFront pasa el ALB).
#
# Despliegue en dos pasos sin `-target`: ECR, secretos, roles y log group se
# crean siempre (`deploy_service = false`). Los recursos que no pueden existir
# sin una imagen publicada (ALB, target group, listener/rule, task definition,
# servicio ECS y CloudFront) se crean con `count` solo cuando
# `deploy_service = true`.

locals {
  name         = "edge-app-${var.environment}"
  deploy_count = var.deploy_service ? 1 : 0
}

# ── ECR privado ─────────────────────────────────────────────────────────────
# IMMUTABLE: un tag publicado no se puede sobreescribir — así un tag = un
# artefacto inmutable, y redesplegar exige un tag (SHA) nuevo.
resource "aws_ecr_repository" "this" {
  name                 = local.name
  image_tag_mutability = "IMMUTABLE"
  force_delete         = var.ecr_force_delete

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = merge(var.tags, {
    Environment = var.environment
  })
}

# Conserva como máximo las 10 imágenes más recientes y expira el resto.
resource "aws_ecr_lifecycle_policy" "this" {
  repository = aws_ecr_repository.this.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expira imágenes más allá de las 10 más recientes."
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

# ── Token de ingesta edge en Secrets Manager ────────────────────────────────
# 48 caracteres sin símbolos especiales (fáciles de romper en un shell del
# dispositivo). `recovery_window_in_days = 0` permite destruir/recrear el
# secreto sin ventana de espera (útil en dev/teardown).
resource "random_password" "ingest_token" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "ingest_token" {
  name                    = "${local.name}-ingest-token"
  recovery_window_in_days = 0

  tags = merge(var.tags, {
    Environment = var.environment
  })
}

resource "aws_secretsmanager_secret_version" "ingest_token" {
  secret_id     = aws_secretsmanager_secret.ingest_token.id
  secret_string = random_password.ingest_token.result
}

# ── Header secreto de origen (ALB ↔ CloudFront) ─────────────────────────────
# 40 caracteres sin símbolos especiales. Se inyecta como custom header de la
# distribución CloudFront y se exige en la listener rule del ALB: un cliente
# directo contra el DNS del ALB (sin este header) recibe 403.
resource "random_password" "origin_header" {
  length  = 40
  special = false
}

# ── Roles ECS ───────────────────────────────────────────────────────────────
data "aws_iam_policy_document" "ecs_tasks_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Execution role: la usa ECS (no el contenedor) para bajar la imagen de ECR,
# escribir logs y leer los secretos referenciados por la task definition.
resource "aws_iam_role" "execution" {
  name               = "${local.name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json

  tags = merge(var.tags, {
    Environment = var.environment
  })
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution" {
  statement {
    sid     = "ReadRequiredSecretsOnly"
    effect  = "Allow"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      aws_secretsmanager_secret.ingest_token.arn,
      var.rds_secret_arn,
    ]
  }
}

resource "aws_iam_role_policy" "execution" {
  name   = "${local.name}-execution"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution.json
}

# Task role: identidad del contenedor en ejecución (acceso a S3 de capturas).
resource "aws_iam_role" "task" {
  name               = "${local.name}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json

  tags = merge(var.tags, {
    Environment = var.environment
  })
}

# ListBucket va SIN condición pero solo sobre el ARN de ESTE bucket: el SDK
# necesita resolver el bucket (HeadBucket) antes de escribir objetos, y un
# ListBucket con condición de prefijo hace fallar ese HeadBucket. El bucket es
# privado y está vacío de datos ajenos. GetObject/PutObject/DeleteObject se
# limitan al prefijo donde el backend escribe: `edge-captures/*`.
data "aws_iam_policy_document" "task" {
  statement {
    sid       = "ListThisCaptureBucketOnly"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [var.capture_bucket_arn]
  }

  statement {
    sid    = "ReadWriteCaptureObjects"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["${var.capture_bucket_arn}/edge-captures/*"]
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "${local.name}-task"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}

# ── CloudWatch log group ────────────────────────────────────────────────────
resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${local.name}"
  retention_in_days = 14

  tags = merge(var.tags, {
    Environment = var.environment
  })
}

# ── Servicio (solo cuando deploy_service = true) ────────────────────────────
# Se crea con `count` para permitir el paso 1 sin imagen publicada.

data "aws_ec2_managed_prefix_list" "cloudfront_origin_facing" {
  count = local.deploy_count
  name  = "com.amazonaws.global.cloudfront.origin-facing"
}

data "aws_cloudfront_cache_policy" "caching_disabled" {
  count = local.deploy_count
  name  = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host_header" {
  count = local.deploy_count
  name  = "Managed-AllViewerExceptHostHeader"
}

# SG del ALB: ingress 80 solo desde el prefijo gestionado de CloudFront.
resource "aws_security_group" "alb" {
  count       = local.deploy_count
  name        = "${local.name}-alb"
  description = "Public ALB; ingress solo desde el prefijo gestionado de CloudFront."
  vpc_id      = var.vpc_id

  ingress {
    description     = "HTTP desde CloudFront (origin-facing)"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    prefix_list_ids = [data.aws_ec2_managed_prefix_list.cloudfront_origin_facing[0].id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, {
    Environment = var.environment
  })
}

# SG de la tarea: ingress 8080 solo desde el SG del ALB. La tarea tiene IP
# pública solo para arrancar sin NAT (bajar imagen de ECR y escribir logs sin
# requerir endpoints de interfaz); este SG impide cualquier ingreso directo.
resource "aws_security_group" "task" {
  count       = local.deploy_count
  name        = "${local.name}-task"
  description = "ECS task; ingress 8080 solo desde el SG del ALB."
  vpc_id      = var.vpc_id

  ingress {
    description     = "App desde el ALB"
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.alb[0].id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, {
    Environment = var.environment
  })
}

resource "aws_lb" "this" {
  count                      = local.deploy_count
  name                       = "${local.name}-alb"
  internal                   = false
  load_balancer_type         = "application"
  drop_invalid_header_fields = true
  security_groups            = [aws_security_group.alb[0].id]
  subnets                    = var.public_subnet_ids

  tags = merge(var.tags, {
    Environment = var.environment
  })
}

resource "aws_lb_target_group" "this" {
  count                = local.deploy_count
  name                 = "${local.name}-tg"
  port                 = 8080
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = var.vpc_id
  deregistration_delay = 30

  health_check {
    path                = "/api/health"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = merge(var.tags, {
    Environment = var.environment
  })
}


# Listener HTTP con respuesta por defecto 403: solo la rule con el header
# secreto reenvía al target group.
resource "aws_lb_listener" "http" {
  count             = local.deploy_count
  load_balancer_arn = aws_lb.this[0].arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden"
      status_code  = "403"
    }
  }
}

resource "aws_lb_listener_rule" "origin_verify" {
  count        = local.deploy_count
  listener_arn = aws_lb_listener.http[0].arn
  priority     = 1

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this[0].arn
  }

  condition {
    http_header {
      http_header_name = "X-Origin-Verify"
      values           = [random_password.origin_header.result]
    }
  }

  tags = merge(var.tags, {
    Environment = var.environment
  })
}

resource "aws_ecs_task_definition" "this" {
  count                    = local.deploy_count
  family                   = local.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "1024"
  memory                   = "2048"
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = local.name
      image     = "${aws_ecr_repository.this.repository_url}:${var.image_tag}"
      essential = true

      portMappings = [
        {
          containerPort = 8080
          hostPort      = 8080
          protocol      = "tcp"
        }
      ]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "DB_NAME", value = var.db_name },
        { name = "OBJECT_STORE_BUCKET", value = var.capture_bucket_name },
        { name = "OBJECT_STORE_REGION", value = var.aws_region },
        { name = "RUN_DB_SEED", value = "false" },
      ]

      secrets = [
        { name = "EDGE_INGEST_TOKEN", valueFrom = aws_secretsmanager_secret.ingest_token.arn },
        { name = "DATABASE_CREDENTIALS_JSON", valueFrom = var.rds_secret_arn },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.app.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "edge-app"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 20
      }
    }
  ])

  tags = merge(var.tags, {
    Environment = var.environment
  })
}

resource "aws_ecs_service" "this" {
  count                   = local.deploy_count
  name                    = local.name
  cluster                 = var.cluster_id
  task_definition         = aws_ecs_task_definition.this[0].arn
  desired_count           = 1
  launch_type             = "FARGATE"
  wait_for_steady_state   = true
  enable_ecs_managed_tags = true
  propagate_tags          = "TASK_DEFINITION"

  # El entrypoint espera RDS y aplica migraciones antes de iniciar nginx. El
  # grace period evita que el ALB reemplace una tarea sana durante ese arranque.
  health_check_grace_period_seconds = 180

  network_configuration {
    subnets          = var.public_subnet_ids
    security_groups  = [aws_security_group.task[0].id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.this[0].arn
    container_name   = local.name
    container_port   = 8080
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  tags = merge(var.tags, {
    Environment = var.environment
  })

  # Los roles deben tener sus políticas inline y el token debe existir antes de
  # que ECS arranque la tarea; el listener rule debe existir antes que CloudFront
  # (el origen del ALB responde 403 hasta que la rule con el header esté activa).
  depends_on = [
    aws_lb_listener_rule.origin_verify,
    aws_iam_role_policy.execution,
    aws_iam_role_policy.task,
    aws_secretsmanager_secret_version.ingest_token,
  ]
}

resource "aws_cloudfront_distribution" "this" {
  count       = local.deploy_count
  enabled     = true
  comment     = "edge-app ${var.environment}"
  price_class = "PriceClass_100"

  origin {
    domain_name = aws_lb.this[0].dns_name
    origin_id   = "alb"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }

    custom_header {
      name  = "X-Origin-Verify"
      value = random_password.origin_header.result
    }
  }

  default_cache_behavior {
    target_origin_id       = "alb"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    allowed_methods = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods  = ["GET", "HEAD"]

    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled[0].id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host_header[0].id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = merge(var.tags, {
    Environment = var.environment
  })

  depends_on = [aws_lb_listener_rule.origin_verify]
}
