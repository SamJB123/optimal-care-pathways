/**
 * Coverage audit of a legacy extraction against its PDF: every printed word placed once.
 *
 *   pnpm exec tsx scripts/audit-legacy.ts <slug|all> [--pdf-dir <dir>] [--max <lines>] [--figure-lines]
 *
 * Reads legacy/extracted/<slug>.model.json (run extract-legacy.ts first). Exits 1 when
 * any word is missing or placed twice. `--figure-lines` lists the printed lines the model
 * carries only as figure lettering — the one class of text the count excuses, so it is
 * read by eye against the page.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LEGACY_PATHWAYS, legacyBySlug } from '../src/legacy/catalogue.ts'
import { auditCoverage, formatReport } from '../src/legacy/audit.ts'
import type { ExtractedDocument } from '../src/template/extract/model.ts'
import { openPdf } from '../src/template/extract/pdf-page.ts'

const args = process.argv.slice(2)
const which = args[0]
if (!which) {
	console.error('usage: tsx scripts/audit-legacy.ts <slug|all> [--pdf-dir <dir>] [--max <lines>]')
	process.exit(2)
}
const flag = (name: string) => {
	const at = args.indexOf(name)
	return at > 0 ? args[at + 1] : undefined
}
const appDir = join(import.meta.dirname, '..')
const pdfDir = flag('--pdf-dir') ?? join(appDir, 'legacy', 'source')
const maxLines = Number(flag('--max') ?? 60)

const targets =
	which === 'all' ? LEGACY_PATHWAYS : [legacyBySlug(which)].flatMap((p) => (p ? [p] : []))
if (targets.length === 0) {
	console.error(`unknown pathway "${which}"`)
	process.exit(2)
}

let failed = false
for (const pathway of targets) {
	const model: ExtractedDocument = JSON.parse(
		readFileSync(join(appDir, 'legacy', 'extracted', `${pathway.slug}.model.json`), 'utf8'),
	)
	const doc = await openPdf(join(pdfDir, pathway.file))
	const report = await auditCoverage(doc, model)
	console.log(`${pathway.slug}: ${formatReport(report, { maxLines })}`)
	if (args.includes('--figure-lines'))
		for (const l of report.figureLines) console.log(`  p.${l.page} FIGURE ← ${l.text}`)
	if (report.missingLines.length > 0 || report.extras.length > 0) failed = true
}
process.exit(failed ? 1 : 0)
