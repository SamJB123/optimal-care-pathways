/**
 * Derives `template/2026/<doc>.inline.json` from the raw tagged extraction of each
 * template PDF: for every element whose own text differs from its subtree text (a
 * paragraph the extraction split into a paragraph block plus link or marker blocks),
 * the subtree text in reading order and the descendant runs it contains.
 *
 * One-time derivation, committed. Re-run only if the tagged extraction is redone:
 *
 *   pnpm exec tsx scripts/derive-inline-runs.ts <path to template-2026/extraction>
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { InlineRuns } from '../src/template/canonical.ts'

interface TaggedElement {
	seq: number
	text: string
	subtreeText: string
	childSeqs: number[]
}

const FILES: Record<string, string> = {
	'attachment-a': 'principles',
	'attachment-b': 'cancer-template',
	'attachment-c': 'population-template',
}

const extractionDir = process.argv[2]
if (!extractionDir) {
	console.error('usage: tsx scripts/derive-inline-runs.ts <extraction dir>')
	process.exit(2)
}

for (const [file, doc] of Object.entries(FILES)) {
	const tagged = JSON.parse(readFileSync(join(extractionDir, `${file}.tagged.json`), 'utf8')) as {
		elements: TaggedElement[]
	}
	const bySeq = new Map(tagged.elements.map((e) => [e.seq, e]))
	const out: InlineRuns = {}
	let unplaced = 0
	for (const element of tagged.elements) {
		const children = element.childSeqs
		if (children.length === 0 || !element.text || element.text === element.subtreeText) continue
		// Descendants with text of their own, depth-first, in document order.
		const parts: { seq: number; text: string }[] = []
		const walk = (seqs: number[]) => {
			for (const seq of seqs) {
				const child = bySeq.get(seq)
				if (!child) continue
				if (child.text) parts.push({ seq, text: child.text })
				walk(child.childSeqs)
			}
		}
		walk(children)
		// Keep only parts that can be located in reading order.
		let cursor = 0
		const placed = parts.filter((part) => {
			const at = element.subtreeText.indexOf(part.text, cursor)
			if (at < 0) {
				unplaced++
				return false
			}
			cursor = at + part.text.length
			return true
		})
		out[element.seq] = { text: element.subtreeText, parts: placed }
	}
	const target = join(import.meta.dirname, '..', 'template', '2026', `${doc}.inline.json`)
	writeFileSync(target, `${JSON.stringify(out)}\n`)
	console.log(
		`${doc}: ${Object.keys(out).length} paragraphs, ${unplaced} runs not locatable → ${target}`,
	)
}
