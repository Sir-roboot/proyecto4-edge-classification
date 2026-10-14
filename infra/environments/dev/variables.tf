variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

# P4-2.1: tag de la imagen ECR que el servicio ECS despliega. El default
# "bootstrap" permite que `terraform validate`/`plan` (y el paso 1 del
# despliegue, sin servicio) funcionen sin un tag real; el paso 2 pasa el SHA de
# Git:
#   terraform apply -var deploy_edge_service=true -var app_image_tag=<SHA>
variable "app_image_tag" {
  description = "Tag de la imagen en ECR (SHA de Git) que el servicio ECS despliega."
  type        = string
  default     = "bootstrap"

  validation {
    condition     = !var.deploy_edge_service || can(regex("^[0-9a-f]{40}$", trimspace(var.app_image_tag)))
    error_message = "app_image_tag debe ser un SHA completo de Git (40 caracteres hexadecimales) cuando deploy_edge_service = true."
  }
}

# P4-2.1: dos pasos sin `-target`. En false (default) solo se crean ECR,
# secretos, roles y log group; ponerlo en true crea además ALB, task
# definition, servicio ECS y CloudFront (requiere una imagen ya publicada).
variable "deploy_edge_service" {
  description = "Si es true, crea el ALB, la task definition, el servicio ECS y la distribución CloudFront del edge-app."
  type        = bool
  default     = false
}
