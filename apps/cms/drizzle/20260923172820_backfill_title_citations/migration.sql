-- Custom SQL migration file, put your code below! --
-- Editions published before headings' citations were frozen with them take the
-- section's own (a heading's citations are the template's, and have not changed since).
UPDATE `version_sections` SET `title_citations` = (
	SELECT `sections`.`title_citations` FROM `sections` WHERE `sections`.`id` = `version_sections`.`section_id`
) WHERE `title_citations` IS NULL;
