-- What drizzle-kit cannot express: the full-text index the jump searches, and the rules
-- the template sets on a document's structure, held by the database as well as the server
-- so no door can slip past them. Statements are separated by drizzle's statement-breakpoint
-- marker, not by semicolons: a trigger body contains semicolons. (The marker itself must not
-- appear in a comment: the migration runners split on it wherever it is written.)

-- ---------------------------------------------------------------------------
-- FULL TEXT. One row per section that holds a body of its own (an owned section of any
-- document, which includes every core section): its title and its body's text. A shared
-- section is found through its core section. Written wherever a body is written (the
-- room's fold, the seeds, the structure doors), searched by server/search.ts.
-- ---------------------------------------------------------------------------
CREATE VIRTUAL TABLE `section_search` USING fts5(
	`section_id` UNINDEXED,
	`document_id` UNINDEXED,
	`title`,
	`body`,
	tokenize = 'porter unicode61 remove_diacritics 2'
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- THE NUMBERED SPINE IS FIXED. The template: "Numbered headings and subheadings cannot be
-- changed or reordered." A canonical section can be hidden, never renamed, renumbered,
-- moved or re-parented. (A seed's INSERT OR REPLACE is a delete and an insert, not an
-- update, so re-seeding is untouched by this.)
-- ---------------------------------------------------------------------------
CREATE TRIGGER `sections_canonical_fixed`
BEFORE UPDATE OF `title`, `address`, `order_index`, `parent_id`, `printed_number` ON `sections`
FOR EACH ROW WHEN OLD.`canonical` = 1
BEGIN
	SELECT RAISE(ABORT, 'This section is numbered by the template: its heading and its place are fixed. It can be hidden, not renamed or moved.')
	WHERE NEW.`title` IS NOT OLD.`title`
		OR NEW.`address` IS NOT OLD.`address`
		OR NEW.`order_index` IS NOT OLD.`order_index`
		OR NEW.`parent_id` IS NOT OLD.`parent_id`
		OR NEW.`printed_number` IS NOT OLD.`printed_number`;
END;
--> statement-breakpoint

-- A section a team adds is never numbered: only the template numbers sections.
CREATE TRIGGER `sections_added_unnumbered`
BEFORE INSERT ON `sections`
FOR EACH ROW WHEN NEW.`added` = 1
BEGIN
	SELECT RAISE(ABORT, 'A section a pathway adds is unnumbered: only the template numbers sections.')
	WHERE NEW.`canonical` = 1 OR NEW.`printed_number` IS NOT NULL;
END;
