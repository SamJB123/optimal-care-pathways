ALTER TABLE `comments` ADD `reply_to` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `present` text;--> statement-breakpoint
ALTER TABLE `references` ADD `supersedes` text;--> statement-breakpoint
ALTER TABLE `references` ADD `created_by` text;--> statement-breakpoint
ALTER TABLE `sections` ADD `instructions` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `sections` ADD `added` integer DEFAULT false NOT NULL;