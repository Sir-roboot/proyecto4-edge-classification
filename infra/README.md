# Infrastructure (OPS-05 foundation, completed in OPS-08, extended in OPS-07)

Terraform for the dataset-quality pipeline's AWS infrastructure. Laid out as reusable modules under `modules/`, composed per environment under `environments/{dev,prod}`.

## Modules

| Module | What it is | Status |
|---|---|---|
| `network` | VPC across 2 AZs, public + private subnets, IGW, route tables, S3 VPC Gateway Endpoint (added in OPS-08, attached to the private route table — no NAT gateway needed for S3 traffic). | **Applied for real in dev** |
| `compute` | ECS Fargate cluster + task execution IAM role. No task definitions yet — those need an actual container image, which is out of OPS-08's scope (confirmed against issue #31 directly). | **Applied for real in dev** (cluster + role only, no running tasks) |
| `data` | RDS MariaDB in the private subnets. Master credentials are managed natively by RDS's Secrets Manager integration (`manage_master_user_password = true`) rather than a hand-rolled secret. | **Applied for real in dev** (`db.t4g.micro`, single-AZ) |
| `storage` | Generic private S3 bucket module (name/versioning/Object Lock as inputs — Object Lock added in OPS-08, opt-in and off by default). Instantiated for the real `dvc-cache-<env>-<account_id>` (versioned only) and `dataset-releases-<env>-<account_id>` (versioned + Object Lock — a working cache can't be WORM, a published release should be) buckets, plus `infra/bootstrap`'s state bucket. The environment is part of the bucket name — `dev`/`prod` currently share one AWS account, so without it both environments would compute the same global S3 name and the second `apply` would collide with the first (caught in OPS-08 PR review). | **Applied for real in dev and prod** (targeted `dvc_cache`/`dataset_releases` apply in prod, OPS-07), plus `infra/bootstrap`'s state bucket |
| `edge-app` | Módulo nuevo de P4-2.1: ECR privado + token/secret + roles ECS + log group, y (con `deploy_service`) ALB + target group + task definition + servicio ECS Fargate + CloudFront para la ingesta edge. Reemplazó el diseño App Runner + VPC Connector, descartado por `SubscriptionRequiredException` (ver P4-2.1 abajo). | **Validado** (`terraform validate`, `-backend=false`); apply pendiente de publicar la imagen |
| `github-oidc` | GitHub Actions → AWS trust via OIDC: an `aws_iam_openid_connect_provider` plus an `aws_iam_role` whose trust policy only accepts tokens whose `sub` claim matches this exact repo on an allowed branch. No static AWS keys anywhere. The role starts with **zero** attached permissions (`managed_policy_arns = []`) — `sts:GetCallerIdentity` needs none, and later tickets (OPS-06/07/08) add permissions incrementally as they're actually needed, instead of granting broad access upfront. | **Applied for real in dev** |

## What's actually deployed vs. what's just validated

**Los cinco módulos heredados están aplicados en `environments/dev`**; el
nuevo módulo `edge-app` de P4-2.1 todavía está solo validado. La infraestructura
heredada incluye la VPC/subredes/rutas/endpoint S3, el cluster ECS + task
execution role, RDS (`db.t4g.micro`, single-AZ), los buckets de DVC/releases y
el proveedor/rol OIDC. `infra/bootstrap` y el estado remoto también existen.
La última comprobación anterior a P4-2.1 mostró 31 recursos y un plan limpio;
la sección P4-2.1 documenta por separado qué recursos nuevos siguen pendientes.

The bucket names above are environment-qualified (`-dev-`/`-prod-`) precisely because `dev` and `prod` share one AWS account for now: without the environment segment both environments' `storage` module calls would compute the identical global S3 bucket name, and applying the second environment would fail trying to create a bucket the first environment's state already owns. This was caught in OPS-08 PR review and fixed before `prod` was ever applied — `dev`'s buckets were renamed (`terraform apply` destroys and recreates them under the new name; safe here since nothing had been pushed into them yet, DVC's DEV remote is still MinIO).

Wiring DVC to these buckets, giving the OIDC role S3 permissions, and the DEV/PROD content-hash comparison were deliberately left out of OPS-08 — that's [OPS-07](https://github.com/White-eclipse1/Proyecto-02-dataset-Quality/issues/30)'s explicit scope, and it's what the section below covers.

`prod` assumes a separate AWS account eventually, which is why it has its own `github-oidc` provider/role rather than sharing dev's (a single AWS account can only have one GitHub OIDC provider per URL; two independent accounts each need their own). Its `network`/`compute`/`data` stay validate-only. Its `dvc_cache`/`dataset_releases` storage modules **are applied for real as of OPS-07** — confirmed with `aws s3api list-buckets`: `dvc-cache-prod-<account_id>` and `dataset-releases-prod-<account_id>` both exist. Everything else in `prod` is still just `terraform fmt`/`init -backend=false`/`validate`, nothing else `apply`'d. Its state lives in the *same* bootstrap bucket as dev only because this project has one AWS account total right now — a real multi-account rollout would give prod its own backend entirely.

## OPS-07: PROD S3 remote and the release workflow

**PROD DVC remote:** `pipeline/.dvc/config` has a `prod` remote (`s3://dvc-cache-prod-<account_id>`, real AWS S3) alongside the untouched `dev` remote (MinIO). DVC's cache is content-addressed, so pushing the same local cache to both remotes produces byte-identical objects by construction — see `pipeline/README.md`'s "PROD remote and hash consistency" section for the real verification procedure and why it's a local, not CI, step (GitHub-hosted runners can't reach docker-compose's MinIO).

**OIDC S3 permissions — applied for real:** the `github-oidc` module only supports attaching pre-made AWS-managed policy ARNs (`for_each` over `managed_policy_arns`) — there's no inline-policy mechanism in it. Since we need a *custom*, tightly-scoped policy (not an AWS-managed one), `environments/dev/main.tf` defines its own `aws_iam_policy` (built from an `aws_iam_policy_document` data source, scoped to exactly `s3:ListBucket`/`GetObject`/`PutObject` on the 4 real bucket ARNs — `dvc-cache`/`dataset-releases` × `dev`/`prod` — never a broad managed policy) and attaches it directly to the same real role via `aws_iam_role_policy_attachment`. dev's role is the one used for both environments' buckets since this project has a single AWS account right now. Confirmed with `aws iam list-attached-role-policies --role-name github-actions-dataset-quality-dev`: `dataset-quality-release-publish` is attached.

**`.github/workflows/release.yml`** (`workflow_dispatch`-only, same reasoning as `aws-oidc-check`): proves the new IAM policy actually works — writes and reads back a real marker object in both PROD buckets via the OIDC-assumed role, then confirms the role is *denied* access to an out-of-scope bucket (the Terraform state bucket), as evidence the policy is neither too narrow nor too broad. It deliberately does not attempt `dvc push -r prod` itself — see the workflow file's own comment for why.

**PROD storage buckets, applied for real:** same "apply for real when it's free" call as bootstrap/OIDC/dev's buckets — a targeted apply (not a full `prod` apply; `network`/`compute`/`data` stay untouched, no new RDS/ECS spend):
```bash
# In AWS CloudShell, already authenticated:
cd Proyecto-02-dataset-Quality/infra/environments/prod
terraform init
terraform apply -target=module.dvc_cache -target=module.dataset_releases
```

Since `dev` runs real billable resources (RDS, an ECS cluster, S3), destroy it after grading if it's not needed to stay up (`terraform destroy` from `environments/dev`, run the same way as the applies above).

## Project 3: separate OIDC role (`github-actions-classifier-portal`)

`environments/dev` also defines a **second, independent** GitHub Actions OIDC role for Project 3's own repository (`BryanRomoG/proyecto3-classifier-portal`), separate from the `github-actions-dataset-quality-dev` role above. The existing role, the `github-oidc` provider, the storage buckets, and the workflows are all left untouched.

- **Trust policy** (`aws_iam_policy_document.classifier_portal_assume_role`): accepts only tokens from `token.actions.githubusercontent.com` whose `sub` matches `repo:BryanRomoG@178322887/proyecto3-classifier-portal@1387653048:ref:refs/heads/main` — Project 3's immutable owner/repository IDs and `main` branch only — with audience `sts.amazonaws.com`. It reuses the provider already created by `module.github_oidc` via that module's `oidc_provider_arn` output instead of creating a second provider (an AWS account can only have one GitHub OIDC provider per URL).
- **Permissions:** the role has `aws_iam_policy.release_publish` attached (the same least-privilege S3 policy the pipeline role uses) via `aws_iam_role_policy_attachment.classifier_portal_release_publish`.

**Register the role ARN in GitHub** — after applying, read the ARN from the `classifier_portal_role_arn` output and add it to Project 3's repo as a **GitHub Actions repository variable** named `AWS_ROLE_ARN` (a variable, not a secret — it's an ARN):

```bash
# In AWS CloudShell, already authenticated:
cd proyecto3-classifier-portal/infra/environments/dev
terraform init
terraform apply \
  -target=aws_iam_role.classifier_portal \
  -target=aws_iam_role_policy_attachment.classifier_portal_release_publish
terraform output -raw classifier_portal_role_arn
```

Then, in the `BryanRomoG/proyecto3-classifier-portal` repo: Settings → Secrets and variables → Actions → Variables tab → New repository variable, name `AWS_ROLE_ARN`, value the ARN above. Project 3's workflows assume the role with `role-to-assume: ${{ vars.AWS_ROLE_ARN }}` — the same `AWS_ROLE_ARN` convention this repo's `terraform.yml`/`release.yml` already use.

## P4-2.1: ingesta edge en AWS (bucket de capturas + ECS Fargate/ALB/CloudFront)

Implementa las decisiones D2/D3 de `docs/AWS_EDGE_ARCHITECTURE.md`: un bucket
S3 privado nuevo para las capturas y la imagen consolidada del portal/backend
en **ECS Fargate** detrás de un **ALB público** y una distribución
**CloudFront**, desde un **ECR privado**, reutilizando el **cluster ECS**
existente (`module.compute.cluster_id`). Reutiliza la VPC/subredes y la RDS
`dataset-quality-dev`; **no** reutiliza los buckets de releases/DVC (semántica
distinta) y **no** abre RDS a Internet.

> **Pivote desde App Runner (2026-03-31).** El diseño original desplegaba en
> AWS App Runner con un VPC Connector. Se descartó al comprobar la cuenta real
> `685538571046`: `aws apprunner list-services` devuelve
> `SubscriptionRequiredException`, porque AWS dejó de aceptar clientes nuevos de
> App Runner desde el **31 de marzo de 2026**. El reemplazo es ECS Fargate
> sobre el cluster que ya existe, con ALB + CloudFront. El historial de la
> decisión original queda en `docs/AWS_EDGE_ARCHITECTURE.md`.
> `Dockerfile.apprunner` conserva su nombre por compatibilidad, pero la imagen
> es portable a ECS (el mismo contenedor escucha en `:8080`).

Todo vive en el módulo nuevo `infra/modules/edge-app/` y se compone en
`infra/environments/dev/main.tf` (`module.edge_captures` + `module.edge_app`).
`prod` **no se toca**.

### Qué crea

Se divide en dos pasos sin `-target`, controlados por `deploy_edge_service`
(default `false`):

**Paso 1 (`deploy_edge_service = false`) — siempre:**

- **ECR privado** `edge-app-dev`: inmutable (`IMMUTABLE`), escaneo al publicar
  (`scan_on_push`), política de ciclo de vida que expira las imágenes más allá
  de las 10 más recientes y `force_delete` configurable (`ecr_force_delete`,
  `true` en dev).
- **Token de ingesta edge** en Secrets Manager (`edge-app-dev-ingest-token`):
  `random_password` de 48 caracteres sin símbolos especiales, versión publicada
  y `recovery_window_in_days = 0`.
- **Header secreto de origen**: `random_password` de 40 caracteres sin símbolos
  especiales, usado como `X-Origin-Verify` en el ALB y en CloudFront.
- **Roles ECS dedicados** (trust `ecs-tasks.amazonaws.com`):
  - *Execution role* con `AmazonECSTaskExecutionRolePolicy` más una política
    inline de `secretsmanager:GetSecretValue` **solo** sobre el ARN del token y
    el ARN del secreto de RDS.
  - *Task role* con `s3:ListBucket` **solo** sobre el ARN del bucket y
    `s3:GetObject`/`PutObject`/`DeleteObject` **solo** en
    `bucket/edge-captures/*` (`DeleteObject` es necesario para el rollback de
    una escritura parcial).
- **Log group de CloudWatch** (`/ecs/edge-app-dev`) con retención de 14 días.

**Paso 2 (`deploy_edge_service = true`) — con `count`, requiere imagen publicada:**

- **SG del ALB** (ingress `80` solo desde el prefijo gestionado
  `com.amazonaws.global.cloudfront.origin-facing`) y **SG de la tarea**
  (ingress `8080` solo desde el SG del ALB; egress all).
- **ALB** internet-facing en las subredes públicas y **target group** `ip` en
  `:8080` con health check `/api/health`.
- **Listener HTTP** con respuesta por defecto **403** y una **listener rule**
  que exige el header `X-Origin-Verify` (valor del `random_password`) y reenvía
  al target group.
- **Task definition Fargate** `1024`/`2048`, modo `awsvpc`, imagen
  `repo_url:image_tag`, puerto `8080`, variables `NODE_ENV=production`,
  `DB_NAME`, `OBJECT_STORE_BUCKET`, `OBJECT_STORE_REGION`, `RUN_DB_SEED=false`,
  secretos `EDGE_INGEST_TOKEN` y `DATABASE_CREDENTIALS_JSON`, driver `awslogs` y
  health check del contenedor.
- **Servicio ECS** `desired_count = 1`, `launch_type = FARGATE` en el cluster
  recibido, subredes públicas con `assign_public_ip = true` (para arrancar sin
  NAT; el SG impide ingreso directo), SG de la tarea, load balancer y
  `deployment_circuit_breaker` con rollback.
- **Distribución CloudFront** con origen ALB por HTTP, custom header
  `X-Origin-Verify`, `redirect-to-https`, métodos
  `GET HEAD OPTIONS PUT POST PATCH DELETE`, `Managed-CachingDisabled` +
  `Managed-AllViewerExceptHostHeader` y certificado por defecto. Depende de la
  listener rule.

### Prerrequisitos

Perfil y región fijados para todas las sesiones:

```bash
export AWS_PROFILE=proyecto3-owner
export AWS_REGION=us-east-1
```

AWS dejó de aceptar clientes nuevos de App Runner el 31 de marzo de 2026: en
esta cuenta `aws apprunner list-services` responde
`SubscriptionRequiredException`, por eso el despliegue usa ECS Fargate + ALB +
CloudFront y no necesita App Runner en ningún paso.

### Paso 1 — Crear ECR, secretos, roles y log group (`deploy false`)

Sin `-target`: `deploy_edge_service` es `false` por defecto, así que este apply
crea el bucket, el ECR, su lifecycle, el token/secret, el header de origen, los
roles con sus políticas y el log group, pero **no** el ALB, la task definition,
el servicio ECS ni CloudFront.

```bash
cd infra/environments/dev
terraform init
terraform apply
```

### Paso 2 — Publicar la imagen y desplegar el servicio

```bash
# Desde la RAÍZ del repositorio
cd "$(git rev-parse --show-toplevel)"

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
REGISTRY="${ACCOUNT_ID}.dkr.ecr.us-east-1.amazonaws.com"
IMAGE_TAG="$(git rev-parse HEAD)"
ECR_REPO="$(terraform -chdir=infra/environments/dev output -raw edge_app_ecr_repository_url)"

# Login (la contraseña va por stdin, no se imprime)
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin "$REGISTRY"

# Build desde la raíz usando Dockerfile.apprunner (nombre conservado por
# compatibilidad; la imagen es portable a ECS porque escucha en :8080)
docker build -f Dockerfile.apprunner -t "${ECR_REPO}:${IMAGE_TAG}" .
docker push "${ECR_REPO}:${IMAGE_TAG}"
```

El repositorio ECR es inmutable: el tag es el SHA de Git y no se sobreescribe
(para redesplegar se publica un SHA nuevo).

Apply del servicio (ahora sí crea ALB, task definition, ECS y CloudFront):

```bash
cd infra/environments/dev
terraform apply -var deploy_edge_service=true -var "app_image_tag=${IMAGE_TAG}"
```

El tag `bootstrap` (default de `var.app_image_tag`) solo existe para que
`validate`/`plan` funcionen sin un SHA real; el paso 2 siempre pasa el SHA.
La validación rechaza `bootstrap` y cualquier valor que no sea un SHA completo
de 40 caracteres cuando `deploy_edge_service=true`.

Después del primer despliegue, cualquier `plan` o `apply` posterior debe volver
a pasar `deploy_edge_service=true` y el SHA actualmente desplegado (o el nuevo
SHA que se quiera liberar). Ejecutar un `apply` sin esas variables volvería al
default `false` y propondría retirar el servicio; siempre se revisa el plan antes
de aprobarlo.

### Paso 3 — Verificar

```bash
terraform output -raw edge_app_public_url            # URL HTTPS de CloudFront
terraform output -raw edge_app_cloudfront_domain_name
terraform output -raw edge_app_alb_dns_name          # protegido por X-Origin-Verify
terraform output -raw edge_app_ecs_service_name
# El ARN del token es sensible: se lee como ARN, nunca su valor.
terraform output -raw edge_app_ingest_token_secret_arn
```

La URL de CloudFront debe responder en `GET /api/health`; una ingesta sin
`Authorization: Bearer <token>` válido responde `401` sin persistir nada. Un
acceso directo al DNS del ALB sin el header `X-Origin-Verify` responde `403`.

Ningún comando del flujo imprime el token ni el header de origen: el login
recibe la contraseña por stdin y los valores sensibles viven en Secrets Manager
(el header queda en el estado de Terraform, nunca en logs).

### Costo

ECS Fargate cobra por vCPU/GB-hora de la tarea en ejecución, y el ALB cobra una
tarifa horaria más LCU; CloudFront, ECR, S3, CloudWatch o transferencia generan
cargos por uso. No hay costo de VPC Connector porque ya no se usa. Es un
despliegue **facturable**, no una demo gratis, incluso con `desired_count = 1`.

### Destruir solo P4-2.1

No se debe ejecutar un `terraform destroy` sin alcance en este root: también
eliminaría la RDS, la VPC y los recursos heredados de proyectos anteriores.
Cuando P4-2.1 ya no se necesite, destruir únicamente sus dos módulos, pasando
el SHA desplegado para que la configuración represente el servicio existente:

```bash
cd infra/environments/dev
terraform destroy \
  -target=module.edge_app \
  -target=module.edge_captures \
  -var deploy_edge_service=true \
  -var "app_image_tag=${IMAGE_TAG}"
```

El bucket de capturas usa `force_destroy = true` y el ECR `force_delete = true`,
así que el destroy borra objetos e imágenes sin purgarlos a mano; el secreto se
creó con `recovery_window_in_days = 0`, así que no deja ventana de recuperación.

## `infra/bootstrap/`

A separate, tiny root — not an environment — that exists to solve one bootstrapping problem: Terraform can't store its own state in an S3 bucket that Terraform itself hasn't created yet. It creates just the state bucket (versioned — Terraform's own state-recovery mechanism) and a DynamoDB table for locking, and deliberately keeps **local** state itself, since this is the one piece of infrastructure that can't depend on the remote backend it's creating. `environments/dev` and `environments/prod` each have a `backend "s3" {}` block pointing at these resources (account ID hardcoded — backend blocks can't use variables or data sources, so this can't be `${data.aws_caller_identity...}` the way bucket names elsewhere are).

## One-time setup for whoever picks this up next

1. **Bootstrap the state backend, then migrate both environments onto it** (already done for account `685538571046` / `us-east-1`):
   ```bash
   # In AWS CloudShell, already authenticated:
   git clone <repo> && cd Proyecto-02-dataset-Quality/infra/bootstrap
   terraform init
   terraform apply

   cd ../environments/dev
   terraform init -migrate-state
   cd ../../environments/prod
   terraform init -migrate-state
   ```
   `dev`'s migration is done and verified (`terraform state list` shows all 31 resources, `terraform plan` reports `No changes`). `prod` has never been applied, so its migration just moves an effectively-empty state file; still worth doing, for consistency and to prove the backend config is genuinely correct for both — pending as of this writing.

2. **Bootstrap the dev OIDC role** (already done for account `685538571046` / `us-east-1`, kept here for reference or for re-running against a different account):
   ```bash
   # In AWS CloudShell, already authenticated:
   git clone <repo> && cd Proyecto-02-dataset-Quality/infra/environments/dev
   terraform init
   terraform apply -target=module.github_oidc
   terraform output -raw github_oidc_role_arn   # (add this output if not already present)
   ```
3. **Add the resulting role ARN as a GitHub Actions repository variable** named `AWS_ROLE_ARN`: repo Settings → Secrets and variables → Actions → Variables tab → New repository variable. It's an ARN, not a secret, so a variable (not a secret) is the right place for it.
4. Manually run the **`aws-oidc-check`** workflow (Actions tab → Terraform → Run workflow) and confirm the `aws sts get-caller-identity` step succeeds — that's the end-to-end proof the trust policy is correctly scoped.
5. When a future ticket needs the role to actually do something (push to S3, deploy ECS, etc.), extend `managed_policy_arns` on the `github_oidc` module call rather than widening the trust policy — keep permissions additive and specific to what's actually used.
