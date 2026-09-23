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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableColumns, getTableName } from 'drizzle-orm'
import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core'
import { bodyHash } from '../src/content/diff.ts'
import { publishableHash } from '../src/content/publish.ts'
import { type JsonNode, normalBody, parseBody } from '../src/content/schema.ts'
import { searchText } from '../src/server/search-index.ts'
import * as schema from '../src/db/schema.ts'
import { LEGACY_PATHWAYS, type LegacyFamily, type LegacyPathway } from '../src/legacy/catalogue.ts'
import { type LegacyImport, mapLegacy } from '../src/legacy/map-legacy.ts'
import { hyperlinkTargets } from '../src/template/extract/hyperlinks.ts'
import { mapTemplate } from '../src/template/extract/map-to-content.ts'
import type { ExtractedDocument } from '../src/template/extract/model.ts'
import { TEMPLATES } from '../src/template/templates.ts'
import { deterministicId } from './ids.ts'

const args = process.argv.slice(2)
const which = args[0]
if (!which) {
	console.error(
		'usage: tsx scripts/seed-legacy.ts <slug|design-2021|design-2020|population|all> [--out <file>]',
	)
	process.exit(2)
}
const appDir = join(import.meta.dirname, '..')
const families: LegacyFamily[] = ['design-2021', 'design-2020', 'population']
const targets: LegacyPathway[] =
	which === 'all'
		? [...LEGACY_PATHWAYS]
		: families.some((family) => family === which)
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

// The cores as the template seed writes them, their "<hyperlink to be added>" notes
// resolved the same way (seed-templates.ts): a pathway's own copy of a template section
// must not keep a note the template itself has turned into a link.
const principles = TEMPLATES.find((t) => t.kind === 'principles')
if (!principles) throw new Error('the Principles template is not catalogued')
const hyperlinks = hyperlinkTargets(
	mapTemplate({
		model: readModel('template/2026/extracted', principles.key),
		template: principles,
		orgId: 'central',
		id: deterministicId,
	}),
	LEGACY_PATHWAYS,
)
const cores = new Map(
	TEMPLATES.filter((t) => t.kind !== 'principles').map((t) => [
		t.kind,
		mapTemplate({
			model: readModel('template/2026/extracted', t.key),
			template: t,
			orgId: 'central',
			id: deterministicId,
			hyperlinks,
		}),
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

/** D1 refuses a statement over 100 KB; a row that would make one is written in pieces. */
const STATEMENT_BYTES = 90_000
const PIECE_CHARS = 20_000

/** One INSERT OR REPLACE for a row, its column names read off the drizzle table. A row
 *  too long for one statement (the older-people pathway's reference list) goes in with its
 *  longest value empty, which then grows by `col = col || '…'` appends on its primary key. */
function insert(table: SQLiteTable, row: Record<string, unknown>): string[] {
	const present = Object.entries(getTableColumns(table)).filter(
		([key]) => key in row && row[key] !== undefined,
	)
	const values = present.map(([key]) => q(row[key]))
	const statement = (vals: string[]) =>
		`INSERT OR REPLACE INTO "${getTableName(table)}" (${present.map(([, c]) => `"${c.name}"`).join(', ')}) VALUES (${vals.join(', ')});`
	const whole = statement(values)
	if (Buffer.byteLength(whole) <= STATEMENT_BYTES) return [whole]
	const longest = values.reduce(
		(best, v, i) => (v.length > (values[best]?.length ?? 0) ? i : best),
		0,
	)
	const entry = present[longest]
	if (!entry) return [whole]
	const [key, column] = entry
	const raw = row[key]
	const text = typeof raw === 'string' ? raw : JSON.stringify(raw)
	const config = getTableConfig(table)
	const keyColumns = config.primaryKeys[0]?.columns ?? config.columns.filter((c) => c.primary)
	const where = keyColumns
		.map((c) => {
			const field = Object.entries(getTableColumns(table)).find(
				([, col]) => col.name === c.name,
			)?.[0]
			return `"${c.name}" = ${q(field ? row[field] : null)}`
		})
		.join(' AND ')
	const out = [statement(values.map((v, i) => (i === longest ? "''" : v)))]
	// Pieces cut on code points, never inside a surrogate pair.
	const points = Array.from(text)
	for (let at = 0; at < points.length; at += PIECE_CHARS)
		out.push(
			`UPDATE "${getTableName(table)}" SET "${column.name}" = "${column.name}" || ${q(points.slice(at, at + PIECE_CHARS).join(''))} WHERE ${where};`,
		)
	return out
}

/** Every core section's body: what a pathway's shared section renders until the core
 *  publishes, and so what its change hash starts from. */
const coreBodies = new Map(
	[...cores.values()].flatMap((c) => c.sections.map((s) => [s.id, s.bodyJson ?? null] as const)),
)

/** The import with its change hashes: a draft section's (`publishableHash` of what it
 *  would publish) and each published section's (`bodyHash` of the published body). */
async function withHashes(result: LegacyImport): Promise<LegacyImport> {
	const subject = result.document.subject
	// Bodies in the schema's normal form (every attribute's default written), as the
	// editor holds them: a section's first open in its room then changes nothing.
	const normal = (body: JsonNode | null | undefined) => (body ? normalBody(body) : null)
	return {
		...result,
		sections: await Promise.all(
			result.sections.map(async (s) => {
				const bodyJson = normal(s.bodyJson)
				return {
					...s,
					bodyJson,
					draftHash: await publishableHash(
						s.ownership === 'shared' && s.coreSectionId
							? normal(coreBodies.get(s.coreSectionId))
							: bodyJson,
						subject,
					),
				}
			}),
		),
		versionSections: await Promise.all(
			result.versionSections.map(async (vs) => {
				const bodyJson = normal(vs.bodyJson)
				return { ...vs, bodyJson, bodyHash: await bodyHash(bodyJson) }
			}),
		),
	}
}

const statements: string[] = []
/** The documents this run writes. */
const written: string[] = []
const emit = (result: LegacyImport) => {
	written.push(result.document.id)
	statements.push(...insert(schema.legacyDocuments, result.legacyDocument))
	for (const s of result.legacySections) {
		parseBody(s.bodyJson)
		statements.push(...insert(schema.legacySections, s))
	}
	statements.push(...insert(schema.documents, result.document))
	// A re-run must not leave sections of an earlier import behind.
	statements.push(
		`DELETE FROM sections WHERE document_id = ${q(result.document.id)} AND id NOT IN (${result.sections.map((s) => q(s.id)).join(', ')});`,
	)
	for (const s of result.sections) {
		if (s.bodyJson) parseBody(s.bodyJson)
		statements.push(...insert(schema.sections, s))
	}
	// The search index holds each owned section's words (server/search-index.ts); a shared
	// section is found through its core section.
	statements.push(`DELETE FROM section_search WHERE document_id = ${q(result.document.id)};`)
	for (const s of result.sections)
		if (s.ownership === 'owned')
			statements.push(
				`INSERT INTO section_search (section_id, document_id, title, body) VALUES (${q(s.id)}, ${q(result.document.id)}, ${q([s.printedNumber, s.title].filter(Boolean).join(' '))}, ${q(searchText(s.bodyJson ?? null).slice(0, 60_000))});`,
			)
	for (const r of result.references) statements.push(...insert(schema.references, r))
	for (const v of result.versions) statements.push(...insert(schema.versions, v))
	statements.push(
		`DELETE FROM version_sections WHERE version_id = ${q(result.versions[0]?.id ?? '')};`,
	)
	for (const vs of result.versionSections) {
		if (vs.bodyJson) parseBody(vs.bodyJson)
		statements.push(...insert(schema.versionSections, vs))
	}
	statements.push(
		`DELETE FROM section_origins WHERE section_id IN (${result.sections.map((s) => q(s.id)).join(', ')});`,
	)
	for (const o of result.origins) statements.push(...insert(schema.sectionOrigins, o))
}

const ledgerDir = join(appDir, 'legacy', 'ledgers')
mkdirSync(ledgerDir, { recursive: true })
/** The visual pass over each pathway's pages (decision 141), kept by hand beside the ledgers. */
const verificationPath = join(appDir, 'legacy', 'verification.json')
const verification: Record<string, unknown> = existsSync(verificationPath)
	? JSON.parse(readFileSync(verificationPath, 'utf8'))
	: {}
for (const pathway of targets) {
	const core = cores.get(pathway.audience)
	if (!core) throw new Error(`no core mapping for ${pathway.audience}`)
	const model = readModel('legacy/extracted', pathway.slug)
	const result = await withHashes(
		mapLegacy({
			model,
			pathway,
			core,
			id: deterministicId,
			orgId: `pending:${pathway.pathwaySlug}`,
			actorId: ACTOR,
		}),
	)
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
		`${JSON.stringify({ pathway: pathway.pathwaySlug, visualPass: verification[pathway.slug] ?? null, ...ledger, unplacedSections: result.sections.filter((s) => s.migrationNote).map((s) => ({ address: s.address, title: s.title, note: s.migrationNote })) }, null, '\t')}\n`,
	)
}

// A full seed also removes an import it no longer writes — a pathway renamed in the
// catalogue leaves its old document behind — but only one never finalised (its
// organisation still the placeholder); sections, versions and the rest cascade.
// Pathways only: the core documents wait on a placeholder too (`pending:central`).
if (which === 'all')
	statements.push(
		`DELETE FROM documents WHERE kind = 'pathway' AND org_id LIKE 'pending:%' AND id NOT IN (${written.map(q).join(', ')});`,
	)

const outDir = join(appDir, '.wrangler', 'seed')
mkdirSync(outDir, { recursive: true })
const outFlag = args.indexOf('--out')
const target =
	outFlag > 0 && args[outFlag + 1] ? args[outFlag + 1] : join(outDir, `legacy-${which}.sql`)
writeFileSync(target, `${statements.join('\n')}\n`)
console.log(`${statements.length} statements → ${target}`)
