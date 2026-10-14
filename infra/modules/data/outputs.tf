output "db_instance_endpoint" {
  value = aws_db_instance.this.endpoint
}

output "db_instance_identifier" {
  value = aws_db_instance.this.identifier
}

output "master_user_secret_arn" {
  description = "Secrets Manager secret ARN holding the RDS master credentials."
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
}

# Host and port are non-secret connection metadata: the RDS-managed secret only
# carries username/password, so these are surfaced separately and injected into
# the container as non-secret DB_HOST / DB_PORT environment variables.
output "db_instance_address" {
  description = "Hostname (address) of the RDS instance, non-secret. Injected as DB_HOST."
  value       = aws_db_instance.this.address
}

output "db_instance_port" {
  description = "Port on which the RDS instance accepts connections, non-secret. Injected as DB_PORT."
  value       = aws_db_instance.this.port
}

output "security_group_id" {
  value = aws_security_group.rds.id
}
