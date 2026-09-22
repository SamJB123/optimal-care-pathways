-- Empties the content database so the regenerated initial migration can be applied
-- afresh. Development only, while nothing lives in the remote database:
--
--   pnpm exec wrangler d1 execute ocp-cms-d1 --remote --command "$(grep -v '^--' scripts/reset-remote-d1.sql | tr '\n' ' ')"
--   pnpm db:migrate:remote
--
-- As a --command, not --file: the file form goes through D1's import endpoint, which the
-- wrangler OAuth login is not scoped for ("Authentication error [code: 10000]").
--
-- Once real content exists this file is obsolete: schema changes then go through
-- further migrations, never a reset.
DROP TABLE IF EXISTS section_origins;
DROP TABLE IF EXISTS snapshot_sections;
DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS snapshots;
DROP TABLE IF EXISTS legacy_sections;
DROP TABLE IF EXISTS legacy_documents;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS "references";
DROP TABLE IF EXISTS sections;
DROP TABLE IF EXISTS documents;
DROP TABLE IF EXISTS templates;
DROP TABLE IF EXISTS d1_migrations;
