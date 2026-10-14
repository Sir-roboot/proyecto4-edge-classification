CREATE TABLE `edge_captures` (
	`capture_id` varchar(36) NOT NULL,
	`captured_at` varchar(40) NOT NULL,
	`device_id` varchar(128) NOT NULL,
	`model_version` varchar(256) NOT NULL,
	`predicted_class` enum('car','person') NOT NULL,
	`confidence` double NOT NULL,
	`image_sha256` varchar(64) NOT NULL,
	`crop` varchar(512),
	`image_key` varchar(512) NOT NULL,
	`mime_type` varchar(100) NOT NULL,
	`size_bytes` bigint unsigned NOT NULL,
	`received_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `edge_captures_capture_id` PRIMARY KEY(`capture_id`)
);
--> statement-breakpoint
CREATE INDEX `edge_captures_received_at_idx` ON `edge_captures` (`received_at`);--> statement-breakpoint
CREATE INDEX `edge_captures_device_id_idx` ON `edge_captures` (`device_id`);
