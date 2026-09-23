/**
 * The corpus's own evidence for tight name lists (decision 141): the 2021 and population
 * pathways print their contributors and acknowledgements one entry per paragraph with a
 * gap between entries, so each paragraph there is a complete entry. The January-2020
 * pathways print the same kinds of list one entry per line with no gap, where a wrapped
 * name and a new entry look alike; the reader resolves such a line against this lexicon:
 *
 *   - entries: every complete entry (an organisation, or "Name, Role, Organisation");
 *   - roles: the clause that follows a person's name in entries that open with a title
 *     ("Medical Oncologist", "Consumer representative"), so that "Sylvia Van Dyk, Radiation
 *     Therapist, …" is known to open an entry although it carries no title;
 *   - names: the people those entries name, without their titles, so that a pathway that
 *     prints "Alexandra Viner, Project Associate" is known to open her entry.
 *
 *   pnpm exec tsx scripts/build-entry-lexicon.ts   → legacy/entries.json
 *
 * Reads legacy/extracted/<slug>.model.json (pnpm legacy:extract first). Regenerable.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LEGACY_PATHWAYS } from '../src/legacy/catalogue.ts'
import type { Block, ExtractedDocument, Section } from '../src/template/extract/model.ts'

const appDir = join(import.meta.dirname, '..')
const NAMES = /^(?:contributors|acknowledgements)/i
const HONORIFIC =
	/^(?:Prof\.?|Professor|Dr|Ms|Mr|Mrs|Miss|Mx|Assoc\.?|Associate|A\/Prof(?:essor)?|Adj\.?|Emeritus)\b/
/** Every title word an entry opens with ("Adj. A/Prof Dr", "Clinical Associate Professor"). */
const TITLES =
	/^(?:(?:Prof\.?|Professor|Dr|Ms|Mr|Mrs|Miss|Mx|Assoc\.?|Associate|A\/Prof(?:essor)?\.?|Adj\.?|Emeritus|Clinical|Conjoint|Honorary)\s+)+/

const entries = new Set<string>()
const roles = new Set<string>()
const names = new Set<string>()
const collect = (blocks: Block[]) => {
	for (const b of blocks) {
		if (b.kind === 'paragraph') {
			const text = b.runs
				.map((r) => r.text)
				.join('')
				.replace(/\s+/g, ' ')
				.trim()
			if (text.length < 4) continue
			entries.add(text)
			if (HONORIFIC.test(text)) {
				const [first, second] = text.split(/\s*,\s*/)
				const role = second?.replace(/\s*\(.*$/, '').trim()
				if (role && role.length >= 3 && role.length <= 60 && !/\d/.test(role)) roles.add(role)
				// The name: the first clause less its titles and any bracketed office ("(chair)").
				const name = first
					?.replace(TITLES, '')
					.replace(/\s*\(.*$/, '')
					.trim()
				if (name && /^\p{Lu}/u.test(name) && name.split(' ').length <= 4) names.add(name)
			}
		} else if (b.kind === 'list') for (const item of b.items) collect(item.blocks)
		else if (b.kind === 'table')
			for (const row of b.rows) for (const cell of row.cells) collect(cell.blocks)
	}
}
const walk = (sections: Section[]) => {
	for (const s of sections) {
		collect(s.blocks)
		walk(s.children)
	}
}
for (const pathway of LEGACY_PATHWAYS) {
	// The 2020 design's own lists are the ones in question: they are evidence for nothing.
	if (pathway.family === 'design-2020') continue
	const model: ExtractedDocument = JSON.parse(
		readFileSync(join(appDir, 'legacy', 'extracted', `${pathway.slug}.model.json`), 'utf8'),
	)
	for (const chapter of model.sections) if (NAMES.test(chapter.headingText.trim())) walk([chapter])
}
const out = { entries: [...entries].sort(), roles: [...roles].sort(), names: [...names].sort() }
writeFileSync(join(appDir, 'legacy', 'entries.json'), `${JSON.stringify(out, null, '\t')}\n`)
console.log(
	`${out.entries.length} entries, ${out.roles.length} roles, ${out.names.length} names → legacy/entries.json`,
)
