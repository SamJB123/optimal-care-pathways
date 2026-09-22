CREATE TABLE `comments` (
	`id` text PRIMARY KEY,
	`document_id` text NOT NULL,
	`section_id` text NOT NULL,
	`kind` text DEFAULT 'comment' NOT NULL,
	`body` text NOT NULL,
	`author_id` text NOT NULL,
	`author_name` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`resolved_at` integer,
	`resolved_by` text,
	CONSTRAINT `fk_comments_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_comments_section_id_sections_id_fk` FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `review_sections` (
	`review_id` text NOT NULL,
	`section_id` text NOT NULL,
	`body_hash` text NOT NULL,
	`decision` text,
	`note` text,
	`decided_by` text,
	`decided_at` integer,
	CONSTRAINT `review_sections_pk` PRIMARY KEY(`review_id`, `section_id`),
	CONSTRAINT `fk_review_sections_review_id_reviews_id_fk` FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `version_sections` (
	`version_id` text NOT NULL,
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
	`last_changed_version_no` integer NOT NULL,
	CONSTRAINT `version_sections_pk` PRIMARY KEY(`version_id`, `section_id`),
	CONSTRAINT `fk_version_sections_version_id_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `versions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `versions` (
	`id` text PRIMARY KEY,
	`document_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`version_no` integer NOT NULL,
	`label` text,
	`release_notes` text,
	`core_version_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`created_by` text NOT NULL,
	`published_at` integer,
	`published_by` text,
	CONSTRAINT `fk_versions_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
-- drizzle-kit emitted `ALTER TABLE reviews ADD version_id text NOT NULL REFERENCES …`
-- here, which SQLite refuses (a NOT NULL column added by ALTER needs a default) and which
-- the table rebuild below makes redundant; that one statement is removed. The rebuild's
-- INSERT carries no version_id: `reviews` has never held a row (checked local and remote,
-- 2026-09-23), so nothing is lost.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_reviews` (
	`id` text PRIMARY KEY,
	`document_id` text NOT NULL,
	`version_id` text NOT NULL,
	`requested_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`note` text,
	CONSTRAINT `fk_reviews_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_reviews_version_id_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `versions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_reviews`(`id`, `document_id`, `requested_by`, `created_at`, `note`) SELECT `id`, `document_id`, `requested_by`, `created_at`, `note` FROM `reviews`;--> statement-breakpoint
DROP TABLE `reviews`;--> statement-breakpoint
ALTER TABLE `__new_reviews` RENAME TO `reviews`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
DROP INDEX IF EXISTS `snapshot_sections_address`;--> statement-breakpoint
DROP INDEX IF EXISTS `snapshots_document`;--> statement-breakpoint
DROP INDEX IF EXISTS `snapshots_document_version`;--> statement-breakpoint
CREATE INDEX `reviews_document` ON `reviews` (`document_id`);--> statement-breakpoint
CREATE INDEX `reviews_version` ON `reviews` (`version_id`);--> statement-breakpoint
CREATE INDEX `comments_section` ON `comments` (`section_id`);--> statement-breakpoint
CREATE INDEX `comments_document` ON `comments` (`document_id`);--> statement-breakpoint
CREATE INDEX `version_sections_address` ON `version_sections` (`version_id`,`address`);--> statement-breakpoint
CREATE INDEX `versions_document` ON `versions` (`document_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `versions_document_no` ON `versions` (`document_id`,`version_no`);--> statement-breakpoint
CREATE INDEX `versions_status` ON `versions` (`document_id`,`status`);--> statement-breakpoint
DROP TABLE `snapshot_sections`;--> statement-breakpoint
DROP TABLE `snapshots`;--> statement-breakpoint
ALTER TABLE `documents` DROP COLUMN `status`;--> statement-breakpoint
ALTER TABLE `documents` DROP COLUMN `published_version_no`;--> statement-breakpoint
CREATE VIEW `published_sections` AS select "versions"."document_id", "version_sections"."version_id", "versions"."version_no", "version_sections"."section_id", "version_sections"."parent_address", "version_sections"."address", "version_sections"."title", "version_sections"."printed_number", "version_sections"."order_index", "version_sections"."ownership", "version_sections"."point_of_care", "version_sections"."body_json", "version_sections"."html", "version_sections"."markdown", "version_sections"."last_changed_version_no" from "version_sections" inner join "versions" on "versions"."id" = "version_sections"."version_id" where (("versions"."status" = 'published') and ("version_sections"."hidden" = 0));--> statement-breakpoint
CREATE VIEW `published_versions` AS select "documents"."id" as "document_id", "documents"."kind", "documents"."template_id", "documents"."org_id", "documents"."slug", "documents"."partner_slug", "documents"."title", "documents"."subject", "documents"."audience", "versions"."id" as "version_id", "versions"."version_no", "versions"."label", "versions"."release_notes", "versions"."core_version_id", "versions"."published_at", "versions"."published_by" from "versions" inner join "documents" on "documents"."id" = "versions"."document_id" where "versions"."status" = 'published';--> statement-breakpoint
CREATE VIEW `review_state` AS select "reviews"."id", "reviews"."document_id", "reviews"."version_id", "reviews"."requested_by", "reviews"."created_at", "reviews"."note", count("review_sections"."section_id") as "total", count("review_sections"."decision") as "decided", coalesce(sum(case when "review_sections"."decision" = 'approved' then 1 else 0 end), 0) as "approved", coalesce(sum(case when "review_sections"."decision" = 'changes_requested' then 1 else 0 end), 0) as "changes_requested", case
				when coalesce(sum(case when "review_sections"."decision" = 'changes_requested' then 1 else 0 end), 0) > 0 then 'changes_requested'
				when count("review_sections"."section_id") > 0 and count("review_sections"."decision") = count("review_sections"."section_id") then 'approved'
				else null end as "decision", exists (
				select 1 from "reviews" later
				where later.version_id = "reviews"."version_id"
				and later.created_at > "reviews"."created_at"
			) as "superseded" from "reviews" left join "review_sections" on "review_sections"."review_id" = "reviews"."id" group by "reviews"."id";