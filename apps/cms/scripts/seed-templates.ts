/**
 * Seeds the three 2026 templates as core-content documents: reads
 * `template/2026/*.tagged-canonical.json` (+ `.inline.json`), builds rows with
 * `seedTemplate`, checks every body against the content schema, and writes one SQL file
 * for wrangler to apply:
 *
 *   pnpm exec tsx scripts/seed-templates.ts --org-id <central organisation id>
 *   → .wrangler/seed/templates-2026.sql
 *
 * The central organisation must exist first (it owns core content), which is why its id
 * is an argument and not a constant. Rows are `INSERT OR REPLACE`, keyed by deterministic
 * ids, so re-running replaces the same rows. One statement per row keeps every statement
 * far below D1's per-statement size cap.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseBody } from '../src/content/schema.ts'
import type { CanonicalTemplate, InlineRuns } from '../src/template/canonical.ts'
import { type SeedResult, seedTemplate } from '../src/template/seed.ts'
import { deterministicId } from './ids.ts'

const DOCS = ['principles', 'cancer-template', 'population-template'] as const

const orgFlag = process.argv.indexOf('--org-id')
const orgId = orgFlag > 0 ? process.argv[orgFlag + 1] : undefined
if (!orgId) {
	console.error('usage: tsx scripts/seed-templates.ts --org-id <central organisation id>')
	process.exit(2)
}

const dataDir = join(import.meta.dirname, '..', 'template', '2026')
const read = <T>(name: string): T => JSON.parse(readFileSync(join(dataDir, name), 'utf8')) as T

const q = (value: string | number | boolean | null): string => {
	if (value === null) return 'NULL'
	if (typeof value === 'number') return String(value)
	if (typeof value === 'boolean') return value ? '1' : '0'
	return `'${value.replace(/'/g, "''")}'`
}

const insert = (table: string, row: Record<string, string | number | boolean | null>): string =>
	`INSERT OR REPLACE INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).map(q).join(', ')});`

const statements: string[] = []
const emit = (result: SeedResult) => {
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
		}),
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
				body_json: JSON.stringify(s.bodyJson),
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

for (const doc of DOCS) {
	const canonical = read<CanonicalTemplate>(`${doc}.tagged-canonical.json`)
	const inline = read<InlineRuns>(`${doc}.inline.json`)
	const result = seedTemplate({ canonical, inline, orgId, id: deterministicId })
	emit(result)
	const { stats } = result
	console.log(
		`${doc}: ${result.sections.length} sections, ${result.references.length} references; ` +
			`${stats.checkItems} check items, ${stats.citations} citations, ${stats.timeframes} timeframes, ` +
			`${stats.guidance} guidance boxes, ${stats.links} links, ${stats.placeholders} placeholders`,
	)
}

const outDir = join(import.meta.dirname, '..', '.wrangler', 'seed')
mkdirSync(outDir, { recursive: true })
const target = join(outDir, 'templates-2026.sql')
writeFileSync(target, `${statements.join('\n')}\n`)
console.log(`${statements.length} statements → ${target}`)
