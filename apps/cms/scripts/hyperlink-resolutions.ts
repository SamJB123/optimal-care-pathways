/**
 * The resolution list: every "<hyperlink to be added>" note in the three 2026 templates,
 * in document and section order, with the sentence around it and what the seed makes of
 * it — a link or cross-reference (and to where), or left as printed (and why). Maps the
 * templates exactly as `seed-templates.ts` does, with the same resolver; reads the
 * extracted models and writes two files, never a database:
 *
 *   pnpm exec tsx scripts/hyperlink-resolutions.ts [--out <dir>]
 *   → .wrangler/seed/hyperlinks/resolution.html and resolution.json
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LEGACY_PATHWAYS } from '../src/legacy/catalogue.ts'
import { type HyperlinkRule, hyperlinkTargets } from '../src/template/extract/hyperlinks.ts'
import { type MappedTemplate, mapTemplate } from '../src/template/extract/map-to-content.ts'
import type { ExtractedDocument } from '../src/template/extract/model.ts'
import { TEMPLATES, templateByKey } from '../src/template/templates.ts'
import { deterministicId } from './ids.ts'

const orgId = 'pending:central'
const dataDir = join(import.meta.dirname, '..', 'template', '2026', 'extracted')
const read = (key: string): ExtractedDocument =>
	JSON.parse(readFileSync(join(dataDir, `${key}.model.json`), 'utf8'))

const principles = templateByKey('principles')
const hyperlinks = hyperlinkTargets(
	mapTemplate({ model: read(principles.key), template: principles, orgId, id: deterministicId }),
	LEGACY_PATHWAYS,
)
const mapped: MappedTemplate[] = TEMPLATES.map((template) =>
	mapTemplate({ model: read(template.key), template, orgId, id: deterministicId, hyperlinks }),
)

const RULE_LABELS: Record<HyperlinkRule, string> = {
	principle: 'A Principle → its section of the Principles',
	document: 'The Principles document → its published page',
	pathway: 'A named pathway → its published page',
	step: 'A step → cross-reference to that step',
	section: 'A numbered section → cross-reference to it',
}

const documents = mapped.map((m) => ({
	title: m.document.title,
	slug: m.document.slug,
	occurrences: m.hyperlinks.map((h) => ({
		section: { address: h.address, printedNumber: h.printedNumber, title: h.title },
		text: h.text,
		...(h.resolution.outcome === 'resolved'
			? {
					outcome: 'resolved' as const,
					rule: h.resolution.rule,
					words: h.resolution.words,
					target: h.resolution.target,
				}
			: { outcome: 'left' as const, reason: h.resolution.reason }),
	})),
}))
const all = documents.flatMap((d) => d.occurrences)
const byRule = Object.fromEntries(
	Object.keys(RULE_LABELS).map((rule) => [
		rule,
		all.filter((o) => o.outcome === 'resolved' && o.rule === rule).length,
	]),
)
const counts = {
	total: all.length,
	resolved: all.filter((o) => o.outcome === 'resolved').length,
	left: all.filter((o) => o.outcome === 'left').length,
	byRule,
}

const escapeHtml = (value: string) =>
	value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

type Listed = (typeof documents)[number]

const sectionLabel = (s: { address: string; printedNumber: string | null; title: string | null }) =>
	[s.printedNumber, s.title].filter(Boolean).join(' ') || s.address

const outcomeCell = (o: Listed['occurrences'][number]): string => {
	if (o.outcome === 'left') return `<strong>Left as is.</strong> ${escapeHtml(o.reason)}`
	const where =
		o.target.kind === 'link'
			? `link <code>${escapeHtml(o.target.href)}</code>`
			: `cross-reference <code>${escapeHtml(o.target.address)}</code> <span class="muted">(in the showing document)</span>`
	return `${escapeHtml(o.target.name)}<br>${where}<br><span class="muted">on “${escapeHtml(o.words)}”</span>`
}

const rowOf = (o: Listed['occurrences'][number], i: number): string =>
	`<tr${o.outcome === 'left' ? ' class="left"' : ''}><td>${i + 1}</td><td>${escapeHtml(sectionLabel(o.section))}<br><code>${escapeHtml(o.section.address)}</code></td><td>${escapeHtml(o.text)}</td><td>${outcomeCell(o)}</td></tr>`

const documentHtml = (d: Listed): string => {
	const left = d.occurrences.filter((o) => o.outcome === 'left').length
	return `<h2>${escapeHtml(d.title)} <span class="muted">(${d.occurrences.length} notes, ${left} left as is)</span></h2>
<div class="wrap"><table>
<thead><tr><th>#</th><th>Section</th><th>Sentence</th><th>Resolves to</th></tr></thead>
<tbody>
${d.occurrences.map(rowOf).join('\n')}
</tbody>
</table></div>`
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hyperlink resolutions</title>
<style>
:root { --bg: #ffffff; --ink: #1d2433; --muted: #5b6475; --rule: #d9dde5; --left: #fff4d6; --code: #eef1f6; }
@media (prefers-color-scheme: dark) { :root { --bg: #151922; --ink: #e6e9ef; --muted: #9aa3b2; --rule: #2e3543; --left: #3a3220; --code: #232a36; } }
body { background: var(--bg); color: var(--ink); font: 15px/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 1200px; padding: 24px 16px; }
h1 { font-size: 1.5rem; margin: 0 0 8px; }
h2 { font-size: 1.2rem; margin: 32px 0 8px; }
p.note, .muted { color: var(--muted); }
table { border-collapse: collapse; width: 100%; }
th, td { border-bottom: 1px solid var(--rule); padding: 6px 8px; text-align: left; vertical-align: top; }
th { font-size: 0.85rem; color: var(--muted); font-weight: 600; }
tr.left td { background: var(--left); }
code { background: var(--code); border-radius: 3px; padding: 0 3px; font-size: 0.85em; overflow-wrap: anywhere; }
.counts td { border: none; padding: 2px 12px 2px 0; }
.wrap { overflow-x: auto; }
</style>
</head>
<body>
<h1>“&lt;hyperlink to be added&gt;” in the 2026 templates</h1>
<p class="note">What the seed makes of each note. A resolved note becomes a link on the words before it and the note’s text is removed; a note left as is stays exactly as printed. Cross-references are typed by address, so a core section shared into a pathway points at that pathway’s own step.</p>
<table class="counts">
<tr><td><strong>${counts.total}</strong></td><td>notes</td></tr>
<tr><td><strong>${counts.resolved}</strong></td><td>resolved</td></tr>
${Object.entries(RULE_LABELS)
	.map(
		([rule, label]) =>
			`<tr><td>&nbsp;&nbsp;${byRule[rule] ?? 0}</td><td class="muted">${escapeHtml(label)}</td></tr>`,
	)
	.join('\n')}
<tr><td><strong>${counts.left}</strong></td><td>left as is</td></tr>
</table>
${documents.map(documentHtml).join('\n')}
</body>
</html>
`

// `--out <dir>` names the directory.
const outFlag = process.argv.indexOf('--out')
const outDir =
	outFlag > 0 && process.argv[outFlag + 1]
		? process.argv[outFlag + 1]
		: join(import.meta.dirname, '..', '.wrangler', 'seed', 'hyperlinks')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'resolution.html'), html)
writeFileSync(
	join(outDir, 'resolution.json'),
	`${JSON.stringify({ counts, documents }, null, '\t')}\n`,
)
console.log(
	`${counts.total} notes: ${counts.resolved} resolved, ${counts.left} left as is → ${outDir}`,
)
