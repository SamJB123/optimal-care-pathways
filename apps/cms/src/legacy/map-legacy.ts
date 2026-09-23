/**
 * Stage three for the legacy pathways (decisions 129–140): one legacy document model →
 * everything that sets the pathway up in the CMS.
 *
 *   - the PATHWAY document, its DRAFT sections (the template kind's core spine, shared
 *     sections by reference, owned sections as the pathway's draft) with the legacy text
 *     placed into them, and the sections the template has no slot for appended under
 *     the step they came from and flagged (`migration_note`);
 *   - version 1, PUBLISHED, as the legacy edition — every legacy section frozen as it
 *     was printed — and version 2, the open draft;
 *   - the pathway's REFERENCES, read from the legacy References list, with the body's
 *     author–year citations ("(ACSQHC 2019a)") turned into citation atoms that name them;
 *   - the LEGACY document and its sections, verbatim, for the /legacy reader and the
 *     inspector's "the previous edition said", joined to the draft by `section_origins`.
 *
 * WHERE LEGACY TEXT GOES. A legacy step section is matched to the template's sections of
 * the same step BY TITLE (the numbering schemes differ: legacy 1.3 Risk reduction is the
 * template's 1.1.2 Risk reduction strategies). An owned match takes the text; a shared
 * match keeps the core text and records the legacy section as provenance, its text going
 * to the best-matching owned child or to a new section beside it, flagged 'proposed'.
 * Front and back matter follow the sandbox record's rules (compile_mappings.py, 2026):
 * the preface, publication details, the snapshot of timeframes, contributors, and
 * everything else into Find out more. A legacy "Timeframe for …" subsection becomes a
 * timeframe box in its parent's destination; a "More information" subsection a resources
 * box; the quick reference guide's ❏ checklists become point-of-care check items in a
 * Checklist section of their step. Figures 1–3 are derived views and are not imported;
 * the contents page is derived and dropped.
 */

import type { JsonNode } from '#/content/schema.ts'
import type * as schema from '#/db/schema.ts'
import type { SeedResult, SectionRow as CoreSectionRow } from '#/template/rows.ts'
import type { Block, ExtractedDocument, Paragraph, Section, Table } from '../template/extract/model.ts'
import { plainText } from '../template/extract/model.ts'
import { createBlockMapper } from '../template/extract/map-to-content.ts'
import { type LegacyPathway, legacyFigureUrl } from './catalogue.ts'

export type DocumentInsert = typeof schema.documents.$inferInsert
export type SectionInsert = typeof schema.sections.$inferInsert
export type VersionInsert = typeof schema.versions.$inferInsert
export type VersionSectionInsert = typeof schema.versionSections.$inferInsert
export type ReferenceInsert = typeof schema.references.$inferInsert
export type LegacyDocumentInsert = typeof schema.legacyDocuments.$inferInsert
export type LegacySectionInsert = typeof schema.legacySections.$inferInsert
export type OriginInsert = typeof schema.sectionOrigins.$inferInsert

export interface LegacyImportInput {
	model: ExtractedDocument
	pathway: LegacyPathway
	/** The template kind's core mapping: the spine the pathway is scaffolded from. */
	core: SeedResult
	/** Deterministic id for a (kind, key) pair. */
	id: (kind: string, key: string) => string
	/** The pathway's organisation. A placeholder (`pending:<slug>`) until the admin door
	 *  creates the real one. */
	orgId: string
	/** Who the versions record as creator and publisher (the import). */
	actorId: string
}

export type PlacementHow =
	| 'title'
	| 'title-child'
	| 'rule'
	| 'timeframe'
	| 'timeframe-row'
	| 'resources'
	| 'guide'
	| 'merged'
	| 'provenance'
	| 'derived'
	| 'proposed'
	| 'unplaced'
	/** Legacy text of a shared template section: version 1 carries it as a divergence of
	 *  that section; the draft carries the core text (decisions 153, 157). */
	| 'diverged'

export interface Placement {
	legacyKey: string
	legacyTitle: string
	/** The draft section's address that received the text (or the provenance). */
	destination: string | null
	how: PlacementHow
	note?: string
}

export interface Ledger {
	edition: string | null
	publicationDate: string | null
	placements: Placement[]
	/** Resolved citations; the misses with their reasons; and the ones resolved to the
	 *  list's only entry for the author when the printed year matches none. */
	citations: { matched: number; unmatched: string[]; byName: string[] }
	/** Rows the summary timeframes table printed, and how each was met: by a timeframe box
	 *  the body's own subsection made, or by a box created from the row (decision 148). */
	timeframes: { figureRows: number; boxes: number; rows: { step: number | null; carePoint: string; source: 'body' | 'row'; destination: string | null }[] }
	checkItems: number
}

export interface LegacyImport {
	document: DocumentInsert
	sections: SectionInsert[]
	versions: VersionInsert[]
	versionSections: VersionSectionInsert[]
	references: ReferenceInsert[]
	legacyDocument: LegacyDocumentInsert
	legacySections: LegacySectionInsert[]
	origins: OriginInsert[]
	ledger: Ledger
}

// ---------------------------------------------------------------------------
// The legacy document as identities
// ---------------------------------------------------------------------------

/** A legacy section with its identity key, the sandbox record's scheme: a chapter key
 *  ('step-3', 'appendix-b'), then slugs of the headings beneath ('step-3/staging'). */
interface LegacyNode {
	id: string
	key: string
	parentKey: string | null
	l1: string
	level: number
	orderIndex: number
	heading: string
	number: string | null
	blocks: Block[]
	page: number
	children: LegacyNode[]
	/** The pages this node's own blocks span, as the seed prints them. */
	pages: string
}

const slugify = (value: string): string =>
	value
		.toLowerCase()
		.replace(/[’']/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64) || 'section'

const STEP = /^Step\s+(\d)\b/i

/** The chapter key a legacy chapter heading names. */
function l1KeyOf(heading: string): string {
	const h = heading.trim().toLowerCase()
	if (/^contents$/.test(h)) return 'contents'
	if (/^(welcome|foreword)/.test(h)) return 'welcome-and-introduction'
	if (/^summary\s*[–—-]\s*optimal timeframes/.test(h)) return 'summary-timeframes'
	if (/^summary$/.test(h)) return 'summary'
	if (/^intent of/.test(h)) return 'intent'
	if (/^principles/.test(h)) return 'principles-intro'
	if (/^optimal (cancer )?care pathway$/.test(h)) return 'pathway-note'
	if (/^(contributors|acknowledgements)/.test(h)) return 'contributors'
	if (/^scope$/.test(h)) return 'scope'
	if (/^context$/.test(h)) return 'context'
	if (/further considerations/.test(h)) return 'further-considerations'
	const appendix = /^appendix(?:\s+([a-z]))?\b/.exec(h)
	if (appendix) return appendix[1] ? `appendix-${appendix[1]}` : 'appendix-a'
	if (/^resource list/.test(h)) return 'resource-list'
	if (/^glossary/.test(h)) return 'glossary'
	if (/^abbreviations/.test(h)) return 'abbreviations'
	if (/^references/.test(h)) return 'references'
	return slugify(h)
}

/** The key of a child under its parent: principles and steps by number, the rest by slug. */
function childKeyOf(parent: LegacyNode, section: Section): string {
	const principle = /^Principle\s+(\d)\b/i.exec(section.headingText)
	if (parent.l1 === 'principles-intro' && principle) return `principle-${principle[1]}`
	const step = STEP.exec(section.headingText)
	if (parent.l1 === 'pathway-note' && step) return `step-${step[1]}`
	if (parent.l1 === 'summary' && step) return `summary/step-${step[1]}`
	if (parent.l1 === 'intent' && /^optimal care pathway resources$/i.test(section.headingText.trim())) return 'resources'
	return `${parent.key}/${slugify(titleOf(section.headingText, section.number))}`
}

/** The heading without its printed number. */
function titleOf(headingText: string, number: string | null): string {
	const text = headingText.replace(/\s+/g, ' ').trim()
	if (!number) return text
	// The number as printed may carry a stray space after a stop ("3. 6 Support …").
	const escaped = number
		.split('.')
		.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
		.join('\\.\\s?')
	return text.replace(new RegExp(`^${escaped}:?\\s*`, 'i'), '').trim() || text
}

function pagesOf(section: { page: number; blocks: Block[] }): string {
	let last = section.page
	const visit = (blocks: Block[]) => {
		for (const b of blocks) {
			if ('page' in b) last = Math.max(last, b.page)
			if (b.kind === 'list') for (const item of b.items) visit(item.blocks)
			else if (b.kind === 'table') for (const row of b.rows) for (const cell of row.cells) visit(cell.blocks)
		}
	}
	visit(section.blocks)
	return last > section.page ? `${section.page}-${last}` : `${section.page}`
}

const textOfBlocks = (blocks: Block[]): string => {
	const out: string[] = []
	const visit = (list: Block[]) => {
		for (const b of list) {
			if (b.kind === 'paragraph') out.push(plainText(b.runs))
			else if (b.kind === 'list') for (const item of b.items) visit(item.blocks)
			else if (b.kind === 'table') for (const row of b.rows) for (const cell of row.cells) visit(cell.blocks)
			else out.push(b.alt)
		}
	}
	visit(blocks)
	return out.join('\n')
}

/**
 * The legacy tree as identity nodes. The front matter (title page, acknowledgement,
 * imprint) is one chapter each of the sandbox record's three identities.
 */
function legacyTree(model: ExtractedDocument, id: (kind: string, key: string) => string, slug: string): LegacyNode[] {
	const nodes: LegacyNode[] = []
	const nodeId = (key: string) => id('legacy-section', `${slug}:${key}`)
	const frontBlocks = model.front
	const isAcknowledgement = (b: Block) => b.kind === 'paragraph' && /^statement of acknowledgement/i.test(plainText(b.runs).trim())
	const isImprint = (b: Block) => b.kind === 'paragraph' && /^(first published|this edition published|isbn|published by|©)/i.test(plainText(b.runs).trim())
	const ackAt = frontBlocks.findIndex(isAcknowledgement)
	const imprintAt = frontBlocks.findIndex((b, i) => i > (ackAt < 0 ? -1 : ackAt) && isImprint(b))
	const front: [string, string, Block[]][] = [
		['front-matter', 'Front matter', frontMatterAsPrinted(frontBlocks.slice(0, ackAt < 0 ? (imprintAt < 0 ? frontBlocks.length : imprintAt) : ackAt), model.title)],
		['acknowledgement', 'Statement of acknowledgement', ackAt < 0 ? [] : frontBlocks.slice(ackAt, imprintAt < 0 ? frontBlocks.length : imprintAt)],
		['isbn', 'Publication details', imprintAt < 0 ? [] : frontBlocks.slice(imprintAt)],
	]
	let order = 0
	for (const [key, heading, blocks] of front) {
		if (blocks.length === 0) continue
		const page = blocks.map((b) => ('page' in b ? b.page : 1)).reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY)
		nodes.push({
			id: nodeId(key),
			key,
			parentKey: null,
			l1: key,
			level: 1,
			orderIndex: order++,
			heading,
			number: null,
			blocks,
			page: Number.isFinite(page) ? page : 1,
			children: [],
			pages: pagesOf({ page: Number.isFinite(page) ? page : 1, blocks }),
		})
	}
	const visit = (section: Section, parent: LegacyNode | null, index: number): LegacyNode => {
		const key = parent ? childKeyOf(parent, section) : l1KeyOf(section.headingText)
		const node: LegacyNode = {
			id: nodeId(key),
			key,
			parentKey: parent?.key ?? null,
			l1: parent?.l1 ?? key,
			level: section.level,
			orderIndex: index,
			heading: section.headingText.replace(/\s+/g, ' ').trim(),
			number: section.number,
			blocks: section.blocks,
			page: section.page,
			children: [],
			pages: pagesOf(section),
		}
		node.children = section.children.map((child, i) => visit(child, node, i))
		return node
	}
	for (const [i, section] of model.sections.entries()) nodes.push(visit(section, null, order + i))
	return nodes
}

const flatten = (nodes: LegacyNode[]): LegacyNode[] => nodes.flatMap((n) => [n, ...flatten(n.children)])

/** The cover's letter-spaced edition ("S E C O N D E D I T I O N") as words. */
const EDITION_WORDS: Record<string, string> = { first: 'First edition', second: 'Second edition', third: 'Third edition', fourth: 'Fourth edition' }
function editionWords(text: string): string | null {
	const compact = text.replace(/\s+/g, '').toLowerCase()
	const m = /^(first|second|third|fourth)edition$/.exec(compact)
	return m?.[1] ? (EDITION_WORDS[m[1]] ?? null) : null
}

/**
 * The cover and title page as one statement each (decision 145): the title is the
 * document's, an edition line reads as words, and a line printed on both pages appears
 * once.
 */
function frontMatterAsPrinted(blocks: Block[], title: string): Block[] {
	const seen = new Set<string>([title.replace(/\s+/g, ' ').trim().toLowerCase()])
	const out: Block[] = []
	for (const b of blocks) {
		if (b.kind !== 'paragraph') {
			out.push(b)
			continue
		}
		const text = plainText(b.runs).replace(/\s+/g, ' ').trim()
		const edition = editionWords(text)
		const key = (edition ?? text).toLowerCase()
		if (seen.has(key)) continue
		seen.add(key)
		out.push(edition ? { ...b, runs: [{ ...(b.runs[0] ?? { text: '', bold: false, italic: false, underline: false, superscript: false, subscript: false, size: 0, colour: '#000000', background: null, link: null, footnote: null, endnote: null }), text: edition }] } : b)
	}
	return out
}

// ---------------------------------------------------------------------------
// References and author–year citations
// ---------------------------------------------------------------------------

interface ReferenceEntry {
	id: string
	citation: string
	url: string | null
	/** Keys the in-text form can name: "acsqhc 2019a", "wildiers 2014", "silver baima 2013". */
	keys: Set<string>
	/** The entry's printed number in a numbered list (cited by raised numbers). */
	number?: number
}

const normaliseKey = (value: string): string =>
	value
		// Accents fold to their letter ("Gómez-Moreno", "Döhner"), never to a word break.
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[’']/g, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()

/** The entry's year token, with its letter ("2019a"). */
const YEAR = /\b((?:19|20)\d\d[a-z]?)\b/

/** A surname as a reference list prints it, with its particles: "van Weert", "Høilund-Carlsen". */
const PARTICLES = String.raw`(?:(?:de|del|den|der|da|di|la|le|van|von)\s)*`
const SURNAME = new RegExp(String.raw`^${PARTICLES}\p{Lu}[\p{L}’'-]+(?:\s${PARTICLES}\p{Lu}[\p{L}’'-]+)?$`, 'u')

/** Author–year keys for one printed reference entry. */
function referenceKeys(citation: string): Set<string> {
	const keys = new Set<string>()
	const year = YEAR.exec(citation)
	if (!year) return keys
	const y = year[1]?.toLowerCase() ?? ''
	const head = citation.slice(0, year.index).trim().replace(/,\s*$/, '')
	// A name's "and" or "&" is dropped, as the in-text form's is (partKeys): "Cancer Council
	// Australia Barrett’s Oesophagus and Early Oesophageal Adenocarcinoma Working Party".
	const nameKey = (name: string) => normaliseKey(name.replace(/\s+&\s+|\s+and\s+/g, ' '))
	// Organisations with their abbreviations: "…Health Care (ACSQHC)", "…(ASCO) & …(ESMO)",
	// "US Department of Health and Human Services (US DHHS)".
	const abbreviations = [...head.matchAll(/\(([A-Za-z]{2,}(?:\s[A-Za-z]{2,})*)\)/g)].map((m) => m[1] ?? '')
	const named = abbreviations.length > 0 ? nameKey(head.replace(/\s*\([^)]*\)/g, '')) : nameKey(head)
	if (abbreviations.length > 0) keys.add(`${abbreviations.map(normaliseKey).join(' ')} ${y}`)
	keys.add(`${named} ${y}`)
	// The in-text form drops one-letter words ("John A Hartford Foundation", "I-Med"), as it
	// drops stray initials (partKeys); so does this key.
	const words = named.split(' ')
	if (words.length > 1 && words.some((w) => w.length === 1)) keys.add(`${words.filter((w) => w.length > 1).join(' ')} ${y}`)
	// Personal authors: "Wildiers H, Heeren P, Puts M, …, et al." — surnames are the words
	// before each initials group; the in-text form names one, two, or the first with "et al.".
	// Nothing after "et al." names an author (a trial group's name follows it).
	// Initials may stand apart ("Averyt, J, Nishimoto, PW") or be hyphenated ("Pui C-H").
	const INITIALS = /^\p{Lu}(?:-?\p{Lu}){0,2}$/u
	const authors = head
		.replace(/\bet al\.?[\s\S]*$/i, '')
		.split(/,\s*|\s+&\s+|\s+and\s+/)
		.map((a) => a.trim())
		.filter((a) => a && !INITIALS.test(a))
	const surnames = authors.map((a) => a.replace(/\s+\p{Lu}(?:-?\p{Lu}){0,2}$/u, '').trim()).filter((s) => SURNAME.test(s))
	if (surnames.length > 0 && surnames.length === authors.length) {
		const first = normaliseKey(surnames[0] ?? '')
		keys.add(`${first} ${y}`)
		if (surnames.length === 2) keys.add(`${first} ${normaliseKey(surnames[1] ?? '')} ${y}`)
	}
	return keys
}

/** A citation as printed in the text — "(COSA 2013; palliAGED 2018)", "[WHO 2018]" (also
 *  inside a parenthesis: "(… may also be malnourished [WHO 2018])"), or a year alone
 *  after the author's name: "Fitch’s (2000) model". Brackets are matched first so a
 *  bracketed citation inside a parenthetical aside is found on its own. */
const IN_TEXT = /\[([^[\]]*?(?:19|20)\d\d[a-z]?(?![0-9])[^[\]]*)\]|\(([^()[\]]*?(?:19|20)\d\d[a-z]?(?![0-9])[^()[\]]*)\)/g
/** The name a year-only citation belongs to, at the end of the text before it. */
const NAME_BEFORE = /([A-Z][A-Za-z’'-]+(?:\s(?:&|and)\s[A-Z][A-Za-z’'-]+)?(?:\set al\.?)?)[’']?s?\s*$/
/** A name as the text cites it: capitalised words, particles, "&" or "and", "et al.". */
const CITED_NAME = String.raw`(?:\p{Lu}[\p{L}’'-]*|de|del|den|der|da|di|la|le|van|von|&|and|et al\.?)(?:\s(?:\p{Lu}[\p{L}’'-]*|de|del|den|der|da|di|la|le|van|von|&|and|et al\.?))*`
/** The comma between two citations in one parenthesis ("AIHW 2018, Brewster et al. 2014"):
 *  a name and a year follow it. A comma before a bare year ("2018a, 2018b") is not one. */
const CITATION_COMMA = new RegExp(String.raw`,\s*(?=${CITED_NAME}\s(?:19|20)\d\d)`, 'u')
/** Two citations the print ran together with no separator ("Jaenke et al. 2021 Whop et al.
 *  2022"): a year, then a capitalised name and its year. */
const CITATION_RUN_ON = new RegExp(String.raw`(?<=(?:19|20)\d\d[a-z]?)\s+(?=\p{Lu}[\p{L}’'-]+(?:\s(?:\p{Lu}[\p{L}’'-]*|&|and|et al\.?))*\s(?:19|20)\d\d)`, 'u')
/** Words a citation may open with that name no author: "adapted from Fizazi et al. 2015". */
const CITATION_PREFIX = /^(?:adapted\s+from|summarised\s+in|reviewed\s+in|see\s+table\s+\d+\s+in|from|see|e\.g\.|cf\.|source|in)\s*:?\s+/i
/** A month and year in parentheses: a date, not a citation. */
const MONTH_YEAR = /^(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+(?:19|20)\d\d$/i

/** One part's key(s): "Wildiers et al. 2014" → "wildiers 2014"; "Laidsaar-Powell et al.
 *  2018a, 2018b" → two keys; "Vijayvergia & Denlinger 2015" → "vijayvergia denlinger 2015". */
function partKeys(part: string): string[] {
	const cleaned = part.replace(CITATION_PREFIX, '').replace(/\*+$/, '')
	const years = [...cleaned.matchAll(/((?:19|20)\d\d[a-z]?)(?![0-9])/g)].map((m) => m[1]?.toLowerCase() ?? '')
	if (years.length === 0) return []
	const at = cleaned.search(/(?:19|20)\d\d/)
	// "et al." (or its misprints "el al", "at al") and stray initials ("Simms K T") name no author.
	const head = cleaned
		.slice(0, at)
		.replace(/\b(?:et|el|at) al\.?/i, '')
		.replace(/\s+&\s+|\s+and\s+/g, ' ')
	const words = normaliseKey(head).split(' ').filter(Boolean)
	const name = (words.length > 1 ? words.filter((w) => w.length > 1) : words).join(' ')
	if (!name) return []
	return years.map((y) => `${name} ${y}`)
}

interface CitationIndex {
	byKey: Map<string, ReferenceEntry>
	matched: number
	unmatched: string[]
	/** Citations resolved to the list's only entry for that author, the printed year
	 *  differing — the print's own slip, recorded (decision 147). */
	byName: string[]
}

/** The entry a key names: its own, or — for an organisation the text names by the head of
 *  its title ("Australian Cancer Network 2009" for the Network's working party) — the one
 *  entry of that year whose key begins with it. */
function lookup(index: CitationIndex, key: string): ReferenceEntry | null {
	const exact = index.byKey.get(key)
	if (exact) return exact
	const m = /^(.*)\s((?:19|20)\d\d[a-z]?)$/.exec(key)
	if (!m?.[1] || !m[2]) return null
	const [, name, year] = m
	const sameYear = [...index.byKey.entries()].filter(([k]) => k.endsWith(` ${year}`))
	const found = new Set(sameYear.filter(([k]) => k.startsWith(`${name} `)).map(([, e]) => e))
	if (found.size === 1) return [...found][0] ?? null
	// An organisation cited by its initials ("WHO 2018") when the list spells its name out.
	if (/^[a-z]{2,7}$/.test(name)) {
		const byInitials = new Set(sameYear.filter(([k]) => initialsOf(k.slice(0, -(year.length + 1))) === name).map(([, e]) => e))
		if (byInitials.size === 1) return [...byInitials][0] ?? null
	}
	// An organisation cited by its full name whose entry carries its abbreviation under
	// another spelling: "British Society of Haematology 2020" is "British Society for
	// Haematology (BSH) 2020".
	if (name.includes(' ')) {
		const byAbbreviation = index.byKey.get(`${initialsOf(name)} ${year}`)
		if (byAbbreviation) return byAbbreviation
	}
	// An organisation cited under another form of its name: "Australian Government Department
	// of Health 2017" for the list's "Commonwealth Department of Health 2017" — the same year,
	// the same last three words or more, and one such entry. A name of one distinctive word
	// is that word ("HealthInfoNet 2024" for "Australian Indigenous HealthInfoNet 2024").
	const cited = name.split(' ')
	const needed = cited.length >= 3 ? 3 : cited.length === 1 && (cited[0]?.length ?? 0) >= 8 ? 1 : null
	if (needed !== null) {
		const sharedTail = (key: string): number => {
			const listed = key.slice(0, -(year.length + 1)).split(' ')
			let n = 0
			while (n < listed.length && n < cited.length && listed[listed.length - 1 - n] === cited[cited.length - 1 - n]) n++
			return n
		}
		const byTail = new Set(sameYear.filter(([k]) => sharedTail(k) >= needed).map(([, e]) => e))
		if (byTail.size === 1) return [...byTail][0] ?? null
	}
	return null
}

/** The initials of a spelt-out organisation: "world health organization" → "who". */
const initialsOf = (head: string): string =>
	head
		.split(' ')
		.filter((w) => w && !/^(?:of|and|the|for|on|in|to|a|an)$/.test(w))
		.map((w) => w[0] ?? '')
		.join('')

/** The list's one entry for the author a key names, whatever its year: the print cites
 *  "Karapetis et al. 2016" and lists only Karapetis et al. 2017. */
function lookupByName(index: CitationIndex, key: string): ReferenceEntry | null {
	const name = key.replace(/\s(?:19|20)\d\d[a-z]?$/, '')
	if (!name) return null
	// The entry's whole name, not a longer one it opens ("Cancer Council Australia 2012" is
	// not the Cancer Council Australia Sarcoma Guidelines Working Party 2014).
	const found = new Set([...index.byKey.entries()].filter(([k]) => k.startsWith(`${name} `) && /^(?:19|20)\d\d[a-z]?$/.test(k.slice(name.length + 1))).map(([, e]) => e))
	return found.size === 1 ? ([...found][0] ?? null) : null
}

/** The name a year-only citation belongs to. An organisation's name runs over several
 *  words ("European Society for Medical Oncology (2018)", "Royal Commission into Aged Care
 *  Quality and Safety (2021)", "Cancer Australia’s (2020c)"): the longest run of the words
 *  before the bracket, opening with a capital, that the list resolves; else the last name
 *  as NAME_BEFORE reads it, for the ledger's reason. */
function nameBefore(before: string, inner: string, index: CitationIndex): string | undefined {
	const words = before.trimEnd().split(/\s+/).slice(-10)
	for (let k = words.length; k >= 1; k--) {
		const candidate = words
			.slice(-k)
			.join(' ')
			.replace(/^[(“‘"']+/, '')
			.replace(/[’']s$/, '')
		if (!/^\p{Lu}/u.test(candidate)) continue
		const keys = partKeys(`${candidate} ${inner}`)
		if (keys.length > 0 && keys.every((key) => lookup(index, key) !== null)) return candidate
	}
	// Nothing resolves: the ledger names what the print names — a person as NAME_BEFORE
	// reads one ("Smith & Jones", "Smith et al."), an organisation by its whole name.
	const person = NAME_BEFORE.exec(before)?.[1]?.replace(/[’']s$/, '')
	if (!person || /&|\band\b|\bet al/.test(person)) return person
	const run: string[] = []
	for (const w of [...words].reverse()) {
		const bare = w.replace(/[’']s$/, '')
		if (/^\p{Lu}/u.test(bare) || (run.length > 0 && /^(?:of|for|and|the|into|on|in)$/.test(bare))) run.unshift(bare)
		else break
	}
	while (run.length > 0 && /^(?:of|for|and|the|into|on|in)$/.test(run[0] ?? '')) run.shift()
	return run.length > 0 ? run.join(' ') : person
}

/** Replace the author–year citations in a paragraph's inline nodes with citation atoms. */
function citeInline(nodes: JsonNode[], index: CitationIndex): JsonNode[] {
	const out: JsonNode[] = []
	for (const node of nodes) {
		if (node.type !== 'text' || !node.text || (node.marks?.length ?? 0) > 0 && node.marks?.some((m) => m.type === 'link')) {
			out.push(node)
			continue
		}
		let last = 0
		const text = node.text
		for (const m of text.matchAll(IN_TEXT)) {
			const inner = (m[1] ?? m[2] ?? '').trim()
			let before = text.slice(last, m.index)
			// A date in parentheses ("(May 2019)") names no reference.
			if (MONTH_YEAR.test(inner)) continue
			let parts: string[] = []
			for (const p of inner
				.split(/;\s*/)
				.flatMap((p) => p.split(CITATION_COMMA))
				.flatMap((p) => p.split(CITATION_RUN_ON))
				.map((p) => p.trim())
				.filter(Boolean)) {
				const previous = parts.at(-1)
				if (previous && /^(?:19|20)\d\d[a-z]?$/.test(p)) {
					// A year alone after a separator takes the name before it: "Royal College of
					// Pathologists 2013; 2017", "Laidsaar-Powell et al; 2018a".
					if (!YEAR.test(previous)) {
						parts[parts.length - 1] = `${previous} ${p}`
						continue
					}
					const name = previous.replace(/\s*(?:19|20)\d\d[a-z]?(?:,\s*(?:19|20)\d\d[a-z]?)*$/, '')
					parts.push(name ? `${name} ${p}` : p)
					continue
				}
				parts.push(p)
			}
			// A year alone takes the name the sentence just gave: "Fitch’s (2000) model". After
			// anything else ("…Plan for Blood Cancer (2020)") it dates a title, not a source.
			if (/^(?:19|20)\d\d[a-z]?(?:,\s*(?:19|20)\d\d[a-z]?)*$/.test(inner)) {
				const name = nameBefore(before, inner, index)
				if (!name) continue
				parts = [`${name} ${inner}`]
				// The name stays in the sentence; only the bracketed year becomes the atom.
				before = before.replace(/\s*$/, ' ')
			}
			// Each part resolves to entries or stays as text: an aside with no year ("0.83;
			// Cancer Australia 2019b") is text beside the atom; an author–year the list cannot
			// answer stays as printed and the ledger says why (decision 147): no such entry, or
			// several for that name and year and the text names none of them.
			type Piece = { text: string } | { entries: ReferenceEntry[] }
			const pieces: Piece[] = []
			const misses: string[] = []
			for (const p of parts) {
				const keys = partKeys(p)
				if (keys.length === 0) {
					pieces.push({ text: p })
					continue
				}
				const entries = keys.map((k) => {
					const entry = lookup(index, k)
					if (entry) return entry
					// The print's own slip in a year: the list's only entry for that author.
					const byName = lookupByName(index, k)
					if (byName) index.byName.push(`"${p}" → ${byName.citation.slice(0, 80)}`)
					return byName
				})
				if (entries.every((e): e is ReferenceEntry => e !== null)) pieces.push({ entries })
				else {
					pieces.push({ text: p })
					misses.push(explainMiss([p], index))
				}
			}
			if (misses.length > 0) index.unmatched.push(`${inner} — ${misses.join('; ')}`)
			if (!pieces.some((piece) => 'entries' in piece)) continue
			// All atoms: the printed parenthesis is theirs. Mixed: the parenthesis stays around
			// text and atoms alike.
			const wrap = pieces.some((piece) => 'text' in piece)
			if (before || wrap) out.push({ ...node, text: wrap ? `${before}(` : before })
			for (const [i, piece] of pieces.entries()) {
				if (i > 0 && wrap) out.push({ ...node, text: '; ' })
				if ('text' in piece) out.push({ ...node, text: piece.text })
				else
					for (const e of piece.entries) {
						index.matched++
						out.push({ type: 'citation', attrs: { referenceId: e.id } })
					}
			}
			if (wrap) out.push({ ...node, text: ')' })
			last = (m.index ?? 0) + m[0].length
		}
		const rest = text.slice(last)
		if (rest) out.push({ ...node, text: rest })
	}
	// A space that preceded a printed "(…)" now precedes an atom; a full stop after one
	// stays. Nothing else changes.
	return out.filter((n) => n.type !== 'text' || (n.text ?? '') !== '')
}

/** Why a printed citation resolved to no entry: the reason the ledger records. */
function explainMiss(parts: string[], index: CitationIndex): string {
	const reasons: string[] = []
	for (const part of parts) {
		const keys = partKeys(part)
		if (keys.length === 0) {
			reasons.push(`"${part}" is not an author–year citation`)
			continue
		}
		for (const key of keys) {
			if (lookup(index, key)) continue
			const name = key.replace(/\s(?:19|20)\d\d[a-z]?$/, '')
			const year = key.slice(name.length + 1)
			const sameName = [...index.byKey.keys()].filter((k) => k.startsWith(`${name} `))
			const sameYear = sameName.filter((k) => k.slice(name.length + 1).startsWith(year.replace(/[a-z]$/, '')))
			if (sameYear.length > 1 && !/[a-z]$/.test(year))
				reasons.push(`"${part}": the list has ${sameYear.length} entries for that author in ${year} (${sameYear.map((k) => k.slice(name.length + 1)).join(', ')}) and the text names none of them`)
			else if (sameName.length > 0) {
				// The years the list has for that name, once each (an entry has several keys).
				const years = [...new Set(sameName.map((k) => /((?:19|20)\d\d[a-z]?)$/.exec(k)?.[1] ?? k.slice(name.length + 1)))].sort()
				reasons.push(`"${part}": the list has that author only for ${years.join(', ')}`)
			}
			else reasons.push(`"${part}": no entry in the printed reference list`)
		}
	}
	return reasons.join('; ')
}

function citeNodes(nodes: JsonNode[], index: CitationIndex): JsonNode[] {
	return nodes.map((n) => {
		if (!n.content) return n
		if (n.type === 'paragraph' || n.type === 'heading' || n.type === 'carePoint' || n.type === 'banner')
			return { ...n, content: citeInline(n.content, index) }
		return { ...n, content: citeNodes(n.content, index) }
	})
}

// ---------------------------------------------------------------------------
// Title matching
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
	'the', 'of', 'and', 'or', 'for', 'to', 'a', 'an', 'in', 'with', 'by', 'on', 'at', 'from', 'into', 'as',
	'people', 'patients', 'patient', 'person', 'women', 'men', 'cancer', 'cancers', 'other', 'their', 'who',
])

const stem = (w: string): string => w.replace(/(ies)$/, 'y').replace(/(sses|ches|shes|xes)$/, (m) => m.slice(0, -2)).replace(/s$/, '')

/** The words that carry a title: lower case, stemmed, without stopwords, numbers and the
 *  pathway's own subject. */
function titleTokens(title: string, subject: string): Set<string> {
	const subjectWords = new Set(subject.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem))
	const tokens = title
		.toLowerCase()
		.replace(/\bgp'?s?\b/g, 'general practitioner')
		.replace(/\bmdt\b/g, 'multidisciplinary team')
		// "work-up", "work up" and "workup" are one word.
		.replace(/\bwork[\s-]?up\b/g, 'workup')
		.split(/[^a-z0-9]+/)
		.filter((w) => w && !/^\d+$/.test(w) && !STOPWORDS.has(w))
		.map(stem)
		.filter((w) => !subjectWords.has(w))
	return new Set(tokens)
}

/** How well a legacy title names a template section: shared words over the shorter
 *  title (containment) with a floor on the overall overlap (Jaccard). */
function titleScore(a: Set<string>, b: Set<string>): { containment: number; jaccard: number } {
	if (a.size === 0 || b.size === 0) return { containment: 0, jaccard: 0 }
	let shared = 0
	for (const w of a) if (b.has(w)) shared++
	return { containment: shared / Math.min(a.size, b.size), jaccard: shared / (a.size + b.size - shared) }
}

interface Candidate {
	row: CoreSectionRow
	tokens: Set<string>
}

/** The template section of the same step a legacy title matches, or null. */
function matchTitle(title: string, candidates: Candidate[], subject: string): CoreSectionRow | null {
	const tokens = titleTokens(title, subject)
	if (tokens.size === 0) return null
	let best: { candidate: Candidate; score: { containment: number; jaccard: number } } | null = null
	// A one-word legacy title ("Treatment") names only a one- or two-word section — unless
	// exactly one section of the step carries the word at all ("Screening" and 1.2.1
	// Population-based screening recommendations).
	const [only] = tokens
	const carrying = tokens.size === 1 && only !== undefined ? candidates.filter((c) => c.tokens.has(only)) : []
	for (const c of candidates) {
		const score = titleScore(tokens, c.tokens)
		if (score.containment < 0.6 || score.jaccard < 0.25) continue
		if (tokens.size === 1 && c.tokens.size > 2 && !(carrying.length === 1 && carrying[0] === c)) continue
		// The closer title wins; between equals, the shorter (the more specific) one.
		if (!best || score.jaccard > best.score.jaccard || (score.jaccard === best.score.jaccard && c.tokens.size < best.candidate.tokens.size))
			best = { candidate: c, score }
	}
	return best?.candidate.row ?? null
}

// ---------------------------------------------------------------------------
// The draft: scaffold plus placements
// ---------------------------------------------------------------------------

interface DraftSection {
	row: SectionInsert
	core: CoreSectionRow | null
	/** Content placed from the legacy document, in order. */
	contributions: { heading: string | null; nodes: JsonNode[] }[]
	/** Template guidance kept beneath the placed content. */
	guidance: JsonNode[]
	pages: string[]
}

/** A section's guidance: its guidance nodes and developer boxes, which tell the author
 *  what the template asks for here. */
function guidanceOf(body: JsonNode | null | undefined): JsonNode[] {
	if (!body?.content) return []
	return body.content.filter((n) => n.type === 'guidance' || (n.type === 'box' && n.attrs?.kind === 'developer'))
}

const headingNode = (text: string, level: number): JsonNode => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] })

/** The text of content nodes, blocks joined by newlines. */
function textOfNodes(nodes: JsonNode[]): string {
	const out: string[] = []
	const visit = (list: JsonNode[], into: string[]) => {
		for (const n of list) {
			if (n.type === 'text') into.push(n.text ?? '')
			else if (n.content) {
				const inner: string[] = []
				visit(n.content, inner)
				const joined = inner.join('')
				if (joined) into.push(n.type === 'paragraph' || n.type === 'heading' ? `${joined}\n` : joined)
			}
		}
	}
	visit(nodes, out)
	return out.join('')
}

/** A bold lead-in opening the first paragraph ("Screening participation – the program …"):
 *  the care point it names, and the nodes with the lead-in removed. */
function leadInOf(nodes: JsonNode[]): { carePoint: string; rest: JsonNode[] } | null {
	const first = nodes[0]
	const lead = first?.type === 'paragraph' ? first.content?.[0] : undefined
	if (!first || !lead || lead.type !== 'text' || !lead.marks?.some((m) => m.type === 'bold')) return null
	const carePoint = (lead.text ?? '').replace(/\s*[–—:-]\s*$/, '').trim()
	if (!carePoint) return null
	const after = first.content?.slice(1) ?? []
	const opener = after[0]
	const trimmed = opener?.type === 'text' ? [{ ...opener, text: (opener.text ?? '').replace(/^\s*[–—:-]?\s*/, '') }, ...after.slice(1)] : after
	const content = trimmed.filter((n) => n.type !== 'text' || (n.text ?? '') !== '')
	return { carePoint, rest: [...(content.length > 0 ? [{ ...first, content }] : []), ...nodes.slice(1)] }
}

function bodyOf(nodes: JsonNode[]): JsonNode {
	return { type: 'doc', content: nodes.length > 0 ? nodes : [{ type: 'paragraph' }] }
}

/** Where a non-step legacy chapter goes: a template section (`address`), or a new section
 *  of its own beneath one (`under`) when the template's own slot is shared core text. */
type NonStepRule = { address: string; how: 'rule' | 'proposed' | 'provenance' | 'derived' } | { under: string; title: string; how: 'proposed' }

/** A template kind's destinations for the sandbox record's non-step identities. */
interface NonStepTable {
	rules: Record<string, NonStepRule | undefined>
	/** The section under which the pathway chapter's own subsections (not steps) sit. */
	pathwayHome: string
	/** The root section the derived guide's introduction follows: the last before Step 1. */
	guideAfter: string
	/** Owned sections that take the legacy principles' text, by principle number — the
	 *  population template's considerations for each principle; the cancer template's
	 *  principles are shared core text and take none. */
	principles: Record<string, string> | null
}

const CANCER_NON_STEP: NonStepTable = {
	rules: {
		contents: { address: 'contents', how: 'derived' },
		'front-matter': { address: 'optimal-care-pathway-for-people-with/x-edition', how: 'rule' },
		'welcome-and-introduction': { address: 'optimal-care-pathway-for-people-with/preface', how: 'proposed' },
		acknowledgement: { address: 'optimal-care-pathway-for-people-with/preface/statement-of-acknowledgement', how: 'provenance' },
		isbn: { address: 'optimal-care-pathway-for-people-with/preface/publication-details', how: 'rule' },
		intent: { address: 'about-optimal-care-pathways/intent-of-the-optimal-care-pathways', how: 'provenance' },
		resources: { address: 'about-optimal-care-pathways/pathway-resources', how: 'provenance' },
		'principles-intro': { address: 'principles-for-optimal-cancer-care', how: 'provenance' },
		scope: { address: 'about-this-optimal-care-pathway/scope', how: 'rule' },
		'summary-timeframes': { address: 'snapshot-of-optimal-timeframes', how: 'rule' },
		summary: { address: 'snapshot-of-optimal-timeframes', how: 'provenance' },
		'pathway-note': { address: 'about-this-cancer/epidemiology-and-burden-of-disease', how: 'proposed' },
		contributors: { address: 'contributors-and-reviewers', how: 'rule' },
		references: { address: 'references', how: 'provenance' },
	},
	pathwayHome: 'about-this-cancer',
	guideAfter: 'snapshot-of-optimal-timeframes',
	principles: null,
}

const POPULATION_CONSIDERATIONS = 'principles-for-optimal-cancer-care/population-based-considerations-for-the-principles-for-optimal-c'

const POPULATION_NON_STEP: NonStepTable = {
	rules: {
		contents: { address: 'contents', how: 'derived' },
		'front-matter': { address: 'optimal-care-pathway-for-with-cancer/x-edition', how: 'rule' },
		// The population template's preface is apparatus under its contents: the legacy
		// welcome letter sits under the title section, where the cancer template's preface is.
		'welcome-and-introduction': { under: 'optimal-care-pathway-for-with-cancer', title: 'Welcome and introduction', how: 'proposed' },
		acknowledgement: { address: 'contents/preface/statement-of-acknowledgement', how: 'provenance' },
		isbn: { address: 'contents/preface/publication-details', how: 'rule' },
		intent: { address: 'about-optimal-care-pathways/intent-of-the-optimal-care-pathways', how: 'provenance' },
		resources: { address: 'about-optimal-care-pathways/pathway-resources', how: 'provenance' },
		'principles-intro': { address: 'principles-for-optimal-cancer-care', how: 'provenance' },
		scope: { address: 'about-this-optimal-care-pathway/scope', how: 'rule' },
		context: { address: 'about-this-population-group/overview-of-the-population', how: 'proposed' },
		'further-considerations': { address: 'about-this-population-group/key-considerations-for-delivery-of-optimal-cancer-care', how: 'proposed' },
		summary: { address: 'about-this-population-group', how: 'provenance' },
		'pathway-note': { address: 'about-this-population-group/overview-of-the-population', how: 'proposed' },
		contributors: { address: 'contributors-and-reviewers', how: 'rule' },
		references: { address: 'references', how: 'provenance' },
	},
	pathwayHome: 'about-this-population-group',
	guideAfter: 'about-this-population-group',
	principles: {
		'1': `${POPULATION_CONSIDERATIONS}/person-centred-care`,
		'2': `${POPULATION_CONSIDERATIONS}/safe-and-quality-care`,
		'3': `${POPULATION_CONSIDERATIONS}/multidisciplinary-care`,
		'4': `${POPULATION_CONSIDERATIONS}/supportive-care`,
		'5': `${POPULATION_CONSIDERATIONS}/navigation-and-care-coordination`,
		'6': `${POPULATION_CONSIDERATIONS}/communication`,
		'7': `${POPULATION_CONSIDERATIONS}/research-and-clinical-trials`,
	},
}

const NON_STEP_TABLES: Record<string, NonStepTable | undefined> = { cancer: CANCER_NON_STEP, population: POPULATION_NON_STEP }

/** Back matter with no slot of its own: a new section each under Find out more. */
const FIND_OUT_MORE = /^(appendix-[a-z]|resource-list|glossary|abbreviations)$/

/** The pathway's family colour: the colour its printed edition set the step headings in
 *  (every edition sets all seven in one colour — breast rose #b65673, ovarian #00856e). The
 *  commonest non-white colour among the "Step N" headings; null if none is printed. */
function accentOf(model: ExtractedDocument): string | null {
	const counts = new Map<string, number>()
	const walk = (sections: Section[]) => {
		for (const s of sections) {
			if (s.level === 2 && /^Step [1-7]\b/.test(s.headingText))
				for (const r of s.heading) if (r.text.trim() && r.colour.toLowerCase() !== '#ffffff') counts.set(r.colour.toLowerCase(), (counts.get(r.colour.toLowerCase()) ?? 0) + 1)
			walk(s.children)
		}
	}
	walk(model.sections)
	return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function mapLegacy(input: LegacyImportInput): LegacyImport {
	const { model, pathway, core, id, orgId, actorId } = input
	const slug = pathway.slug
	const documentId = id('document', `legacy:${pathway.pathwaySlug}`)
	const referenceIdOf = (number: number) => id('reference', `legacy:${slug}:n${number}`)
	const mapper = createBlockMapper(model, { figureUrl: (page, index) => legacyFigureUrl(slug, page, index), referenceId: referenceIdOf })
	const tree = legacyTree(model, id, slug)
	const all = flatten(tree)
	const table = NON_STEP_TABLES[core.template.kind]
	if (!table) throw new Error(`no legacy placement table for the ${core.template.kind} template`)
	const ledger: Ledger = {
		edition: editionOf(model, pathway),
		publicationDate: publicationDateOf(model, pathway),
		placements: [],
		citations: { matched: 0, unmatched: [], byName: [] },
		timeframes: { figureRows: 0, boxes: 0, rows: [] },
		checkItems: 0,
	}
	/** Every timeframe box placed from the body, for the summary table's rows to check against. */
	const bodyTimeframes: { step: number | null; text: string }[] = []
	const publishedAt = ledger.publicationDate ? new Date(ledger.publicationDate) : null

	// ---- references --------------------------------------------------------------------
	// A numbered list is cited by raised numbers: the reader made its entries endnotes and
	// its markers endnote runs, which the block mapper turns into citation atoms itself. An
	// author–year list (whatever the References chapter kept as prose) is cited by name and
	// year in the text. A document may carry both: an appendix's numbered list beside an
	// author–year References chapter.
	const referencesNode = tree.find((n) => n.l1 === 'references')
	const entries: ReferenceEntry[] = []
	for (const e of model.endnotes) {
		const citation = plainText(e.runs).replace(/\s+/g, ' ').trim()
		const url = e.runs.find((r) => r.link && 'url' in r.link)?.link
		const printed = citation.match(/<\s*(https?:\/\/[^>\s]+|www\.[^>\s]+)\s*>/)?.[1] ?? null
		entries.push({ id: referenceIdOf(e.number), citation, url: url && 'url' in url ? url.url : printed, keys: new Set(), number: e.number })
	}
	if (referencesNode) {
		const paragraphs = flatten([referencesNode]).flatMap((n) => n.blocks.filter((b): b is Paragraph => b.kind === 'paragraph'))
		for (const [i, p] of paragraphs.entries()) {
			const citation = plainText(p.runs).replace(/\s+/g, ' ').trim()
			if (!YEAR.test(citation)) continue
			const url = p.runs.find((r) => r.link && 'url' in r.link)?.link
			const printed = citation.match(/<\s*(https?:\/\/[^>\s]+|www\.[^>\s]+)\s*>/)?.[1] ?? null
			entries.push({
				id: id('reference', `legacy:${slug}:${i + 1}`),
				citation,
				url: url && 'url' in url ? url.url : printed,
				keys: referenceKeys(citation),
			})
		}
	}
	const citations: CitationIndex = { byKey: new Map(), matched: 0, unmatched: [], byName: [] }
	for (const e of entries) for (const k of e.keys) if (!citations.byKey.has(k)) citations.byKey.set(k, e)
	/** The text cites by author and year only when there is an author–year list to resolve against. */
	const authorYear = citations.byKey.size > 0

	/** A legacy node's blocks as content nodes, cited. */
	// A figure's caption is printed over it ("Figure A1: Fitch's tiered approach …"); the
	// reader keeps it as the figure's alternative text, which a page never shows, so the
	// caption stands as the paragraph over the image too.
	const captioned = (blocks: Block[]): Block[] =>
		blocks.flatMap((b): Block[] => {
			if (b.kind !== 'figure' || !/^Figure\s+[A-Z]?\d+\s*:/i.test(b.alt)) return [b]
			const caption: Paragraph = {
				kind: 'paragraph',
				runs: [{ text: b.alt, bold: false, italic: false, underline: false, superscript: false, subscript: false, size: 0, colour: '#000000', background: null, link: null, footnote: null, endnote: null }],
				page: b.page,
				background: null,
				align: 'left',
			}
			return [caption, b]
		})
	const nodesOf = (blocks: Block[], options: { cite?: boolean } = {}): JsonNode[] =>
		options.cite === false || !authorYear ? mapper.blocks(captioned(blocks)) : citeNodes(mapper.blocks(captioned(blocks)), citations)

	// ---- legacy rows -----------------------------------------------------------------
	const legacyDocument: LegacyDocumentInsert = {
		id: id('legacy-document', slug),
		slug,
		title: model.title,
		audience: pathway.audience,
		format: 'full',
		edition: ledger.edition,
		publicationDate: ledger.publicationDate,
		pdfKey: `legacy-sources/${pathway.file}`,
	}
	const legacySections: LegacySectionInsert[] = all.map((n) => {
		// The reference list's own entries are not citations of one another.
		const body = bodyOf(nodesOf(n.blocks, { cite: n.l1 !== 'references' }))
		return {
			id: n.id,
			documentId: legacyDocument.id,
			parentId: n.parentKey ? id('legacy-section', `${slug}:${n.parentKey}`) : null,
			level: n.level,
			orderIndex: n.orderIndex,
			heading: n.heading,
			key: n.key,
			bodyJson: body,
		}
	})

	// ---- the draft's scaffold -------------------------------------------------------------
	const coreRows = core.sections.filter((s) => !s.apparatus)
	const sectionId = (address: string) => id('section', `legacy:${pathway.pathwaySlug}:${address}`)
	const drafts = new Map<string, DraftSection>()
	/** The template's two title placeholders, as the edition prints them: the title page
	 *  is the document's own title, "X edition" its edition — or, where the print names no
	 *  edition (the 2020 design), the publication details the section holds. */
	const titleFor = (s: CoreSectionRow): string | null => {
		if (s.parentId === null && /\[insert [^\]]+\]/i.test(s.title ?? '')) return model.title
		if (/^X edition$/i.test(s.title ?? '')) return ledger.edition ?? 'Publication details'
		return s.title
	}
	for (const s of coreRows) {
		const shared = s.pathwayOwnership === 'shared'
		drafts.set(s.address, {
			core: s,
			contributions: [],
			guidance: shared ? [] : guidanceOf(s.bodyJson),
			pages: [],
			row: {
				id: sectionId(s.address),
				documentId,
				parentId: s.parentId ? sectionId(coreRows.find((c) => c.id === s.parentId)?.address ?? '') : null,
				address: s.address,
				canonical: s.canonical,
				printedNumber: s.printedNumber,
				title: titleFor(s),
				headingLevel: s.headingLevel,
				orderIndex: s.orderIndex,
				stepNumber: s.stepNumber,
				ownership: shared ? 'shared' : 'owned',
				coreSectionId: shared ? s.id : null,
				pointOfCare: false,
				bodyJson: shared ? null : s.bodyJson,
				migrationNote: null,
			},
		})
	}
	const byAddress = (address: string): DraftSection => {
		const found = drafts.get(address)
		if (!found) throw new Error(`the ${core.template.kind} template has no section at '${address}'`)
		return found
	}
	const childrenOf = (address: string): DraftSection[] => [...drafts.values()].filter((d) => d.row.parentId === sectionId(address))
	const nextOrder = (address: string): number => Math.max(-1, ...childrenOf(address).map((d) => d.row.orderIndex)) + 1

	/** A new owned section under a draft section (or at the root after a named section),
	 *  addressed by slug beneath its parent. */
	const addSection = (
		parentAddress: string | null,
		title: string,
		options: { note: string | null; printedNumber?: string | null; pointOfCare?: boolean; after?: string },
	): DraftSection => {
		const parent = parentAddress ? byAddress(parentAddress) : null
		const base = parentAddress ? `${parentAddress}/${slugify(title)}` : slugify(title)
		let address = base
		let n = 2
		while (drafts.has(address)) address = `${base}-${n++}`
		const rootOrder = () => {
			const after = options.after ? byAddress(options.after) : null
			return after ? after.row.orderIndex + 0.5 : Math.max(-1, ...[...drafts.values()].filter((d) => d.row.parentId === null).map((d) => d.row.orderIndex)) + 1
		}
		const draft: DraftSection = {
			core: null,
			contributions: [],
			guidance: [],
			pages: [],
			row: {
				id: sectionId(address),
				documentId,
				parentId: parent?.row.id ?? null,
				address,
				canonical: false,
				printedNumber: options.printedNumber ?? null,
				title,
				headingLevel: (parent?.row.headingLevel ?? 0) + 1,
				orderIndex: parentAddress ? nextOrder(parentAddress) : rootOrder(),
				stepNumber: parent?.row.stepNumber ?? null,
				ownership: 'owned',
				coreSectionId: null,
				pointOfCare: options.pointOfCare ?? false,
				bodyJson: null,
				migrationNote: options.note,
			},
		}
		drafts.set(address, draft)
		return draft
	}

	const origins: OriginInsert[] = []
	const originsSeen = new Set<string>()
	const recordOrigin = (draft: DraftSection, node: LegacyNode) => {
		const key = `${draft.row.id}|${node.id}`
		if (originsSeen.has(key)) return
		originsSeen.add(key)
		origins.push({ sectionId: draft.row.id, legacySectionId: node.id, chars: textOfBlocks(node.blocks).length })
	}
	/** The body without a first paragraph that only repeats the section's title (the
	 *  front matter's bold "Statement of acknowledgement" under the template's section of
	 *  that name): the heading says it once (decision 145). */
	const titleEcho = (draft: DraftSection, nodes: JsonNode[]): JsonNode[] => {
		const [first, ...rest] = nodes
		const said = (t: string) => t.replace(/[:\s]+$/, '').trim().toLowerCase()
		if (first?.type === 'paragraph' && draft.row.title && said(textOfNodes([first])) === said(draft.row.title)) return rest
		return nodes
	}
	const place = (draft: DraftSection, node: LegacyNode, placed: JsonNode[], how: PlacementHow, options: { heading?: string | null; note?: string } = {}) => {
		if (draft.row.ownership !== 'owned') throw new Error(`cannot place text into the shared section '${draft.row.address}'`)
		const nodes = options.heading ? placed : titleEcho(draft, placed)
		draft.contributions.push({ heading: options.heading ?? null, nodes })
		draft.pages.push(node.pages)
		recordOrigin(draft, node)
		ledger.placements.push({ legacyKey: node.key, legacyTitle: node.heading, destination: draft.row.address, how, ...(options.note ? { note: options.note } : {}) })
	}
	const provenance = (draft: DraftSection, node: LegacyNode, how: PlacementHow = 'provenance', note?: string) => {
		recordOrigin(draft, node)
		ledger.placements.push({ legacyKey: node.key, legacyTitle: node.heading, destination: draft.row.address, how, ...(note ? { note } : {}) })
	}
	/** Legacy text that belongs to a SHARED template section (decision 153): version 1
	 *  publishes it as that section's divergence; the draft starts merged back into the
	 *  core text, the legacy text one diff away. */
	const divergences = new Map<string, { nodes: JsonNode[]; pages: string[] }>()
	const diverge = (draft: DraftSection, node: LegacyNode, nodes: JsonNode[], options: { heading?: string | null; note?: string } = {}) => {
		if (draft.row.ownership !== 'shared') throw new Error(`cannot diverge the owned section '${draft.row.address}'`)
		const entry = divergences.get(draft.row.address) ?? { nodes: [], pages: [] }
		entry.nodes.push(...(options.heading ? [headingNode(options.heading, 3), ...nodes] : titleEcho(draft, nodes)))
		entry.pages.push(node.pages)
		divergences.set(draft.row.address, entry)
		recordOrigin(draft, node)
		ledger.placements.push({ legacyKey: node.key, legacyTitle: node.heading, destination: draft.row.address, how: 'diverged', ...(options.note ? { note: options.note } : {}) })
	}
	/** Into an owned section as placed text; into a shared one as version 1's divergence. */
	const placeOrDiverge = (draft: DraftSection, node: LegacyNode, nodes: JsonNode[], how: PlacementHow, options: { heading?: string | null; note?: string } = {}) => {
		if (nodes.length === 0) {
			provenance(draft, node, draft.row.ownership === 'owned' ? how : 'diverged', options.note)
			return
		}
		if (draft.row.ownership === 'owned') place(draft, node, nodes, how, options)
		else diverge(draft, node, nodes, options)
	}

	// ---- standing homes (decisions 154–156) ------------------------------------------------
	// Headings the legacy editions repeat that the template has no section for, and where
	// the template's own instructions put their content: research and clinical trials in
	// 4.3.1's Clinical trials panel; communication with patients, carers and families in
	// the step's Supportive care; the general practitioner's in the step's GP section.
	const GP_SECTION: Record<number, string> = { 3: '3.6', 4: '4.6', 5: '5.4', 6: '6.8', 7: '7.2.4' }
	const STANDING_HOMES: { test: RegExp; home: (step: number) => string | null; heading: (title: string, step: number) => string | null }[] = [
		{ test: /^research and clinical trials$/i, home: () => '4.3.1', heading: (title, step) => `${title} (Step ${step})` },
		{ test: /^communication with the (?:general practitioner|gp|person.s general practitioner)/i, home: (step) => GP_SECTION[step] ?? `${step}/supportive-care`, heading: (title) => title },
		{ test: /^communication\b(?![^]*\b(?:general practitioner|gp)\b)/i, home: (step) => `${step}/supportive-care`, heading: (title) => title },
		{ test: /^prehabilitation$/i, home: () => '4.2', heading: (title) => title },
		{ test: /^rehabilitation(?: and recovery)?$/i, home: (step) => `${step}/supportive-care`, heading: (title) => title },
		{ test: /^fertility preservation/i, home: () => '3/supportive-care', heading: (title) => title },
		{ test: /^treatment intent$/i, home: () => '4.1', heading: (title) => title },
		{ test: /^(?:responsibilities of individual team members|key considerations beyond treatment recommendations)$/i, home: () => '3.5.1', heading: (title) => title },
		{ test: /^supportive therapies$/i, home: () => '4/supportive-care', heading: (title) => title },
		{ test: /^signs and symptoms (?:of|or) (?:relapsed|recurrent|metastatic|residual|refractory|progressive)/i, home: () => '6.1', heading: (title) => title },
		{ test: /^managing (?:relapsed|recurrent|refractory|residual|progressive|metastatic)/i, home: () => '6.4', heading: (title) => title },
		{ test: /^treatment$/i, home: (step) => (step === 6 ? '6.4' : null), heading: () => null },
	]
	const standingHome = (title: string, step: number): { draft: DraftSection; heading: string | null } | null => {
		for (const rule of STANDING_HOMES) {
			if (!rule.test.test(title)) continue
			const address = rule.home(step)
			const draft = address ? drafts.get(address) : undefined
			return draft ? { draft, heading: rule.heading(title, step) } : null
		}
		return null
	}

	// ---- the steps ------------------------------------------------------------------------
	const stepCandidates = (step: number): Candidate[] =>
		coreRows
			.filter((s) => s.stepNumber === step && s.address !== String(step))
			.map((row) => ({ row, tokens: titleTokens(row.title ?? '', pathway.subject) }))

	/** Where a legacy node's OWN blocks go, given the draft section its title matched (or
	 *  its parent's destination), returning the section that received them. */
	const placeNode = (node: LegacyNode, step: number, parentDestination: DraftSection | null, matched: CoreSectionRow | null): DraftSection | null => {
		const title = titleOf(node.heading, node.number)
		const own = nodesOf(node.blocks)
		// The section above this one that can take draft text: its destination when owned.
		// A shared destination takes the legacy text as version 1's divergence instead.
		const host = parentDestination && parentDestination.row.ownership === 'owned' ? parentDestination : null
		/** The step's Timeframes section, for boxes whose section above is shared core text
		 *  (the draft needs every box for Figure 3, decision 148). */
		const timeframesSection = (): DraftSection =>
			drafts.get(`${step}/timeframes`) ?? addSection(String(step), 'Timeframes', { note: `proposed: timeframes of Step ${step} whose section is shared core text; move each into its section`, pointOfCare: false })
		// A timeframe subsection: a timeframe box in the section above it, whose care
		// point is that section (the printed summary table names the section too).
		// A numbered timeframe section at the step's own level ("2.3 Optimal timeframes for
		// investigations and referrals") names its own care point.
		if (/^(?:optimal )?timeframes?\b/i.test(title) && own.length > 0) {
			const carePoint = parentDestination?.row.title ?? title
			const target = host ?? timeframesSection()
			ledger.timeframes.boxes++
			bodyTimeframes.push({ step, text: textOfBlocks(node.blocks) })
			place(target, node, [{ type: 'timeframe', content: [{ type: 'carePoint', content: [{ type: 'text', text: carePoint }] }, ...own] }], 'timeframe')
			return target
		}
		// "More information" (the population designs say "Further information"): a resources
		// box in the section above it — or, printed under a step's own introduction, in the
		// step itself.
		if (/^(?:more|further) information$/i.test(title) && own.length > 0) {
			const above = parentDestination ?? drafts.get(String(step))
			if (above) {
				placeOrDiverge(above, node, [{ type: 'box', attrs: { kind: 'resources', icon: 'info', family: '', variant: 'soft' }, content: [{ type: 'banner', attrs: { tone: 'band' }, content: [{ type: 'text', text: title.replace(/\s+/g, ' ') }] }, ...own] }], 'resources')
				return above
			}
		}
		if (matched) {
			const draft = byAddress(matched.address)
			if (draft.row.ownership === 'owned') {
				if (own.length > 0) place(draft, node, own, 'title', { heading: draft.contributions.length > 0 ? title : null })
				else provenance(draft, node, 'title')
				return draft
			}
			// A shared match: the legacy text goes to the owned child that best names it;
			// else it is version 1's divergence of the shared section (decision 153).
			if (own.length === 0) {
				provenance(draft, node)
				return draft
			}
			const children = childrenOf(matched.address).filter((d) => d.core && d.row.ownership === 'owned')
			const child = matchTitle(title, children.map((d) => ({ row: d.core as CoreSectionRow, tokens: titleTokens(d.core?.title ?? '', pathway.subject) })), pathway.subject)
			if (child) {
				provenance(draft, node)
				const target = byAddress(child.address)
				place(target, node, own, 'title-child', { heading: title, note: `matched the shared section ${matched.printedNumber ?? matched.address}` })
				return target
			}
			diverge(draft, node, own, { note: `legacy text of the shared ${matched.printedNumber ?? matched.title}: version 1 publishes it as a divergence; the draft carries the core text` })
			return draft
		}
		// No match: into the parent's destination (a subsection keeps its heading inside
		// the body) — placed when owned, diverged when shared.
		if (parentDestination) {
			placeOrDiverge(parentDestination, node, own.length > 0 ? [headingNode(title, 3), ...own] : [], 'merged')
			return parentDestination
		}
		// A heading with nothing of its own under it ("Support and communication" over its
		// subsections) makes no section: its children find their own places.
		if (own.length === 0) {
			ledger.placements.push({ legacyKey: node.key, legacyTitle: node.heading, destination: null, how: 'unplaced', note: 'a container heading with no text of its own; its subsections were placed separately' })
			return null
		}
		const fresh = addSection(String(step), title, { note: `unplaced: the ${core.template.kind} template has no section for this under Step ${step}; keep, move or remove it`, printedNumber: node.number })
		place(fresh, node, own, 'unplaced')
		return fresh
	}

	const visitStep = (node: LegacyNode, step: number, parentDestination: DraftSection | null) => {
		const title = titleOf(node.heading, node.number)
		// A standing home settles the heading before any title match.
		const standing = standingHome(title, step)
		if (standing) {
			const own = nodesOf(node.blocks)
			placeOrDiverge(standing.draft, node, own.length > 0 ? [...(standing.heading ? [headingNode(standing.heading, 3)] : []), ...own] : [], 'rule', { note: `standing home for "${title}"` })
			for (const child of node.children) visitStep(child, step, standing.draft)
			return
		}
		const matched = /^((?:optimal )?timeframes?\b|(?:more|further) information$)/i.test(title) ? null : matchTitle(title, stepCandidates(step), pathway.subject)
		const destination = placeNode(node, step, parentDestination, matched)
		for (const child of node.children) visitStep(child, step, destination)
	}

	for (const chapter of tree) {
		if (chapter.l1 !== 'pathway-note') continue
		// The chapter's own intro (the seven steps box, the disease's epidemiology).
		const rule = table.rules['pathway-note']
		if (rule && 'address' in rule) {
			const intro = chapter.blocks.filter((b) => !(b.kind === 'table' && /^seven steps/i.test(textOfBlocks([b]).trim())))
			const own = nodesOf(intro)
			const draft = byAddress(rule.address)
			if (own.length > 0) place(draft, chapter, own, 'proposed', { note: `proposed: the legacy pathway’s opening text, read as ${draft.row.title}` })
			draft.row.migrationNote = draft.row.migrationNote ?? `proposed: holds the legacy pathway’s opening text; check it is about ${(draft.row.title ?? '').toLowerCase()}`
		}
		for (const stepNode of chapter.children) {
			const step = Number(STEP.exec(stepNode.heading)?.[1] ?? 0)
			if (!step) {
				// The chapter's own subsections before the steps ("Special considerations", the
				// disease's subsets): a proposed section each beside the chapter's home.
				const title = titleOf(stepNode.heading, stepNode.number)
				const home = addSection(table.pathwayHome, title, { note: `proposed: the legacy pathway’s opening section "${title}"; check where it belongs`, printedNumber: stepNode.number })
				const own = nodesOf(stepNode.blocks)
				if (own.length > 0) place(home, stepNode, own, 'proposed')
				else provenance(home, stepNode, 'proposed')
				for (const child of flatten(stepNode.children)) {
					const nodes = nodesOf(child.blocks)
					if (nodes.length > 0) place(home, child, [headingNode(titleOf(child.heading, child.number), 3), ...nodes], 'merged')
					else provenance(home, child, 'merged')
				}
				continue
			}
			// The step's own introduction: version 1's divergence of the step section; the
			// draft starts on the core introduction (decision 157).
			const root = byAddress(String(step))
			placeOrDiverge(root, stepNode, nodesOf(stepNode.blocks), 'proposed', { note: `the legacy edition's own introduction to Step ${step}` })
			for (const child of stepNode.children) visitStep(child, step, null)
		}
	}

	// ---- the quick reference guide: point-of-care sections (decision 152) ----------------------
	// The printed guide is a curated summary that nothing can regenerate from the body, so
	// its content lives in the pathway as point-of-care sections: the guide's own
	// introduction at the root, then under each step a "Quick reference guide" section
	// holding the step's guide text, with one child per panel in the guide's order. The
	// derived guide is every point-of-care section in reading order.
	const pointOfCareLists = (nodes: JsonNode[]): JsonNode[] =>
		nodes.map((n) => (n.type === 'list' && n.attrs?.kind === 'check' ? { ...n, attrs: { ...n.attrs, pointOfCare: true } } : n))
	for (const chapter of tree) {
		if (chapter.l1 !== 'summary') continue
		// The guide's own introduction, and — once — the statement its pages repeat as a
		// running side band ("Support: Assess supportive care needs at every step …"),
		// which the reader set aside as furniture.
		const pages = new Set(flatten([chapter]).map((n) => n.page))
		const band = [...new Set(model.warnings.filter((w) => w.message.startsWith('furniture: ') && pages.has(w.page)).map((w) => w.message.slice('furniture: '.length)))]
		const intro = [...nodesOf(chapter.blocks), ...band.map((text): JsonNode => ({ type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'bold' }] }] }))]
		/** The guide's own section, beside the pathway's steps: its introduction, and the
		 *  panels the guide sets apart from any step. */
		let topGuide: DraftSection | null = null
		const guideSection = (): DraftSection => {
			topGuide ??= addSection(null, 'Quick reference guide', { note: null, pointOfCare: true, after: table.guideAfter })
			return topGuide
		}
		if (intro.length > 0) place(guideSection(), chapter, intro, 'guide')
		else provenance(byAddress(table.guideAfter), chapter, 'guide')
		for (const stepNode of chapter.children) {
			const step = Number(STEP.exec(stepNode.heading)?.[1] ?? 0)
			if (!step) {
				// A panel of no step ("Understanding your patient", "Practical considerations
				// for consultations"): a point-of-care section of the guide's own, its parts
				// under their headings.
				const panel = addSection(guideSection().row.address, titleOf(stepNode.heading, stepNode.number), { note: null, pointOfCare: true })
				const nodes = [
					...pointOfCareLists(nodesOf(stepNode.blocks)),
					...flatten(stepNode.children).flatMap((child) => {
						const own = pointOfCareLists(nodesOf(child.blocks))
						return [headingNode(titleOf(child.heading, child.number), 3), ...own]
					}),
				]
				if (nodes.length > 0) place(panel, stepNode, nodes, 'guide')
				else provenance(panel, stepNode, 'guide')
				for (const child of flatten(stepNode.children)) provenance(panel, child, 'guide')
				continue
			}
			const guide = addSection(String(step), 'Quick reference guide', { note: null, pointOfCare: true })
			const own = pointOfCareLists(nodesOf(stepNode.blocks))
			if (own.length > 0) place(guide, stepNode, own, 'guide')
			else provenance(guide, stepNode, 'guide')
			// One section per panel; a panel repeated over the guide's pages (a second
			// "Checklist") joins the first of its name.
			const panels = new Map<string, DraftSection>()
			for (const panel of flatten(stepNode.children)) {
				const title = titleOf(panel.heading, panel.number)
				const nodes = pointOfCareLists(nodesOf(panel.blocks))
				ledger.checkItems += nodes.filter((n) => n.type === 'list' && n.attrs?.kind === 'check').length
				const key = title.toLowerCase()
				let section = panels.get(key)
				if (!section) {
					section = addSection(guide.row.address, title, { note: null, pointOfCare: true })
					panels.set(key, section)
				}
				if (nodes.length > 0) place(section, panel, nodes, 'guide')
				else provenance(section, panel, 'guide')
			}
		}
	}

	// ---- the summary timeframes table, row by row (decision 148) ---------------------------------
	// The step a table label names is the template's step: its own titles, not the print's
	// headings, which can be misprinted (WM and MPN head Step 1 "Presentation, initial
	// investigations and referral", Step 2's title).
	const stepTitles = coreRows.flatMap((s) =>
		s.stepNumber !== null && s.address === String(s.stepNumber) ? [{ step: s.stepNumber, tokens: titleTokens(s.title ?? '', pathway.subject) }] : [],
	)
	const wordsOf = (text: string) => new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3))
	const covered = (step: number | null, statement: string, share = 0.6): boolean => {
		const words = wordsOf(statement)
		if (words.size === 0) return true
		return bodyTimeframes.some((b) => {
			if (step !== null && b.step !== step) return false
			const have = wordsOf(b.text)
			let shared = 0
			for (const w of words) if (have.has(w)) shared++
			return shared / words.size >= share
		})
	}
	/** A row the table groups under another step than the body prints its box in (ovarian's
	 *  "Referral to specialist": Diagnosis in the table, 2.3.1 in the body) is that box —
	 *  every word of the statement, so no second box is made. Timeframe wording is shared
	 *  across boxes ("patients should … within 2 weeks of GP referral"), so nothing less
	 *  than all of it names another step's box. */
	const coveredElsewhere = (step: number | null, statement: string): boolean => step !== null && covered(null, statement, 1)
	const placeTimeframeRows = (table: Table, chapter: LegacyNode) => {
		let step: number | null = null
		/** A statement cell spanning the rows beneath it: each of their care points has it. */
		let shared: { statement: string; nodes: JsonNode[]; remaining: number } | null = null
		for (const row of table.rows) {
			if (row.cells.every((c) => c.header) || row.cells.length === 0) continue
			const cells = row.cells
			let carePoint: string
			let statement: string
			let statementNodes: JsonNode[]
			if (cells.length === 1 && (cells[0]?.colSpan ?? 1) < 2) {
				// A care point alone: the statement beside it spans down from a row above.
				const cell = cells[0]
				if (!cell || !shared || shared.remaining <= 0) continue
				carePoint = textOfBlocks(cell.blocks).replace(/\s+/g, ' ').trim()
				statement = shared.statement
				statementNodes = shared.nodes
				shared.remaining--
			} else if (cells.length === 1) {
				// A row spanning the columns ("Screening participation – the NBCSP … every 2
				// years"): its bold lead-in is the care point; it opens the table, in Step 1.
				const cell = cells[0]
				const lead = cell ? leadInOf(nodesOf(cell.blocks)) : null
				if (!lead) continue
				step = step ?? 1
				carePoint = lead.carePoint
				statementNodes = lead.rest
				statement = textOfNodes(lead.rest)
			} else {
				if (cells.length >= 3) {
					const label = textOfBlocks(cells[0]?.blocks ?? []).replace(/\s+/g, ' ').trim()
					const tokens = titleTokens(label, pathway.subject)
					// The step the label names: the closest title ("Treatment" is Step 4, not the
					// step whose title merely contains the word).
					let best: { step: number; score: number } | null = null
					for (const s of stepTitles) {
						const { containment, jaccard } = titleScore(tokens, s.tokens)
						if (containment >= 0.6 && (!best || jaccard > best.score)) best = { step: s.step, score: jaccard }
					}
					step = best?.step ?? null
				}
				const carePointCell = cells[cells.length - 2]
				const statementCell = cells[cells.length - 1]
				if (!carePointCell || !statementCell) continue
				carePoint = textOfBlocks(carePointCell.blocks).replace(/\s+/g, ' ').trim()
				statement = textOfBlocks(statementCell.blocks)
				statementNodes = nodesOf(statementCell.blocks)
				shared = statementCell.rowSpan > 1 ? { statement, nodes: statementNodes, remaining: statementCell.rowSpan - 1 } : null
			}
			ledger.timeframes.figureRows++
			if (covered(step, statement) || coveredElsewhere(step, statement)) {
				ledger.timeframes.rows.push({ step, carePoint, source: 'body', destination: null })
				continue
			}
			// No body subsection printed this row: a box from the row, in the step section
			// the care point names, else in a Timeframes section of the step.
			const candidates = step ? stepCandidates(step).filter((c) => byAddress(c.row.address).row.ownership === 'owned') : []
			const matched = step ? matchTitle(carePoint, candidates, pathway.subject) : null
			const target = matched ? byAddress(matched.address) : step ? (drafts.get(`${step}/timeframes`) ?? addSection(String(step), 'Timeframes', { note: `proposed: rows of the printed summary table whose care point names no section of Step ${step}; move each into its section`, pointOfCare: false })) : null
			if (!target) {
				ledger.timeframes.rows.push({ step, carePoint, source: 'row', destination: null })
				continue
			}
			ledger.timeframes.boxes++
			place(target, chapter, [{ type: 'timeframe', content: [{ type: 'carePoint', content: [{ type: 'text', text: carePoint }] }, ...statementNodes] }], 'timeframe-row', { note: `row "${carePoint}" of the summary timeframes table` })
			ledger.timeframes.rows.push({ step, carePoint, source: 'row', destination: target.row.address })
		}
	}

	// ---- front and back matter ----------------------------------------------------------------
	for (const chapter of tree) {
		if (chapter.l1 === 'pathway-note' || chapter.l1 === 'summary') continue
		if (FIND_OUT_MORE.test(chapter.l1)) {
			const section = addSection('find-out-more', titleOf(chapter.heading, chapter.number), { note: `proposed: the sandbox record moves the legacy ${chapter.heading} into Find out more; keep, move or remove it` })
			const own = nodesOf(chapter.blocks)
			if (own.length > 0) place(section, chapter, own, 'proposed')
			else provenance(section, chapter, 'proposed')
			// Subsections keep their headings inside the body; a group heading over other
			// headings (the resource list's audiences) is a heading with nothing under it.
			for (const child of flatten(chapter.children)) {
				const nodes = nodesOf(child.blocks)
				const level = Math.min(4, 3 + (child.key.split('/').length - 2))
				place(section, child, [headingNode(titleOf(child.heading, child.number), level), ...nodes], 'merged')
			}
			continue
		}
		const rule = table.rules[chapter.l1]
		if (!rule) {
			const section = addSection('find-out-more', titleOf(chapter.heading, chapter.number), { note: `unplaced: the template has no slot for the legacy chapter "${chapter.heading}"; keep, move or remove it` })
			for (const node of flatten([chapter])) {
				const nodes = nodesOf(node.blocks)
				if (nodes.length > 0) place(section, node, node === chapter ? nodes : [headingNode(titleOf(node.heading, node.number), 3), ...nodes], 'unplaced')
			}
			continue
		}
		if (rule.how === 'derived') {
			for (const node of flatten([chapter])) ledger.placements.push({ legacyKey: node.key, legacyTitle: node.heading, destination: null, how: 'derived' })
			continue
		}
		// The population template's principles carry owned "considerations" sections, one
		// per principle: the legacy edition's own text on each principle goes there.
		if (chapter.l1 === 'principles-intro' && table.principles) {
			// The chapter's own opening is this population's (its principles, co-design,
			// cultural safety): version 1's text for the principles section, as any chapter
			// whose slot is core text.
			const home = byAddress('address' in rule ? rule.address : rule.under)
			const opening = nodesOf(chapter.blocks)
			if (opening.length > 0) placeOrDiverge(home, chapter, opening, 'diverged')
			else provenance(home, chapter)
			for (const principle of chapter.children) {
				const number = /^principle\s+(\d)/i.exec(principle.heading)?.[1]
				const address = number ? table.principles[number] : undefined
				const title = titleOf(principle.heading, principle.number)
				const target = address
					? byAddress(address)
					: addSection(POPULATION_CONSIDERATIONS, title, { note: `unplaced: the template has no considerations section for the legacy "${title}"; keep, move or remove it` })
				const own = nodesOf(principle.blocks)
				if (own.length > 0) place(target, principle, own, address ? 'proposed' : 'unplaced')
				else provenance(target, principle, address ? 'proposed' : 'unplaced')
				if (address) target.row.migrationNote = target.row.migrationNote ?? `proposed: holds the legacy "${title}" as this population’s considerations for the principle; check it belongs here`
				for (const child of flatten(principle.children)) {
					const nodes = nodesOf(child.blocks)
					if (nodes.length > 0) place(target, child, [headingNode(titleOf(child.heading, child.number), 3), ...nodes], 'merged')
					else provenance(target, child, 'merged')
				}
			}
			continue
		}
		const destination = 'under' in rule ? addSection(rule.under, rule.title, { note: `proposed: holds the legacy "${chapter.heading}"; check it belongs here` }) : byAddress(rule.address)
		if (rule.how === 'provenance' || destination.row.ownership === 'shared') {
			// The reference list is derived from the citations; every other chapter whose
			// template slot is shared core text is version 1's divergence of that slot.
			if (chapter.l1 === 'references' || destination.row.ownership === 'owned') {
				for (const node of flatten([chapter])) provenance(destination, node)
				continue
			}
			placeOrDiverge(destination, chapter, nodesOf(chapter.blocks), 'diverged')
			for (const child of flatten(chapter.children)) {
				const nodes = nodesOf(child.blocks)
				placeOrDiverge(destination, child, nodes.length > 0 ? [headingNode(titleOf(child.heading, child.number), 3), ...nodes] : [], 'diverged')
			}
			continue
		}
		if (chapter.l1 === 'contributors') {
			// The chapter's own text, then its groups by title under the template's own groups.
			const own = nodesOf(chapter.blocks)
			const groups = childrenOf(destination.row.address).filter((d) => d.core).map((d) => ({ row: d.core as CoreSectionRow, tokens: titleTokens(d.core?.title ?? '', pathway.subject) }))
			if (own.length > 0) {
				const first = groups[0] ? byAddress(groups[0].row.address) : null
				if (first) place(first, chapter, own, 'rule')
			} else provenance(destination, chapter)
			for (const group of chapter.children) {
				const title = titleOf(group.heading, group.number)
				const matched = matchTitle(title, groups, pathway.subject)
				const nodes = nodesOf(group.blocks)
				const target = matched ? byAddress(matched.address) : addSection(destination.row.address, title, { note: `unplaced: the template's Contributors and reviewers has no group "${title}"; keep, move or remove it` })
				if (nodes.length > 0) place(target, group, nodes, matched ? 'title' : 'unplaced')
				else provenance(target, group, matched ? 'title' : 'unplaced')
				for (const child of flatten(group.children)) {
					const more = nodesOf(child.blocks)
					if (more.length > 0) place(target, child, [headingNode(titleOf(child.heading, child.number), 3), ...more], 'merged')
				}
			}
			continue
		}
		if (chapter.l1 === 'summary-timeframes') {
			// The prose stays (the chapter's, and any subsection's under it); the table is
			// Figure 3, derived from the steps' timeframe boxes — every printed row must have
			// one (decision 148), so a row the body's own subsections did not produce makes a
			// box of its own in the step section its care point names.
			// The table: the one with the most rows across at least two columns (a band under
			// the caption is a one-cell table of its own), and any table that repeats its header
			// row — the same figure carried over a page ("Figure 3: … (continued)"). Its
			// captions go with it.
			const multiColumn = flatten([chapter])
				.flatMap((n) => n.blocks)
				.filter((b): b is Table => b.kind === 'table' && b.rows.some((r) => r.cells.length >= 2))
			const main = [...multiColumn].sort((a, b) => b.rows.length - a.rows.length)[0]
			const headerOf = (t: Table): string | null => {
				const first = t.rows[0]
				return first && first.cells.length > 0 && first.cells.every((c) => c.header) ? first.cells.map((c) => textOfBlocks(c.blocks).trim()).join('|') : null
			}
			const mainHeader = main ? headerOf(main) : null
			const figureTables = multiColumn.filter((t) => t === main || (mainHeader !== null && headerOf(t) === mainHeader))
			const isCaption = (b: Block) => figureTables.length > 0 && b.kind === 'paragraph' && /^Figure\s+\d+\s*:/.test(plainText(b.runs).trim())
			for (const node of flatten([chapter])) {
				const printed = nodesOf(node.blocks.filter((b) => !(b.kind === 'table' && figureTables.includes(b)) && b.kind !== 'figure' && !isCaption(b)))
				// Where the print had its Figure 3, the chapter's text is followed by the
				// template's snapshot, which the page draws from the steps' timeframe boxes.
				const snapshot: JsonNode = { type: 'timeframeSnapshot' }
				const own = node === chapter && figureTables.length > 0 ? [...printed, snapshot] : printed
				if (own.length > 0) place(destination, node, node === chapter ? own : [headingNode(titleOf(node.heading, node.number), 3), ...own], node === chapter ? 'rule' : 'merged', node === chapter ? { note: 'the printed timeframes table and its caption are derived from the steps’ timeframe boxes' } : {})
				else provenance(destination, node)
			}
			for (const table of figureTables) placeTimeframeRows(table, chapter)
			continue
		}
		// The edition slot takes the cover and title page as statements (decision 145): its
		// heading is the edition as words (titleFor), its body the publication date and who
		// endorsed it. The title is the document's.
		const own =
			chapter.l1 === 'front-matter'
				? [
						...(publishedAt ? [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: `Published ${publishedAt.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}` }] }] : []),
						...nodesOf(chapter.blocks.filter((b) => b.kind !== 'paragraph' || /^endorsed by/i.test(plainText(b.runs).trim()))),
					]
				: nodesOf(chapter.blocks)
		if (own.length > 0) place(destination, chapter, own, rule.how === 'proposed' ? 'proposed' : 'rule')
		else provenance(destination, chapter, rule.how === 'proposed' ? 'proposed' : 'rule')
		if (rule.how === 'proposed') destination.row.migrationNote = destination.row.migrationNote ?? `proposed: holds the legacy "${chapter.heading}"; check it belongs here`
		// Beneath a proposed home a chapter of many parts keeps its parts as sections (a
		// population pathway's "Further considerations"); beneath a slot of the template's
		// (the imprint, the timeframes) the parts are headings inside the body.
		for (const child of chapter.children) {
			const title = titleOf(child.heading, child.number)
			const target =
				rule.how === 'proposed'
					? addSection(destination.row.address, title, { note: `proposed: a part of the legacy "${chapter.heading}"; check it belongs here`, printedNumber: child.number })
					: destination
			const nodes = nodesOf(child.blocks)
			if (target === destination) {
				if (nodes.length > 0) place(target, child, [headingNode(title, 3), ...nodes], 'merged')
				else provenance(target, child, 'merged')
			} else if (nodes.length > 0) place(target, child, nodes, 'proposed')
			else provenance(target, child, 'proposed')
			for (const grandchild of flatten(child.children)) {
				const more = nodesOf(grandchild.blocks)
				if (more.length > 0) place(target, grandchild, [headingNode(titleOf(grandchild.heading, grandchild.number), 3), ...more], 'merged')
				else provenance(target, grandchild, 'merged')
			}
		}
	}

	// ---- bodies ----------------------------------------------------------------------------
	const sections: SectionInsert[] = [...drafts.values()].map((d) => {
		if (d.row.ownership === 'shared') return d.row
		if (d.contributions.length === 0) return d.row
		const placed = d.contributions.flatMap((c) => (c.heading ? [headingNode(c.heading, 3), ...c.nodes] : c.nodes))
		return {
			...d.row,
			bodyJson: bodyOf([...placed, ...d.guidance]),
			sourcePages: [...new Set(d.pages)].join(', '),
		}
	})

	// ---- versions ---------------------------------------------------------------------------
	const v1: VersionInsert = {
		id: id('version', `legacy:${pathway.pathwaySlug}:1`),
		documentId,
		status: 'published',
		versionNo: 1,
		label: ledger.edition,
		releaseNotes: `Imported from the published PDF ${pathway.file}${ledger.edition ? ` (${ledger.edition}` : ''}${ledger.publicationDate ? `${ledger.edition ? ', ' : ' ('}published ${publishedAt?.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}` : ''}${ledger.edition || ledger.publicationDate ? ')' : ''}.`,
		coreVersionId: null,
		createdBy: actorId,
		publishedAt,
		publishedBy: actorId,
	}
	const v2: VersionInsert = {
		id: id('version', `legacy:${pathway.pathwaySlug}:2`),
		documentId,
		status: 'draft',
		versionNo: 2,
		createdBy: actorId,
	}
	// Version 1 is the legacy edition in the template's structure (decision 153): the same
	// section set as the draft, every section the pathway's own — the legacy text where
	// it was placed, a shared section's legacy text as its divergence, and a heading alone
	// where only the parts beneath carried legacy text (the 2026 core text was not part
	// of the printed edition). Sections the edition never touched are hidden.
	const addressOfId = new Map([...drafts.values()].map((d) => [d.row.id, d.row.address]))
	const childrenById = new Map<string | null, DraftSection[]>()
	for (const d of drafts.values()) childrenById.set(d.row.parentId ?? null, [...(childrenById.get(d.row.parentId ?? null) ?? []), d])
	const placedNodes = (d: DraftSection): JsonNode[] => d.contributions.flatMap((c) => (c.heading ? [headingNode(c.heading, 3), ...c.nodes] : c.nodes))
	const hasLegacyText = (d: DraftSection): boolean => divergences.has(d.row.address) || (d.row.ownership === 'owned' && d.contributions.length > 0)
	const visibleIn1 = new Set<string>()
	const visit = (d: DraftSection): boolean => {
		let visible = hasLegacyText(d)
		for (const child of childrenById.get(d.row.id) ?? []) if (visit(child)) visible = true
		if (visible) visibleIn1.add(d.row.address)
		return visible
	}
	for (const d of childrenById.get(null) ?? []) visit(d)
	const versionSections: VersionSectionInsert[] = [...drafts.values()].map((d) => {
		const divergence = divergences.get(d.row.address)
		return {
			versionId: v1.id,
			sectionId: d.row.id,
			parentAddress: d.row.parentId ? (addressOfId.get(d.row.parentId) ?? null) : null,
			address: d.row.address,
			title: d.row.title ?? null,
			printedNumber: d.row.printedNumber ?? null,
			orderIndex: d.row.orderIndex,
			ownership: 'owned',
			hidden: !visibleIn1.has(d.row.address),
			pointOfCare: d.row.pointOfCare ?? false,
			bodyJson: divergence ? bodyOf(divergence.nodes) : d.row.ownership === 'owned' && d.contributions.length > 0 ? bodyOf(placedNodes(d)) : bodyOf([]),
			html: null,
			markdown: null,
			lastChangedVersionNo: 1,
		}
	})

	const document: DocumentInsert = {
		id: documentId,
		kind: 'pathway',
		templateId: core.template.id,
		orgId,
		slug: pathway.pathwaySlug,
		title: model.title,
		subject: pathway.subject,
		audience: pathway.audience,
		accent: accentOf(model),
	}
	// Raised-number markers were resolved by the block mapper; a number the list lacks was
	// left as printed and recorded by the reader.
	const missingNumbers = model.warnings.filter((w) => w.message.startsWith('citation-number-missing: ')).map((w) => `p.${w.page}: raised number ${w.message.slice('citation-number-missing: '.length)} — the numbered list has no such entry`)
	ledger.citations = { matched: citations.matched + mapper.stats.citations, unmatched: [...citations.unmatched, ...missingNumbers], byName: citations.byName }
	return {
		document,
		sections,
		versions: [v1, v2],
		versionSections,
		references: entries.map((e) => ({ id: e.id, documentId, citation: e.citation, url: e.url, printedNumber: e.number ?? null })),
		legacyDocument,
		legacySections,
		origins,
		ledger,
	}
}

// ---------------------------------------------------------------------------
// Edition and date, read off the front matter
// ---------------------------------------------------------------------------

const ORDINALS: Record<string, string> = { first: 'First', second: 'Second', third: 'Third', fourth: 'Fourth', '1st': 'First', '2nd': 'Second', '3rd': 'Third' }

function editionOf(model: ExtractedDocument, pathway: LegacyPathway): string | null {
	for (const b of model.front) {
		if (b.kind !== 'paragraph') continue
		// The title page letter-spaces it: "S E C O N D E D I T I O N".
		const compact = plainText(b.runs).replace(/\s+/g, '').toLowerCase()
		const m = /^(first|second|third|fourth)edition$/.exec(compact)
		if (m?.[1]) return `${ORDINALS[m[1]]} edition`
	}
	const fromFile = /-(1st|2nd|3rd)-edition/.exec(pathway.slug)
	if (fromFile?.[1]) return `${ORDINALS[fromFile[1]]} edition`
	return null
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

/** "This edition published in June 2021." → 2021-06-01. A print with no imprint (the
 *  January-2020 design) is dated by its file name ("…-january-2020"). */
function publicationDateOf(model: ExtractedDocument, pathway: LegacyPathway): string | null {
	const fromFile = new RegExp(`-(${MONTHS.join('|')})-(\\d{4})$`).exec(pathway.slug)
	if (fromFile?.[1] && fromFile[2]) return `${fromFile[2]}-${String(MONTHS.indexOf(fromFile[1]) + 1).padStart(2, '0')}-01`
	for (const b of model.front) {
		if (b.kind !== 'paragraph') continue
		const text = plainText(b.runs)
		// "First edition: June 2022." names the date without the word "published".
		const dated = /^(?:first|second|third|fourth)\s+edition:?\s+([A-Z][a-z]+)\s+(\d{4})/i.exec(text.trim())
		if (dated?.[1] && dated[2]) {
			const month = MONTHS.indexOf(dated[1].toLowerCase())
			if (month >= 0) return `${dated[2]}-${String(month + 1).padStart(2, '0')}-01`
		}
		const m = /(?:this edition |first )?published(?: in)?\s+([A-Z][a-z]+)\s+(\d{4})/i.exec(text)
		if (!m) continue
		// "First published in September 2015. This edition published in June 2021." — the
		// edition's own date is the LAST such phrase.
		const all = [...text.matchAll(/published(?: in)?\s+([A-Z][a-z]+)\s+(\d{4})/gi)]
		const last = all.at(-1)
		const month = MONTHS.indexOf((last?.[1] ?? '').toLowerCase())
		const year = Number(last?.[2])
		if (month < 0 || !year) continue
		return `${year}-${String(month + 1).padStart(2, '0')}-01`
	}
	// Nothing printed and no date in the file name: the PDF's own creation month (the
	// January-2020 cervical pathway was made the same day as its two siblings).
	return model.createdAt ? `${model.createdAt.slice(0, 7)}-01` : null
}
