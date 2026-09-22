import { defineConfig } from 'drizzle-kit'

/**
 * drizzle-kit config for the content D1 (SQLite) schema. Generates SQL under
 * `./drizzle/`; wrangler owns migration application and the journal
 * (`pnpm db:migrate:local` / `db:migrate:remote`).
 */
export default defineConfig({
	dialect: 'sqlite',
	schema: './src/db/schema.ts',
	out: './drizzle',
})
