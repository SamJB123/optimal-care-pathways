-- The full-text index the public API searches (decision: ranked search over published
-- content): one row per section of a PUBLISHED version that holds a body of its own — its
-- title and its body's words, stemmed. Written when a version is published (the
-- lifecycle) and when a seeded edition is finalised; a document's earlier versions' rows
-- are dropped when a new one is published. Searched by api/published.ts, joined to the
-- published_versions view so only current editions answer.
CREATE VIRTUAL TABLE `published_search` USING fts5(
	`version_id` UNINDEXED,
	`section_id` UNINDEXED,
	`document_id` UNINDEXED,
	`title`,
	`body`,
	tokenize = 'porter unicode61 remove_diacritics 2'
);
