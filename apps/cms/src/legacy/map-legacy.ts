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
	| 'resources'
	| 'checklist'
	| 'merged'
	| 'provenance'
	| 'derived'
	| 'proposed'
	| 'unplaced'

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
	citations: { matched: number; unmatched: string[] }
	/** Rows the summary timeframes table printed, and timeframe boxes the import made. */
	timeframes: { figureRows: number; boxes: number }
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
	const escaped = number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
		['front-matter', 'Front matter', frontBlocks.slice(0, ackAt < 0 ? (imprintAt < 0 ? frontBlocks.length : imprintAt) : ackAt)],
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

// ---------------------------------------------------------------------------
// References and author–year citations
// ---------------------------------------------------------------------------

interface ReferenceEntry {
	id: string
	citation: string
	url: string | null
	/** Keys the in-text form can name: "acsqhc 2019a", "wildiers 2014", "silver baima 2013". */
	keys: Set<string>
}

const normaliseKey = (value: string): string =>
	value
		.toLowerCase()
		.replace(/[’']/g, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()

/** The entry's year token, with its letter ("2019a"). */
const YEAR = /\b((?:19|20)\d\d[a-z]?)\b/

/** Author–year keys for one printed reference entry. */
function referenceKeys(citation: string): Set<string> {
	const keys = new Set<string>()
	const year = YEAR.exec(citation)
	if (!year) return keys
	const y = year[1]?.toLowerCase() ?? ''
	const head = citation.slice(0, year.index).trim().replace(/,\s*$/, '')
	// Organisations with their abbreviations: "…Health Care (ACSQHC)", "…(ASCO) & …(ESMO)".
	const abbreviations = [...head.matchAll(/\(([A-Za-z]{2,})\)/g)].map((m) => m[1] ?? '')
	if (abbreviations.length > 0) {
		keys.add(`${abbreviations.map(normaliseKey).join(' ')} ${y}`)
		keys.add(`${normaliseKey(head.replace(/\s*\([^)]*\)/g, '').replace(/\s+&\s+|\s+and\s+/g, ' '))} ${y}`)
	} else keys.add(`${normaliseKey(head)} ${y}`)
	// Personal authors: "Wildiers H, Heeren P, Puts M, …, et al." — surnames are the words
	// before each initials group; the in-text form names one, two, or the first with "et al.".
	const authors = head
		.split(/,\s*|\s+&\s+|\s+and\s+/)
		.map((a) => a.trim())
		.filter((a) => a && !/^et al\.?$/i.test(a))
	const surnames = authors.map((a) => a.replace(/\s+[A-Z]{1,3}$/, '').trim()).filter((s) => /^[A-Z][A-Za-z’'-]+(?:\s[A-Z][A-Za-z’'-]+)?$/.test(s))
	if (surnames.length > 0 && surnames.length === authors.length) {
		const first = normaliseKey(surnames[0] ?? '')
		keys.add(`${first} ${y}`)
		if (surnames.length === 2) keys.add(`${first} ${normaliseKey(surnames[1] ?? '')} ${y}`)
	}
	return keys
}

/** A citation as printed in the text — "(COSA 2013; palliAGED 2018)", "[WHO 2018]", or a
 *  year alone after the author's name: "Fitch’s (2000) model". */
const IN_TEXT = /\(([^()]*?(?:19|20)\d\d[a-z]?(?![0-9])[^()]*)\)|\[([^[\]]*?(?:19|20)\d\d[a-z]?(?![0-9])[^[\]]*)\]/g
/** The name a year-only citation belongs to, at the end of the text before it. */
const NAME_BEFORE = /([A-Z][A-Za-z’'-]+(?:\s(?:&|and)\s[A-Z][A-Za-z’'-]+)?(?:\set al\.?)?)[’']?s?\s*$/

/** One part's key(s): "Wildiers et al. 2014" → "wildiers 2014"; "Laidsaar-Powell et al.
 *  2018a, 2018b" → two keys; "Vijayvergia & Denlinger 2015" → "vijayvergia denlinger 2015". */
function partKeys(part: string): string[] {
	const years = [...part.matchAll(/((?:19|20)\d\d[a-z]?)(?![0-9])/g)].map((m) => m[1]?.toLowerCase() ?? '')
	if (years.length === 0) return []
	const at = part.search(/(?:19|20)\d\d/)
	const head = part.slice(0, at).replace(/\bet al\.?/i, '').replace(/\s+&\s+|\s+and\s+/g, ' ')
	const name = normaliseKey(head)
	if (!name) return []
	return years.map((y) => `${name} ${y}`)
}

interface CitationIndex {
	byKey: Map<string, ReferenceEntry>
	matched: number
	unmatched: string[]
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
			let parts = inner.split(/;\s*/).map((p) => p.trim()).filter(Boolean)
			// A year alone takes the name the sentence just gave: "Fitch’s (2000) model".
			if (/^(?:19|20)\d\d[a-z]?(?:,\s*(?:19|20)\d\d[a-z]?)*$/.test(inner)) {
				const name = NAME_BEFORE.exec(before)?.[1]
				if (!name) {
					index.unmatched.push(inner)
					continue
				}
				parts = [`${name} ${inner}`]
				// The name stays in the sentence; only the bracketed year becomes the atom.
				before = before.replace(/\s*$/, ' ')
			}
			const found = parts.map((p) => partKeys(p).map((k) => index.byKey.get(k) ?? null))
			// Every part must resolve, else the printed citation stays as text.
			if (found.length === 0 || found.some((entries) => entries.length === 0 || entries.some((e) => e === null))) {
				index.unmatched.push(inner)
				continue
			}
			if (before) out.push({ ...node, text: before })
			for (const entries of found)
				for (const e of entries)
					if (e) {
						index.matched++
						out.push({ type: 'citation', attrs: { referenceId: e.id } })
					}
			last = (m.index ?? 0) + m[0].length
		}
		const rest = text.slice(last)
		if (rest) out.push({ ...node, text: rest })
	}
	// A space that preceded a printed "(…)" now precedes an atom; a full stop after one
	// stays. Nothing else changes.
	return out.filter((n) => n.type !== 'text' || (n.text ?? '') !== '')
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
	for (const c of candidates) {
		const score = titleScore(tokens, c.tokens)
		if (score.containment < 0.6 || score.jaccard < 0.25) continue
		// A one-word legacy title ("Treatment") names only a one- or two-word section.
		if (tokens.size === 1 && c.tokens.size > 2) continue
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

function bodyOf(nodes: JsonNode[]): JsonNode {
	return { type: 'doc', content: nodes.length > 0 ? nodes : [{ type: 'paragraph' }] }
}

/** The cancer template's destinations for the sandbox record's non-step identities. */
const NON_STEP: Record<string, { address: string; how: 'rule' | 'proposed' | 'provenance' | 'derived' } | undefined> = {
	contents: { address: 'contents', how: 'derived' },
	'front-matter': { address: 'optimal-care-pathway-for-people-with/x-edition', how: 'rule' },
	'welcome-and-introduction': { address: 'optimal-care-pathway-for-people-with/preface', how: 'proposed' },
	acknowledgement: { address: 'optimal-care-pathway-for-people-with/preface/statement-of-acknowledgement', how: 'provenance' },
	isbn: { address: 'optimal-care-pathway-for-people-with/preface/publication-details', how: 'rule' },
	intent: { address: 'about-optimal-care-pathways/intent-of-the-optimal-care-pathways', how: 'provenance' },
	resources: { address: 'about-optimal-care-pathways/pathway-resources', how: 'provenance' },
	'principles-intro': { address: 'principles-for-optimal-cancer-care', how: 'provenance' },
	'summary-timeframes': { address: 'snapshot-of-optimal-timeframes', how: 'rule' },
	summary: { address: 'snapshot-of-optimal-timeframes', how: 'provenance' },
	'pathway-note': { address: 'about-this-cancer/epidemiology-and-burden-of-disease', how: 'proposed' },
	contributors: { address: 'contributors-and-reviewers', how: 'rule' },
	references: { address: 'references', how: 'provenance' },
}
/** Back matter with no slot of its own: a new section each under Find out more. */
const FIND_OUT_MORE = /^(appendix-[a-z]|resource-list|glossary|abbreviations)$/

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function mapLegacy(input: LegacyImportInput): LegacyImport {
	const { model, pathway, core, id, orgId, actorId } = input
	const slug = pathway.slug
	const documentId = id('document', `legacy:${pathway.pathwaySlug}`)
	const mapper = createBlockMapper(model, { figureUrl: (page, index) => legacyFigureUrl(slug, page, index) })
	const tree = legacyTree(model, id, slug)
	const all = flatten(tree)
	const ledger: Ledger = {
		edition: editionOf(model, pathway),
		publicationDate: publicationDateOf(model),
		placements: [],
		citations: { matched: 0, unmatched: [] },
		timeframes: { figureRows: 0, boxes: 0 },
		checkItems: 0,
	}

	// ---- references --------------------------------------------------------------------
	const referencesNode = tree.find((n) => n.l1 === 'references')
	const entries: ReferenceEntry[] = []
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
	const citations: CitationIndex = { byKey: new Map(), matched: 0, unmatched: [] }
	for (const e of entries) for (const k of e.keys) if (!citations.byKey.has(k)) citations.byKey.set(k, e)

	/** A legacy node's blocks as content nodes, cited. */
	const nodesOf = (blocks: Block[]): JsonNode[] => citeNodes(mapper.blocks(blocks), citations)

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
	const legacyBodies = new Map<string, JsonNode>()
	const legacySections: LegacySectionInsert[] = all.map((n) => {
		const body = bodyOf(nodesOf(n.blocks))
		legacyBodies.set(n.key, body)
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
				title: s.title,
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

	/** A new owned section under a draft section, addressed by slug beneath its parent. */
	const addSection = (parentAddress: string, title: string, options: { note: string | null; printedNumber?: string | null; pointOfCare?: boolean }): DraftSection => {
		const parent = byAddress(parentAddress)
		let address = `${parentAddress}/${slugify(title)}`
		let n = 2
		while (drafts.has(address)) address = `${parentAddress}/${slugify(title)}-${n++}`
		const draft: DraftSection = {
			core: null,
			contributions: [],
			guidance: [],
			pages: [],
			row: {
				id: sectionId(address),
				documentId,
				parentId: parent.row.id,
				address,
				canonical: false,
				printedNumber: options.printedNumber ?? null,
				title,
				headingLevel: (parent.row.headingLevel ?? 1) + 1,
				orderIndex: nextOrder(parentAddress),
				stepNumber: parent.row.stepNumber ?? null,
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
	const place = (draft: DraftSection, node: LegacyNode, nodes: JsonNode[], how: PlacementHow, options: { heading?: string | null; note?: string } = {}) => {
		if (draft.row.ownership !== 'owned') throw new Error(`cannot place text into the shared section '${draft.row.address}'`)
		draft.contributions.push({ heading: options.heading ?? null, nodes })
		draft.pages.push(node.pages)
		recordOrigin(draft, node)
		ledger.placements.push({ legacyKey: node.key, legacyTitle: node.heading, destination: draft.row.address, how, ...(options.note ? { note: options.note } : {}) })
	}
	const provenance = (draft: DraftSection, node: LegacyNode, how: PlacementHow = 'provenance', note?: string) => {
		recordOrigin(draft, node)
		ledger.placements.push({ legacyKey: node.key, legacyTitle: node.heading, destination: draft.row.address, how, ...(note ? { note } : {}) })
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
		// The section above this one that can take text: its destination when owned; a
		// shared destination (core text) takes nothing, so a flagged section opens beside it.
		const host = parentDestination && parentDestination.row.ownership === 'owned' ? parentDestination : null
		const hostOrBeside = (): DraftSection =>
			host ??
			addSection(parentDestination?.row.address ?? String(step), title, {
				note: parentDestination
					? `proposed: the template's ${parentDestination.row.printedNumber ?? parentDestination.row.title} is shared core text; the legacy edition's own text under it sits here for the author to fold in or remove`
					: `unplaced: the ${core.template.kind} template has no section for this under Step ${step}; keep, move or remove it`,
				printedNumber: node.number,
			})
		// A timeframe subsection: a timeframe box in the section above it, whose care
		// point is that section (the printed summary table names the section too).
		if (/^timeframes?\b/i.test(title) && parentDestination && own.length > 0) {
			const carePoint = parentDestination.row.title ?? title
			const target = hostOrBeside()
			ledger.timeframes.boxes++
			place(target, node, [{ type: 'timeframe', content: [{ type: 'carePoint', content: [{ type: 'text', text: carePoint }] }, ...own] }], 'timeframe')
			return target
		}
		// "More information": a resources box in the section above it.
		if (/^more information$/i.test(title) && parentDestination && own.length > 0) {
			const target = hostOrBeside()
			place(target, node, [{ type: 'box', attrs: { kind: 'resources', icon: 'info', family: '', variant: 'soft' }, content: [{ type: 'banner', attrs: { tone: 'band' }, content: [{ type: 'text', text: 'More information' }] }, ...own] }], 'resources')
			return target
		}
		if (matched) {
			const draft = byAddress(matched.address)
			if (draft.row.ownership === 'owned') {
				if (own.length > 0) place(draft, node, own, 'title', { heading: draft.contributions.length > 0 ? title : null })
				else provenance(draft, node, 'title')
				return draft
			}
			// A shared match: the core text stands; the legacy text goes to the owned child
			// that best names it, else to a new section beside the core text.
			provenance(draft, node)
			if (own.length === 0) return draft
			const children = childrenOf(matched.address).filter((d) => d.core && d.row.ownership === 'owned')
			const child = matchTitle(title, children.map((d) => ({ row: d.core as CoreSectionRow, tokens: titleTokens(d.core?.title ?? '', pathway.subject) })), pathway.subject)
			if (child) {
				const target = byAddress(child.address)
				place(target, node, own, 'title-child', { heading: title, note: `matched the shared section ${matched.printedNumber ?? matched.address}` })
				return target
			}
			const beside = addSection(matched.address, title, { note: `proposed: the template's ${matched.printedNumber ?? matched.title} is shared core text; the legacy edition's own text on it sits here for the author to fold in or remove`, printedNumber: node.number })
			place(beside, node, own, 'proposed')
			return beside
		}
		// No match: into the parent's destination when the parent was placed (a
		// subsection keeps its heading inside the body), else a flagged section of its own.
		if (host) {
			if (own.length > 0) place(host, node, [headingNode(title, 3), ...own], 'merged')
			else provenance(host, node, 'merged')
			return host
		}
		// A heading with nothing of its own under it ("Support and communication" over its
		// subsections) makes no section: its children find their own places.
		if (own.length === 0) {
			ledger.placements.push({ legacyKey: node.key, legacyTitle: node.heading, destination: null, how: 'unplaced', note: 'a container heading with no text of its own; its subsections were placed separately' })
			return null
		}
		const under = parentDestination?.row.address ?? String(step)
		const fresh = addSection(under, title, { note: `unplaced: the ${core.template.kind} template has no section for this under Step ${step}; keep, move or remove it`, printedNumber: node.number })
		place(fresh, node, own, 'unplaced')
		return fresh
	}

	const visitStep = (node: LegacyNode, step: number, parentDestination: DraftSection | null) => {
		const title = titleOf(node.heading, node.number)
		const matched = /^(timeframes?\b|more information$)/i.test(title) ? null : matchTitle(title, stepCandidates(step), pathway.subject)
		const destination = placeNode(node, step, parentDestination, matched)
		for (const child of node.children) visitStep(child, step, destination)
	}

	for (const chapter of tree) {
		if (chapter.l1 !== 'pathway-note') continue
		// The chapter's own intro (the seven steps box, the disease's epidemiology).
		const rule = NON_STEP['pathway-note']
		if (rule) {
			const intro = chapter.blocks.filter((b) => !(b.kind === 'table' && /^seven steps/i.test(textOfBlocks([b]).trim())))
			const own = nodesOf(intro)
			const draft = byAddress(rule.address)
			if (own.length > 0) place(draft, chapter, own, 'proposed', { note: 'proposed: the legacy pathway’s opening text, read as the disease’s epidemiology' })
			draft.row.migrationNote = draft.row.migrationNote ?? 'proposed: holds the legacy pathway’s opening text; check it is about epidemiology and burden of disease'
		}
		for (const stepNode of chapter.children) {
			const step = Number(STEP.exec(stepNode.heading)?.[1] ?? 0)
			if (!step) {
				ledger.placements.push({ legacyKey: stepNode.key, legacyTitle: stepNode.heading, destination: null, how: 'unplaced', note: 'not a step' })
				continue
			}
			const root = byAddress(String(step))
			provenance(root, stepNode)
			const own = nodesOf(stepNode.blocks)
			if (own.length > 0) {
				const intro = addSection(String(step), 'Introduction', { note: `unplaced: the template's Step ${step} introduction is shared core text; this is the legacy edition's own introduction to the step` })
				intro.row.orderIndex = -1
				place(intro, stepNode, own, 'unplaced')
			}
			for (const child of stepNode.children) visitStep(child, step, null)
		}
	}

	// ---- the quick reference guide: checklists → point-of-care items ---------------------------
	for (const chapter of tree) {
		if (chapter.l1 !== 'summary') continue
		const snapshot = byAddress('snapshot-of-optimal-timeframes')
		provenance(snapshot, chapter)
		for (const stepNode of chapter.children) {
			const step = Number(STEP.exec(stepNode.heading)?.[1] ?? 0)
			if (!step) continue
			const root = byAddress(String(step))
			provenance(root, stepNode)
			let checklist: DraftSection | null = null
			for (const child of flatten(stepNode.children)) {
				if (!/^checklist$/i.test(child.heading.trim())) {
					provenance(root, child)
					continue
				}
				const lists = nodesOf(child.blocks).map((n) =>
					n.type === 'list' && n.attrs?.kind === 'check' ? { ...n, attrs: { ...n.attrs, pointOfCare: true } } : n,
				)
				ledger.checkItems += lists.filter((n) => n.type === 'list' && n.attrs?.kind === 'check').length
				if (lists.length === 0) continue
				checklist ??= addSection(String(step), 'Checklist', { note: null, pointOfCare: true })
				place(checklist, child, checklist.contributions.length === 0 ? [{ type: 'box', attrs: { kind: 'actions', icon: 'clipboard', family: '', variant: 'soft' }, content: [{ type: 'banner', attrs: { tone: 'band' }, content: [{ type: 'text', text: 'Checklist' }] }, ...lists] }] : lists, 'checklist')
			}
			// Later checklist boxes of the same step join the first box.
			if (checklist && checklist.contributions.length > 1) {
				const [first, ...rest] = checklist.contributions
				const box = first?.nodes[0]
				if (first && box?.type === 'box') {
					box.content = [...(box.content ?? []), ...rest.flatMap((c) => c.nodes)]
					checklist.contributions = [first]
				}
			}
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
		const rule = NON_STEP[chapter.l1]
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
		const destination = byAddress(rule.address)
		if (rule.how === 'provenance' || destination.row.ownership === 'shared') {
			for (const node of flatten([chapter])) provenance(destination, node)
			continue
		}
		if (chapter.l1 === 'contributors') {
			// The chapter's own text, then its groups by title under the template's own groups.
			const own = nodesOf(chapter.blocks)
			const groups = childrenOf(rule.address).filter((d) => d.core).map((d) => ({ row: d.core as CoreSectionRow, tokens: titleTokens(d.core?.title ?? '', pathway.subject) }))
			if (own.length > 0) {
				const first = groups[0] ? byAddress(groups[0].row.address) : null
				if (first) place(first, chapter, own, 'rule')
			} else provenance(destination, chapter)
			for (const group of chapter.children) {
				const title = titleOf(group.heading, group.number)
				const matched = matchTitle(title, groups, pathway.subject)
				const nodes = nodesOf(group.blocks)
				const target = matched ? byAddress(matched.address) : addSection(rule.address, title, { note: `unplaced: the template's Contributors and reviewers has no group "${title}"; keep, move or remove it` })
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
			// The prose stays; the table is Figure 3, a derived view of the steps' timeframe boxes.
			const table = chapter.blocks.find((b): b is Table => b.kind === 'table')
			ledger.timeframes.figureRows = table ? table.rows.filter((r) => r.cells.length >= 2 && !r.cells.every((c) => c.header)).length : 0
			const own = nodesOf(chapter.blocks.filter((b) => b.kind !== 'table' && b.kind !== 'figure'))
			if (own.length > 0) place(destination, chapter, own, 'rule', { note: 'the printed timeframes table is derived from the steps’ timeframe boxes' })
			else provenance(destination, chapter)
			for (const child of flatten(chapter.children)) provenance(destination, child)
			continue
		}
		const own = nodesOf(chapter.blocks)
		if (own.length > 0) place(destination, chapter, own, rule.how === 'proposed' ? 'proposed' : 'rule')
		else provenance(destination, chapter, rule.how === 'proposed' ? 'proposed' : 'rule')
		if (rule.how === 'proposed') destination.row.migrationNote = destination.row.migrationNote ?? `proposed: holds the legacy "${chapter.heading}"; check it belongs here`
		for (const child of flatten(chapter.children)) {
			const nodes = nodesOf(child.blocks)
			if (nodes.length > 0) place(destination, child, [headingNode(titleOf(child.heading, child.number), 3), ...nodes], 'merged')
			else provenance(destination, child, 'merged')
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
	const publishedAt = ledger.publicationDate ? new Date(ledger.publicationDate) : null
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
	const versionSections: VersionSectionInsert[] = all.map((n) => ({
		versionId: v1.id,
		sectionId: n.id,
		parentAddress: n.parentKey,
		address: n.key,
		title: titleOf(n.heading, n.number),
		printedNumber: n.number,
		orderIndex: n.orderIndex,
		ownership: 'owned',
		hidden: n.l1 === 'contents',
		pointOfCare: n.l1 === 'summary' && /^checklist$/i.test(n.heading.trim()),
		bodyJson: legacyBodies.get(n.key) ?? null,
		html: null,
		markdown: null,
		lastChangedVersionNo: 1,
	}))

	const document: DocumentInsert = {
		id: documentId,
		kind: 'pathway',
		templateId: core.template.id,
		orgId,
		slug: pathway.pathwaySlug,
		title: model.title,
		subject: pathway.subject,
		audience: pathway.audience,
	}
	ledger.citations = { matched: citations.matched, unmatched: citations.unmatched }
	return {
		document,
		sections,
		versions: [v1, v2],
		versionSections,
		references: entries.map((e) => ({ id: e.id, documentId, citation: e.citation, url: e.url, printedNumber: null })),
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

/** "This edition published in June 2021." → 2021-06-01. */
function publicationDateOf(model: ExtractedDocument): string | null {
	for (const b of model.front) {
		if (b.kind !== 'paragraph') continue
		const text = plainText(b.runs)
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
	return null
}
