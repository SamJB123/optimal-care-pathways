/**
 * Seeds the three 2026 templates as core-content documents: reads the extracted models
 * (`template/2026/extracted/<key>.model.json`, from `pnpm template:extract`), maps them
 * to the content schema with `mapTemplate` (the authors' "<hyperlink to be added>" notes
 * resolved into links), checks every body against the schema, and
 * writes one SQL file for wrangler to apply:
 *
 *   pnpm exec tsx scripts/seed-templates.ts [--out <file>]
 *   → .wrangler/seed/templates-2026.sql
 *
 * The same file seeds any deployment: the core documents are written owned by the
 * placeholder `pending:central`, and "Set up the central organisation" (bootstrapCentral,
 * the home page's first-run door) creates or finds the central organisation and adopts
 * them. A placeholder never counts as the central organisation (access.ts centralOrgId),
 * so after a re-seed the door is offered again. Rows are `INSERT OR REPLACE`, keyed by
 * deterministic ids, so re-running replaces the same rows. One statement per row keeps
 * every statement far below D1's per-statement size cap.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { publishableHash } from '../src/content/publish.ts'
import { normalBody, parseBody } from '../src/content/schema.ts'
import { searchText } from '../src/server/search-index.ts'
import { LEGACY_PATHWAYS } from '../src/legacy/catalogue.ts'
import { hyperlinkTargets } from '../src/template/extract/hyperlinks.ts'
import { mapTemplate } from '../src/template/extract/map-to-content.ts'
import type { ExtractedDocument } from '../src/template/extract/model.ts'
import type { SeedResult } from '../src/template/rows.ts'
import { TEMPLATES, templateByKey } from '../src/template/templates.ts'
import { deterministicId } from './ids.ts'

/** Who owns the core documents until the first-run door adopts them. */
const orgId = 'pending:central'

/** A section's words in the search index are capped well inside D1's statement size. */
const SEARCH_CHARS = 60_000

const dataDir = join(import.meta.dirname, '..', 'template', '2026', 'extracted')
const read = (key: string): ExtractedDocument =>
	JSON.parse(readFileSync(join(dataDir, `${key}.model.json`), 'utf8'))

const q = (value: string | number | boolean | null): string => {
	if (value === null) return 'NULL'
	if (typeof value === 'number') return String(value)
	if (typeof value === 'boolean') return value ? '1' : '0'
	return `'${value.replace(/'/g, "''")}'`
}

const insert = (table: string, row: Record<string, string | number | boolean | null>): string =>
	`INSERT OR REPLACE INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).map(q).join(', ')});`

const statements: string[] = []
/** Every seeded section row is stamped with the seed's own time: a document room that
 *  holds an older live body for the section sees the row moved and re-hydrates from it. */
const seededAt = Date.now()
const emit = async (seeded: SeedResult) => {
	// Bodies in the schema's normal form (every attribute's default written), as the
	// editor holds them: a section's first open in its room then changes nothing.
	const result: SeedResult = { ...seeded, sections: seeded.sections.map((s) => ({ ...s, bodyJson: normalBody(s.bodyJson) })) }
	const { template: t, document: d } = result
	statements.push(
		insert('templates', {
			id: t.id,
			kind: t.kind,
			label: t.label,
			source_file: t.sourceFile,
			issued_on: t.issuedOn,
			page_count: t.pageCount,
		}),
		insert('documents', {
			id: d.id,
			kind: d.kind,
			template_id: d.templateId,
			org_id: d.orgId,
			slug: d.slug,
			title: d.title,
			subject: d.subject,
			audience: d.audience,
			accent: d.accent,
			print_accent: d.accent,
		}),
	)
	// The search index holds each section's words (server/search-index.ts); rebuilt whole.
	statements.push(`DELETE FROM section_search WHERE document_id = ${q(d.id)};`)
	for (const s of result.sections)
		statements.push(
			`INSERT INTO section_search (section_id, document_id, title, body) VALUES (${q(s.id)}, ${q(d.id)}, ${q([s.printedNumber, s.title].filter(Boolean).join(' '))}, ${q(searchText(s.bodyJson).slice(0, SEARCH_CHARS))});`,
		)
	for (const s of result.sections) {
		parseBody(s.bodyJson) // throws on a body the content schema rejects
		statements.push(
			insert('sections', {
				id: s.id,
				document_id: s.documentId,
				parent_id: s.parentId,
				address: s.address,
				canonical: s.canonical,
				printed_number: s.printedNumber,
				title: s.title,
				heading_level: s.headingLevel,
				order_index: s.orderIndex,
				step_number: s.stepNumber,
				ownership: s.ownership,
				pathway_ownership: s.pathwayOwnership,
				apparatus: s.apparatus,
				instructions: s.instructions,
				body_json: JSON.stringify(s.bodyJson),
				source_pages: s.sourcePages,
				icon: s.icon,
				title_citations: s.titleCitations.length > 0 ? JSON.stringify(s.titleCitations) : null,
				draft_hash: await publishableHash(s.bodyJson, d.subject, 'template'),
				updated_at: seededAt,
			}),
		)
	}
	for (const r of result.references) {
		statements.push(
			insert('"references"', {
				id: r.id,
				document_id: r.documentId,
				citation: r.citation,
				url: r.url,
				printed_number: r.printedNumber,
			}),
		)
	}
}

/** Rows of the core documents the templates no longer produce (a section renamed or
 *  re-parented between extractor runs) are removed after the replace, so a reseed never
 *  leaves a stale section behind. Pathway sections are untouched. */
const prune = (results: SeedResult[]) => {
	const documentIds = results.map((r) => q(r.document.id)).join(', ')
	const sectionIds = results.flatMap((r) => r.sections.map((s) => q(s.id))).join(', ')
	const referenceIds = results.flatMap((r) => r.references.map((s) => q(s.id))).join(', ')
	statements.push(
		`DELETE FROM sections WHERE document_id IN (${documentIds}) AND id NOT IN (${sectionIds});`,
		`DELETE FROM "references" WHERE document_id IN (${documentIds}) AND id NOT IN (${referenceIds});`,
	)
}

// The authors' "<hyperlink to be added>" notes resolve against the Principles document's
// sections and the pathways' slugs (template/extract/hyperlinks.ts): the Principles are
// mapped once first to learn their sections. `scripts/hyperlink-resolutions.ts` lists
// what each note became.
const principles = templateByKey('principles')
const hyperlinks = hyperlinkTargets(
	mapTemplate({ model: read(principles.key), template: principles, orgId, id: deterministicId }),
	LEGACY_PATHWAYS,
)

const results: SeedResult[] = []
for (const template of TEMPLATES) {
	const model = read(template.key)
	const result = mapTemplate({ model, template, orgId, id: deterministicId, hyperlinks })
	results.push(result)
	await emit(result)
	const { stats } = result
	const resolved = result.hyperlinks.filter((h) => h.resolution.outcome === 'resolved').length
	console.log(
		`${template.key}: ${result.sections.length} sections, ${result.references.length} references; ` +
			`${stats.boxes} boxes, ${stats.variants} variant groups, ${stats.timeframes} timeframes, ${stats.tables} tables, ` +
			`${stats.checkItems} check items, ${stats.guidance} guidance, ${stats.citations} citations, ${stats.footnotes} footnotes, ` +
			`${stats.figures} figures, ${stats.links} links, ${stats.placeholders} placeholders; ` +
			`${result.hyperlinks.length} hyperlink notes, ${resolved} resolved`,
	)
}

prune(results)

const outDir = join(import.meta.dirname, '..', '.wrangler', 'seed')
mkdirSync(outDir, { recursive: true })
// `--out <file>` names the SQL file.
const outFlag = process.argv.indexOf('--out')
const target =
	outFlag > 0 && process.argv[outFlag + 1]
		? process.argv[outFlag + 1]
		: join(outDir, 'templates-2026.sql')
writeFileSync(target, `${statements.join('\n')}\n`)
console.log(`${statements.length} statements → ${target}`)
