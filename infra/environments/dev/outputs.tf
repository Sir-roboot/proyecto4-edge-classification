output "github_oidc_role_arn" {
  value = module.github_oidc.role_arn
}

output "vpc_id" {
  value = module.network.vpc_id
}

output "db_instance_endpoint" {
  value = module.data.db_instance_endpoint
}

output "classifier_portal_role_arn" {
  description = "ARN of the Project 3 GitHub Actions OIDC role (github-actions-classifier-portal). Register this in the Project 3 repo as the Actions variable AWS_ROLE_ARN."
  value       = aws_iam_role.classifier_portal.arn
}

# --- P4-2.1: edge-app ---

output "edge_captures_bucket_id" {
  description = "Nombre del bucket S3 de capturas edge (edge-captures-dev-<account_id>)."
  value       = module.edge_captures.bucket_id
}

output "edge_app_ecr_repository_url" {
  description = "URL del repositorio ECR para docker login/build/push."
  value       = module.edge_app.ecr_repository_url
}

output "edge_app_ecr_repository_arn" {
  value = module.edge_app.ecr_repository_arn
}

output "edge_app_public_url" {
  description = "URL HTTPS pública vía CloudFront. null hasta el paso 2 (deploy_edge_service=true)."
  value       = module.edge_app.public_url
}

output "edge_app_ecs_service_name" {
  description = "Nombre del servicio ECS. null hasta el paso 2."
  value       = module.edge_app.ecs_service_name
}

output "edge_app_ecs_service_arn" {
  description = "ARN del servicio ECS. null hasta el paso 2."
  value       = module.edge_app.ecs_service_arn
}

output "edge_app_alb_dns_name" {
  description = "DNS público del ALB (protegido por el header X-Origin-Verify). null hasta el paso 2."
  value       = module.edge_app.alb_dns_name
}

output "edge_app_cloudfront_distribution_id" {
  description = "ID de la distribución CloudFront. null hasta el paso 2."
  value       = module.edge_app.cloudfront_distribution_id
}

output "edge_app_cloudfront_domain_name" {
  description = "Dominio de la distribución CloudFront. null hasta el paso 2."
  value       = module.edge_app.cloudfront_domain_name
}

output "edge_app_ingest_token_secret_arn" {
  description = "ARN del secreto del token de ingesta edge. El valor nunca se publica."
  value       = module.edge_app.ingest_token_secret_arn
  sensitive   = true
}
