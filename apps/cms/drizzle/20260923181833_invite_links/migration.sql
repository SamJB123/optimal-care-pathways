CREATE TABLE `invite_links` (
	`token` text PRIMARY KEY,
	`org_id` text NOT NULL,
	`team_name` text NOT NULL,
	`role` text NOT NULL,
	`document_id` text,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	CONSTRAINT `fk_invite_links_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `invite_links_org` ON `invite_links` (`org_id`);