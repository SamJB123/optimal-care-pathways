-- Custom SQL migration file, put your code below! --
-- The previous editions' PDFs move from the site's static files (legacy-sources/<file>)
-- to the files bucket (legacy/<file>); a seeded key follows them.
UPDATE `legacy_documents` SET `pdf_key` = 'legacy/' || substr(`pdf_key`, length('legacy-sources/') + 1) WHERE `pdf_key` LIKE 'legacy-sources/%';
