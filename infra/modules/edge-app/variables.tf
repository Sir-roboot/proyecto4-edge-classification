variable "environment" {
  description = "Environment name (dev/prod), used for naming and tags."
  type        = string

  validation {
    condition     = length(trimspace(var.environment)) > 0
    error_message = "environment no puede estar vacío."
  }
}

variable "aws_region" {
  description = "Region the edge service lives in — used for OBJECT_STORE_REGION, logs and naming."
  type        = string
}

variable "deploy_service" {
  description = <<-EOT
    Si es false (default), el módulo solo crea los recursos que no dependen de
    una imagen publicada: ECR, secretos, roles ECS y log group. Con true se crea
    además el ALB, el target group, la task definition, el servicio ECS y la
    distribución CloudFront. Esto permite un despliegue en dos pasos sin usar
    `-target`.
  EOT
  type        = bool
  default     = false
}

variable "image_tag" {
  description = <<-EOT
    Tag de la imagen ECR (normalmente el SHA de Git) que el servicio ECS
    despliega. El repositorio es IMMUTABLE: un tag ya publicado no se puede
    sobreescribir. El default "bootstrap" permite validate/plan sin una imagen
    real; el apply del paso 2 siempre pasa el SHA.
  EOT
  type        = string
  default     = "bootstrap"

  validation {
    condition     = !var.deploy_service || can(regex("^[0-9a-f]{40}$", trimspace(var.image_tag)))
    error_message = "image_tag debe ser un SHA completo de Git (40 caracteres hexadecimales) cuando deploy_service = true."
  }
}

variable "cluster_id" {
  description = "ID del cluster ECS existente (module.compute.cluster_id) donde corre el servicio."
  type        = string
  default     = ""

  validation {
    condition     = !var.deploy_service || length(trimspace(var.cluster_id)) > 0
    error_message = "cluster_id no puede estar vacío cuando deploy_service = true."
  }
}

variable "vpc_id" {
  description = "VPC donde viven el ALB (subredes públicas) y las tareas."
  type        = string
}

variable "public_subnet_ids" {
  description = "Subredes públicas para el ALB y las tareas ECS (Fargate con IP pública para arrancar sin NAT)."
  type        = list(string)
  default     = []

  validation {
    condition     = !var.deploy_service || length(var.public_subnet_ids) >= 2
    error_message = "public_subnet_ids debe incluir al menos 2 subredes públicas (en AZs distintas) cuando deploy_service = true."
  }
}

variable "capture_bucket_name" {
  description = "Nombre del bucket S3 privado de capturas edge (metadata y objetos)."
  type        = string
}

variable "capture_bucket_arn" {
  description = "ARN del mismo bucket de capturas, para el IAM mínimo (ListBucket + objetos bajo edge-captures/*)."
  type        = string
}

variable "rds_secret_arn" {
  description = "ARN del secreto gestionado de RDS con las credenciales maestras (inyectado como DATABASE_CREDENTIALS_JSON)."
  type        = string
}

variable "db_name" {
  description = "Nombre de la base de datos dentro de RDS (variable DB_NAME del contenedor)."
  type        = string
  default     = "image_repo"
}

variable "ecr_force_delete" {
  description = "Si es true, permite borrar el repositorio ECR aunque contenga imágenes (útil en dev/teardown)."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Extra tags merged into every resource in this module."
  type        = map(string)
  default     = {}
}
