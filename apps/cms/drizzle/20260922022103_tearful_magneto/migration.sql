CREATE TABLE `documents` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`template_id` text NOT NULL,
	`org_id` text NOT NULL,
	`slug` text NOT NULL,
	`partner_slug` text,
	`title` text NOT NULL,
	`subject` text NOT NULL,
	`audience` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`published_version_no` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer,
	CONSTRAINT `fk_documents_template_id_templates_id_fk` FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`)
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY,
	`document_id` text,
	`kind` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_name` text NOT NULL,
	`detail` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_events_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `legacy_documents` (
	`id` text PRIMARY KEY,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`audience` text NOT NULL,
	`format` text NOT NULL,
	`edition` text,
	`publication_date` text,
	`pdf_key` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `legacy_sections` (
	`id` text PRIMARY KEY,
	`document_id` text NOT NULL,
	`parent_id` text,
	`level` integer NOT NULL,
	`order_index` real NOT NULL,
	`heading` text,
	`key` text,
	`body_json` text,
	CONSTRAINT `fk_legacy_sections_document_id_legacy_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `legacy_documents`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `references` (
	`id` text PRIMARY KEY,
	`document_id` text NOT NULL,
	`citation` text NOT NULL,
	`url` text,
	`printed_number` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_references_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY,
	`document_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`requested_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`decided_by` text,
	`decided_at` integer,
	`decision` text,
	`note` text,
	CONSTRAINT `fk_reviews_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_reviews_snapshot_id_snapshots_id_fk` FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `section_origins` (
	`section_id` text NOT NULL,
	`legacy_section_id` text NOT NULL,
	`chars` integer NOT NULL,
	CONSTRAINT `section_origins_pk` PRIMARY KEY(`section_id`, `legacy_section_id`),
	CONSTRAINT `fk_section_origins_section_id_sections_id_fk` FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_section_origins_legacy_section_id_legacy_sections_id_fk` FOREIGN KEY (`legacy_section_id`) REFERENCES `legacy_sections`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `sections` (
	`id` text PRIMARY KEY,
	`document_id` text NOT NULL,
	`parent_id` text,
	`address` text NOT NULL,
	`canonical` integer DEFAULT false NOT NULL,
	`printed_number` text,
	`title` text,
	`heading_level` integer,
	`order_index` real NOT NULL,
	`step_number` integer,
	`ownership` text DEFAULT 'owned' NOT NULL,
	`core_section_id` text,
	`pathway_ownership` text,
	`apparatus` integer DEFAULT false NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`point_of_care` integer DEFAULT false NOT NULL,
	`body_json` text,
	`updated_at` integer,
	`updated_by` text,
	CONSTRAINT `fk_sections_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `snapshot_sections` (
	`snapshot_id` text NOT NULL,
	`section_id` text NOT NULL,
	`parent_address` text,
	`address` text NOT NULL,
	`title` text,
	`printed_number` text,
	`order_index` real NOT NULL,
	`ownership` text NOT NULL,
	`hidden` integer NOT NULL,
	`point_of_care` integer NOT NULL,
	`body_json` text,
	`html` text,
	`markdown` text,
	`last_changed_version_no` integer,
	CONSTRAINT `snapshot_sections_pk` PRIMARY KEY(`snapshot_id`, `section_id`),
	CONSTRAINT `fk_snapshot_sections_snapshot_id_snapshots_id_fk` FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY,
	`document_id` text NOT NULL,
	`kind` text NOT NULL,
	`version_no` integer,
	`label` text,
	`core_snapshot_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`created_by` text NOT NULL,
	`note` text,
	CONSTRAINT `fk_snapshots_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`source_file` text NOT NULL,
	`issued_on` text,
	`page_count` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `documents_slug` ON `documents` (`slug`);--> statement-breakpoint
CREATE INDEX `documents_org` ON `documents` (`org_id`);--> statement-breakpoint
CREATE INDEX `events_document_at` ON `events` (`document_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `legacy_documents_slug` ON `legacy_documents` (`slug`);--> statement-breakpoint
CREATE INDEX `legacy_sections_document` ON `legacy_sections` (`document_id`);--> statement-breakpoint
CREATE INDEX `legacy_sections_parent` ON `legacy_sections` (`parent_id`);--> statement-breakpoint
CREATE INDEX `references_document` ON `references` (`document_id`);--> statement-breakpoint
CREATE INDEX `reviews_document` ON `reviews` (`document_id`);--> statement-breakpoint
CREATE INDEX `section_origins_legacy` ON `section_origins` (`legacy_section_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sections_document_address` ON `sections` (`document_id`,`address`);--> statement-breakpoint
CREATE INDEX `sections_document` ON `sections` (`document_id`);--> statement-breakpoint
CREATE INDEX `sections_parent` ON `sections` (`parent_id`);--> statement-breakpoint
CREATE INDEX `sections_core` ON `sections` (`core_section_id`);--> statement-breakpoint
CREATE INDEX `snapshot_sections_address` ON `snapshot_sections` (`snapshot_id`,`address`);--> statement-breakpoint
CREATE INDEX `snapshots_document` ON `snapshots` (`document_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `snapshots_document_version` ON `snapshots` (`document_id`,`version_no`);