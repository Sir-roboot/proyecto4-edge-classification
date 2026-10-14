output "ecr_repository_url" {
  description = "URL del repositorio ECR (registry/repo) para docker login/build/push."
  value       = aws_ecr_repository.this.repository_url
}

output "ecr_repository_arn" {
  value = aws_ecr_repository.this.arn
}

output "public_url" {
  description = "URL HTTPS pública vía CloudFront. null cuando deploy_service = false."
  value       = try("https://${aws_cloudfront_distribution.this[0].domain_name}", null)
}

output "ecs_service_name" {
  description = "Nombre del servicio ECS. null cuando deploy_service = false."
  value       = try(aws_ecs_service.this[0].name, null)
}

output "ecs_service_arn" {
  description = "ARN del servicio ECS (aws_ecs_service no exporta .arn; su .id es el ARN). null cuando deploy_service = false."
  value       = try(aws_ecs_service.this[0].id, null)
}

output "alb_dns_name" {
  description = "DNS público del ALB. null cuando deploy_service = false."
  value       = try(aws_lb.this[0].dns_name, null)
}

output "cloudfront_distribution_id" {
  description = "ID de la distribución CloudFront. null cuando deploy_service = false."
  value       = try(aws_cloudfront_distribution.this[0].id, null)
}

output "cloudfront_domain_name" {
  description = "Dominio de la distribución CloudFront. null cuando deploy_service = false."
  value       = try(aws_cloudfront_distribution.this[0].domain_name, null)
}

output "ingest_token_secret_arn" {
  description = "ARN del secreto del token de ingesta edge (EDGE_INGEST_TOKEN). El valor nunca se publica como output."
  value       = aws_secretsmanager_secret.ingest_token.arn
  sensitive   = true
}
