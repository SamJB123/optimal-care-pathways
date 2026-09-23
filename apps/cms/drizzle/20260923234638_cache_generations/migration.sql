CREATE TABLE `cache_generations` (
	`tag` text PRIMARY KEY,
	`version_id` text NOT NULL,
	`purged_at` integer NOT NULL
);
