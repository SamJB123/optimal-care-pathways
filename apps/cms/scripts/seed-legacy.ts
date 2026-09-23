/**
 * Seeds the legacy pathways (decisions 129–140): reads each pathway's extracted model
 * (`legacy/extracted/<slug>.model.json`, from `pnpm legacy:extract`), maps it onto the
 * template kind's core spine with `mapLegacy`, checks every body against the content
 * schema, and writes one SQL file per design family for wrangler to apply:
 *
 *   pnpm exec tsx scripts/seed-legacy.ts <slug|family|all> [--out <file>]
 *   → .wrangler/seed/legacy-<name>.sql
 *
 * The core documents must be seeded first (`pnpm db:seed:build` + apply): a pathway's
 * shared sections point at their rows. Each pathway's organisation does not exist yet:
 * `documents.org_id` is written as `pending:<slug>` and the admin door "finalise legacy
 * imports" creates the organisation and renders the published version's HTML.
 *
 * Rows are `INSERT OR REPLACE` on deterministic ids, so re-running replaces the same rows —
 * which RESETS the pathway's draft to the import. Run it before authors start, or not at all.
 * Column names come from the drizzle schema, never typed by hand here.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableColumns, getTableName, type Table } from 'drizzle-orm'
import { parseBody } from '../src/content/schema.ts'
import * as schema from '../src/db/schema.ts'
import { LEGACY_PATHWAYS, type LegacyFamily, type LegacyPathway } from '../src/legacy/catalogue.ts'
import { type LegacyImport, mapLegacy } from '../src/legacy/map-legacy.ts'
import { mapTemplate } from '../src/template/extract/map-to-content.ts'
import type { ExtractedDocument } from '../src/template/extract/model.ts'
import { TEMPLATES } from '../src/template/templates.ts'
import { deterministicId } from './ids.ts'

const args = process.argv.slice(2)
const which = args[0]
if (!which) {
	console.error('usage: tsx scripts/seed-legacy.ts <slug|design-2021|design-2020|population|all> [--out <file>]')
	process.exit(2)
}
const appDir = join(import.meta.dirname, '..')
const families: LegacyFamily[] = ['design-2021', 'design-2020', 'population']
const targets: LegacyPathway[] =
	which === 'all'
		? [...LEGACY_PATHWAYS]
		: families.includes(which as LegacyFamily)
			? LEGACY_PATHWAYS.filter((p) => p.family === which)
			: LEGACY_PATHWAYS.filter((p) => p.slug === which)
if (targets.length === 0) {
	console.error(`unknown pathway or family "${which}"`)
	process.exit(2)
}

/** The import records the same actor the versions name; a real user replaces it when the
 *  admin door runs. */
const ACTOR = 'legacy-import'

const readModel = (dir: string, key: string): ExtractedDocument =>
	JSON.parse(readFileSync(join(appDir, dir, `${key}.model.json`), 'utf8'))

const cores = new Map(
	TEMPLATES.filter((t) => t.kind !== 'principles').map((t) => [
		t.kind,
		mapTemplate({ model: readModel('template/2026/extracted', t.key), template: t, orgId: 'central', id: deterministicId }),
	]),
)

// ---- SQL from drizzle rows ------------------------------------------------------------------

const q = (value: unknown): string => {
	if (value === null || value === undefined) return 'NULL'
	if (typeof value === 'number') return String(value)
	if (typeof value === 'boolean') return value ? '1' : '0'
	if (value instanceof Date) return String(value.getTime())
	if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`
	return `'${JSON.stringify(value).replace(/'/g, "''")}'`
}

/** One INSERT OR REPLACE for a row, its column names read off the drizzle table. */
function insert<T extends Table>(table: T, row: Record<string, unknown>): string {
	const columns = getTableColumns(table)
	const names: string[] = []
	const values: string[] = []
	for (const [key, column] of Object.entries(columns)) {
		if (!(key in row) || row[key] === undefined) continue
		names.push(`"${column.name}"`)
		values.push(q(row[key]))
	}
	return `INSERT OR REPLACE INTO "${getTableName(table)}" (${names.join(', ')}) VALUES (${values.join(', ')});`
}

const statements: string[] = []
const emit = (result: LegacyImport) => {
	statements.push(insert(schema.legacyDocuments, result.legacyDocument))
	for (const s of result.legacySections) {
		parseBody(s.bodyJson)
		statements.push(insert(schema.legacySections, s))
	}
	statements.push(insert(schema.documents, result.document))
	// A re-run must not leave sections of an earlier import behind.
	statements.push(`DELETE FROM sections WHERE document_id = ${q(result.document.id)} AND id NOT IN (${result.sections.map((s) => q(s.id)).join(', ')});`)
	for (const s of result.sections) {
		if (s.bodyJson) parseBody(s.bodyJson)
		statements.push(insert(schema.sections, s))
	}
	for (const r of result.references) statements.push(insert(schema.references, r))
	for (const v of result.versions) statements.push(insert(schema.versions, v))
	statements.push(`DELETE FROM version_sections WHERE version_id = ${q(result.versions[0]?.id ?? '')};`)
	for (const vs of result.versionSections) {
		if (vs.bodyJson) parseBody(vs.bodyJson)
		statements.push(insert(schema.versionSections, vs))
	}
	statements.push(`DELETE FROM section_origins WHERE section_id IN (${result.sections.map((s) => q(s.id)).join(', ')});`)
	for (const o of result.origins) statements.push(insert(schema.sectionOrigins, o))
}

const ledgerDir = join(appDir, 'legacy', 'ledgers')
mkdirSync(ledgerDir, { recursive: true })
for (const pathway of targets) {
	const core = cores.get(pathway.audience)
	if (!core) throw new Error(`no core mapping for ${pathway.audience}`)
	const model = readModel('legacy/extracted', pathway.slug)
	const result = mapLegacy({ model, pathway, core, id: deterministicId, orgId: `pending:${pathway.pathwaySlug}`, actorId: ACTOR })
	emit(result)
	const { ledger } = result
	const by = (how: string) => ledger.placements.filter((p) => p.how === how).length
	console.log(
		`${pathway.pathwaySlug}: ${result.sections.length} draft sections (${result.sections.filter((s) => s.migrationNote?.startsWith('unplaced')).length} unplaced, ${result.sections.filter((s) => s.migrationNote?.startsWith('proposed')).length} proposed), ` +
			`${result.legacySections.length} legacy sections, ${result.versionSections.length} published sections, ${result.references.length} references; ` +
			`placements: title ${by('title') + by('title-child')}, rule ${by('rule')}, merged ${by('merged')}, timeframe ${by('timeframe')}, resources ${by('resources')}, diverged ${by('diverged')}, provenance ${by('provenance')}, proposed ${by('proposed')}, unplaced ${by('unplaced')}, derived ${by('derived')}; ` +
			`citations ${ledger.citations.matched} matched / ${ledger.citations.unmatched.length} unmatched; ${ledger.checkItems} check lists; figure rows ${ledger.timeframes.figureRows} → timeframe boxes ${ledger.timeframes.boxes}; edition ${ledger.edition ?? '?'} ${ledger.publicationDate ?? '?'}`,
	)
	writeFileSync(
		join(ledgerDir, `${pathway.slug}.ledger.json`),
		`${JSON.stringify({ pathway: pathway.pathwaySlug, ...ledger, unplacedSections: result.sections.filter((s) => s.migrationNote).map((s) => ({ address: s.address, title: s.title, note: s.migrationNote })) }, null, '\t')}\n`,
	)
}

const outDir = join(appDir, '.wrangler', 'seed')
mkdirSync(outDir, { recursive: true })
const outFlag = args.indexOf('--out')
const target = outFlag > 0 && args[outFlag + 1] ? args[outFlag + 1] : join(outDir, `legacy-${which}.sql`)
writeFileSync(target, `${statements.join('\n')}\n`)
console.log(`${statements.length} statements → ${target}`)
