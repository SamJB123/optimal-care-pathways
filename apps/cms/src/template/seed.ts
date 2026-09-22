/**
 * Canonical template → rows. Pure: JSON in, rows out, no I/O, no bindings.
 *
 * WHAT IT BUILDS. For one template file: the `templates` row, the CORE-CONTENT document
 * for that template kind (owned by the central organisation, drafted, reviewed and
 * published like any pathway), every section of the template as a section row with a
 * body in the content schema, and the template's endnotes as `references` rows.
 *
 * HOW A BODY IS BUILT. The canonical extraction holds one block per PDF paragraph, list
 * body or inline run, each typed by where it sat in the PDF (a green developer box, a
 * tick row, a white-on-colour title band). This module turns that flat run of blocks back
 * into the document's own structure:
 *
 *   - consecutive list bodies become one list — a checklist where the verified tick-row
 *     set says so, a bullet list otherwise; a '–' row nests under the item before it
 *   - consecutive developer-box blocks become one `guidance` node
 *   - a timeframe statement becomes a `timeframe` node whose care point is the label
 *     printed above it; the template's 'Or' alternatives join it as further paragraphs
 *   - a title band becomes a `banner`
 *   - inline runs the extraction pulled out of their paragraph (links, citation markers)
 *     go back where they were, using the reading-order text in `*.inline.json`; a run
 *     with no such record attaches to the paragraph beside it
 *   - the template's editable slots ('[cancer type]') become `placeholder` marks wherever
 *     that label occurs in the paragraph
 *   - a citation marker becomes a `citation` atom pointing at the endnote's reference row
 *
 * WHAT IT DOES NOT DO. Bold and italic are not recoverable from the extraction and are
 * not guessed. The apparatus sections (the template's banner, its developer
 * instructions, its contents page) are kept as rows flagged `apparatus`, so the core
 * document is the whole template, comparably, and a pathway simply never renders them.
 *
 * IDS are deterministic (a v5-style UUID from the entry's canonical key), so re-seeding
 * the same template replaces rows instead of duplicating them.
 */

import type { JsonMark, JsonNode } from '#/content/schema.ts'
import type { Audience, Ownership, TemplateKind } from '#/db/schema.ts'
import type {
	CanonicalBlock,
	CanonicalSection,
	CanonicalTemplate,
	InlineParagraph,
	InlineRuns,
} from './canonical.ts'

export interface SeedInput {
	canonical: CanonicalTemplate
	inline: InlineRuns
	/** The central organisation that owns core content. */
	orgId: string
	/** Deterministic id for a (kind, key) pair — supplied so this module stays pure. */
	id: (kind: 'template' | 'document' | 'section' | 'reference', key: string) => string
}

export interface TemplateRow {
	id: string
	kind: TemplateKind
	label: string
	sourceFile: string
	issuedOn: string
	pageCount: number
}

export interface DocumentRow {
	id: string
	kind: 'core'
	templateId: string
	orgId: string
	slug: string
	title: string
	subject: string
	audience: Audience
}

export interface SectionRow {
	id: string
	documentId: string
	parentId: string | null
	address: string
	canonical: boolean
	printedNumber: string | null
	title: string | null
	headingLevel: number | null
	orderIndex: number
	stepNumber: number | null
	ownership: 'owned'
	pathwayOwnership: Ownership
	apparatus: boolean
	bodyJson: JsonNode
}

export interface ReferenceRow {
	id: string
	documentId: string
	citation: string
	url: string | null
	printedNumber: number
}

export interface SeedResult {
	template: TemplateRow
	document: DocumentRow
	sections: SectionRow[]
	references: ReferenceRow[]
	/** Counts a test or a script can hold against the canonical file. */
	stats: {
		checkItems: number
		citations: number
		timeframes: number
		guidance: number
		links: number
		placeholders: number
	}
}

// ---------------------------------------------------------------------------
// Apparatus — the template's own scaffolding, by declared address
// ---------------------------------------------------------------------------

const APPARATUS_ADDRESSES = new Set([
	'cancer-specific-template',
	'population-based-template',
	'core-content',
	'contents',
	'cover/contents',
])
const APPARATUS_SUBTREES = ['cover/instructions-for-developers']

export function isApparatus(address: string): boolean {
	if (APPARATUS_ADDRESSES.has(address)) return true
	return APPARATUS_SUBTREES.some((root) => address === root || address.startsWith(`${root}/`))
}

// ---------------------------------------------------------------------------
// Template identity
// ---------------------------------------------------------------------------

const MONTHS: Record<string, string> = {
	january: '01',
	february: '02',
	march: '03',
	april: '04',
	may: '05',
	june: '06',
	july: '07',
	august: '08',
	september: '09',
	october: '10',
	november: '11',
	december: '12',
}

/** 'cancer' + '20 July 2026' → 'cancer-2026-07'. */
export function templateIdFor(kind: TemplateKind, consultationDate: string): string {
	const match = /([A-Za-z]+)\s+(\d{4})/.exec(consultationDate)
	const month = match ? MONTHS[match[1].toLowerCase()] : undefined
	if (!match || !month) throw new Error(`Cannot read a month and year from '${consultationDate}'`)
	return `${kind}-${match[2]}-${month}`
}

const CORE_SLUG: Record<TemplateKind, string> = {
	cancer: 'core-cancer',
	population: 'core-population',
	principles: 'principles',
}

const CORE_SUBJECT: Record<TemplateKind, string> = {
	cancer: '[cancer type]',
	population: '[population group]',
	principles: 'optimal cancer care',
}

// ---------------------------------------------------------------------------
// Inline text → runs
// ---------------------------------------------------------------------------

const text = (value: string, marks?: JsonMark[]): JsonNode =>
	marks && marks.length > 0 ? { type: 'text', text: value, marks } : { type: 'text', text: value }

const paragraph = (content: JsonNode[], type: 'paragraph' | 'banner' = 'paragraph'): JsonNode =>
	content.length > 0 ? { type, content } : { type }

/** Splits `value` into text runs, marking every occurrence of each placeholder label. */
function withPlaceholders(
	value: string,
	labels: readonly string[],
	base: JsonMark[],
	onMark: () => void,
): JsonNode[] {
	if (labels.length === 0 || value.length === 0) return value ? [text(value, base)] : []
	const pattern = new RegExp(
		labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
		'g',
	)
	const out: JsonNode[] = []
	let cursor = 0
	for (const match of value.matchAll(pattern)) {
		const at = match.index
		if (at > cursor) out.push(text(value.slice(cursor, at), base))
		out.push(text(match[0], [...base, { type: 'placeholder', attrs: { label: match[0] } }]))
		onMark()
		cursor = at + match[0].length
	}
	if (cursor < value.length) out.push(text(value.slice(cursor), base))
	return out
}

const LIST_MARKER = /^[•✓✗–-]\s*/

/**
 * The spacing repairs the canonical build applies to its own text, applied here to the
 * reading-order text, which is raw. pdf.js reads a kerned gap as a word break, so words
 * split: 'work- up', 'Co -design', '4. 5'. Each rule needs same-token characters on both
 * sides, so none can weld two real words.
 */
export function repairSpacing(value: string): string {
	return value
		.replace(/(\d)\.\s+(\d)/g, '$1.$2')
		.replace(/(\w)-\s+(\w)/g, '$1-$2')
		.replace(/(\w)\s+-(\w)/g, '$1-$2')
		.replace(/\s+([,.;:])(\s|$)/g, '$1$2') // 'Framework , which' — a link's trailing space
		.replace(/\s{2,}/g, ' ')
		.trim()
}

/**
 * 'S upports' → 'Supports', but only where the joined word already occurs in this
 * document (so 'A person' stays), which is the canonical build's own rule.
 */
export function rejoinSplitCapitals(value: string, known: ReadonlySet<string>): string {
	return value.replace(/\b([A-Za-z]) ([a-z]{2,})\b/g, (whole, head: string, tail: string) =>
		known.has(head + tail) ? head + tail : whole,
	)
}

/**
 * A paragraph's reading-order text, repaired, and without its section heading: where the
 * PDF put a heading and its first paragraph in one element, the canonical build split the
 * heading out into the section, and the body must not repeat it.
 */
export function recordText(
	record: InlineParagraph,
	block: CanonicalBlock,
	section: CanonicalSection,
	known: ReadonlySet<string>,
): string {
	let value = rejoinSplitCapitals(repairSpacing(record.text), known)
	const heading = repairSpacing(
		[section.printedNumber, section.headingText].filter(Boolean).join(' '),
	)
	if (
		heading &&
		value.startsWith(heading) &&
		!repairSpacing(block.textContent).startsWith(heading)
	) {
		value = value.slice(heading.length).trimStart()
	}
	return value
}

export function knownWords(canonical: CanonicalTemplate): Set<string> {
	const words = new Set<string>()
	const word = /[A-Za-z][A-Za-z'-]+/g
	for (const s of canonical.sections)
		for (const w of (s.headingText ?? '').matchAll(word)) words.add(w[0])
	for (const b of canonical.blocks) for (const w of b.textContent.matchAll(word)) words.add(w[0])
	return words
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

interface Marker {
	printedNumber: number
	referenceId: string
}

interface Lookups {
	inline: InlineRuns
	blockBySeq: Map<number, CanonicalBlock>
	checkItems: Set<string>
	/** blockEntryId → the citation markers the extraction attached to that block. A marker
	 *  is either a run of its own (a Span holding the number) or the number printed at the
	 *  end of the paragraph's own text. */
	markers: Map<string, Marker[]>
	resourceUrl: Map<string, string> // blockEntryId → url
	resourceTitle: Map<string, string> // blockEntryId → the link's full printed text
	timeframe: Map<string, string> // blockEntryId → care point
	slots: Map<string, string[]> // blockEntryId → placeholder labels
	/** Blocks that some paragraph's reading-order record places inside it: skipped as
	 *  blocks of their own, whichever section the canonical build filed them under. */
	consumed: ReadonlySet<string>
	known: ReadonlySet<string>
	stats: SeedResult['stats']
}

function plainText(node: JsonNode): string {
	if (node.text) return node.text
	return (node.content ?? []).map(plainText).join('')
}

/**
 * One section's blocks, in position order, into a body. A small state machine over
 * the run: the open list, the open guidance box, the open timeframe, and the paragraph
 * that a stray inline run should join.
 */
function buildBody(
	section: CanonicalSection,
	blocks: CanonicalBlock[],
	lookups: Lookups,
): JsonNode {
	const {
		inline,
		blockBySeq,
		checkItems,
		markers,
		resourceUrl,
		resourceTitle,
		timeframe,
		slots,
		known,
		stats,
	} = lookups
	const root: JsonNode[] = []
	const citation = (marker: Marker): JsonNode => {
		stats.citations++
		return { type: 'citation', attrs: { referenceId: marker.referenceId } }
	}

	let guidance: JsonNode | null = null
	let list: { node: JsonNode; kind: 'bullet' | 'check' } | null = null
	let openTimeframe: JsonNode | null = null
	let orPending = false
	let lastParagraph: JsonNode | null = null
	const pendingRuns: JsonNode[] = []

	const target = (): JsonNode[] => {
		if (guidance) {
			guidance.content ??= []
			return guidance.content
		}
		return root
	}
	const closeList = () => {
		list = null
	}
	const closeTimeframe = () => {
		openTimeframe = null
		orPending = false
	}

	/**
	 * A block's own citation markers that were not runs of their own: the number is the
	 * tail of the paragraph's text ('…across the cancer continuum.7'). Cut it off and put
	 * the citation atom in its place; a marker whose number is not there still gets its
	 * atom, at the end, rather than being dropped.
	 */
	const placeTrailingMarkers = (runs: JsonNode[], remaining: Marker[]) => {
		for (const marker of [...remaining].reverse()) {
			const last = runs[runs.length - 1]
			const tail = new RegExp(`^(.*?)[\\s,]*${marker.printedNumber}\\s*$`)
			const match = last?.text !== undefined ? tail.exec(last.text) : null
			if (last && match) {
				const kept = match[1] ?? ''
				if (kept.length > 0) last.text = kept
				else runs.pop()
			}
			runs.push(citation(marker))
		}
	}

	/** The inline content of one block: its own text, or its reading-order record. */
	const runsOf = (b: CanonicalBlock, stripMarker: boolean): JsonNode[] => {
		const labels = slots.get(b.entryId) ?? []
		const remaining = [...(markers.get(b.entryId) ?? [])]
		const record: InlineParagraph | undefined = inline[String(b.sourceElement.seq)]
		if (!record) {
			const own = stripMarker ? b.textContent.replace(LIST_MARKER, '') : b.textContent
			const runs = withPlaceholders(own, labels, marksFor(b), () => stats.placeholders++)
			placeTrailingMarkers(runs, remaining)
			return runs
		}
		// Reading-order text with the pulled-out runs located inside it.
		const repaired = recordText(record, b, section, known)
		const full = stripMarker ? repaired.replace(LIST_MARKER, '') : repaired
		const out: JsonNode[] = []
		let cursor = 0
		// A link whose printed text the PDF split into runs ('National Optimal Care
		// Pathways' + 'Framework'): the resource names the whole title, so a following run
		// that continues the title continues the link.
		let openLink: { href: string; title: string; seen: string } | null = null
		for (const part of record.parts) {
			const partText = repairSpacing(part.text)
			const at = full.indexOf(partText, cursor)
			if (at < 0) continue
			// The run's own block, wherever the canonical build filed it — a paragraph's
			// trailing marker can sit in the section BEFORE, because a child element's
			// sequence number precedes its parent's and the section boundary fell between.
			// It is emitted here, in its sentence, and its own block is skipped everywhere.
			const partBlock = blockBySeq.get(part.seq)
			const gap = full.slice(cursor, at)
			const continues =
				openLink !== null &&
				!(partBlock && resourceUrl.has(partBlock.entryId)) &&
				/^\s*$/.test(gap) &&
				openLink.title.startsWith(`${openLink.seen} ${partText}`.trim())
			const gapMarks: JsonMark[] =
				continues && openLink ? [{ type: 'link', attrs: { href: openLink.href } }] : []
			if (gap.length > 0)
				out.push(...withPlaceholders(gap, labels, gapMarks, () => stats.placeholders++))
			const partMarkers = partBlock ? [...(markers.get(partBlock.entryId) ?? [])] : []
			const number = partText.trim()
			const ownIndex = remaining.findIndex((m) => String(m.printedNumber) === number)
			if (partMarkers[0] && String(partMarkers[0].printedNumber) === number) {
				// The run IS the marker: a superscript number in a run of its own.
				out.push(citation(partMarkers[0]))
				openLink = null
			} else if (ownIndex >= 0) {
				// The run is this paragraph's own marker, which the extraction attached to the paragraph.
				const [marker] = remaining.splice(ownIndex, 1)
				if (marker) out.push(citation(marker))
				openLink = null
			} else {
				// A nested run with text of its own (a link, or a paragraph inside a list body).
				const partLabels = partBlock ? (slots.get(partBlock.entryId) ?? []) : []
				const marks =
					continues && openLink
						? [{ type: 'link' as const, attrs: { href: openLink.href } }]
						: partBlock
							? marksFor(partBlock)
							: []
				const runs = withPlaceholders(
					partText,
					[...labels, ...partLabels],
					marks,
					() => stats.placeholders++,
				)
				placeTrailingMarkers(runs, partMarkers)
				out.push(...runs)
				if (continues && openLink) openLink.seen = `${openLink.seen} ${partText}`.trim()
				else if (partBlock && resourceUrl.has(partBlock.entryId)) {
					const href = resourceUrl.get(partBlock.entryId) ?? ''
					openLink = {
						href,
						title: repairSpacing(resourceTitle.get(partBlock.entryId) ?? ''),
						seen: partText,
					}
				} else openLink = null
			}
			cursor = at + partText.length
		}
		if (cursor < full.length)
			out.push(...withPlaceholders(full.slice(cursor), labels, [], () => stats.placeholders++))
		placeTrailingMarkers(out, remaining)
		return out
	}

	const marksFor = (b: CanonicalBlock): JsonMark[] => {
		const url = resourceUrl.get(b.entryId)
		if (!url) return []
		stats.links++
		return [{ type: 'link', attrs: { href: url } }]
	}

	const pushParagraph = (node: JsonNode) => {
		if (pendingRuns.length > 0) {
			node.content = [...pendingRuns, ...(node.content ?? [])]
			pendingRuns.length = 0
		}
		target().push(node)
		lastParagraph = node
	}

	for (const b of blocks) {
		if (lookups.consumed.has(b.entryId)) continue
		const role = b.role
		if (role === 'Lbl') continue // list markers: the row's membership decides its kind

		const isGuidance = b.blockType === 'dev_box'
		if (isGuidance && !guidance) {
			closeList()
			closeTimeframe()
			guidance = { type: 'guidance', content: [] }
			root.push(guidance)
			stats.guidance++
			lastParagraph = null
		} else if (!isGuidance && guidance) {
			guidance = null
			closeList()
			lastParagraph = null
		}

		// A citation marker or a link the extraction split out, with no reading-order record.
		if (role === 'Span') {
			const own = markers.get(b.entryId)
			const runs: JsonNode[] = own && own.length > 0 ? own.map(citation) : runsOf(b, false)
			if (lastParagraph) {
				lastParagraph.content = [...(lastParagraph.content ?? []), ...runs]
			} else {
				pendingRuns.push(...runs)
			}
			continue
		}

		const content = b.textContent.trim()
		if (content.length === 0) continue

		if (role === 'LBody') {
			closeTimeframe()
			// ProseKit's flat list: every item is a `list` node, siblings form the list, a
			// child `list` node is one level down.
			const kind: 'bullet' | 'check' = checkItems.has(b.entryId) ? 'check' : 'bullet'
			const nested = /^[–]/.test(content) && list !== null
			const runs = runsOf(b, true)
			const item: JsonNode =
				kind === 'check'
					? {
							type: 'list',
							attrs: { kind: 'check', pointOfCare: false },
							content: [paragraph(runs)],
						}
					: { type: 'list', attrs: { kind: 'bullet' }, content: [paragraph(runs)] }
			if (nested && list) {
				// A '–' row continues the item before it, one level down.
				const sub: JsonNode = {
					type: 'list',
					attrs: { kind: 'bullet' },
					content: [paragraph(runs)],
				}
				list.node.content ??= []
				list.node.content.push(sub)
				lastParagraph = sub.content?.[0] ?? null
				continue
			}
			target().push(item)
			list = { node: item, kind }
			if (kind === 'check') stats.checkItems++
			lastParagraph = item.content?.[0] ?? null
			continue
		}

		// P (and the one H3): a paragraph, a banner, or part of a timeframe box.
		closeList()
		if (b.blockType === 'banner') {
			closeTimeframe()
			pushParagraph(paragraph(runsOf(b, false), 'banner'))
			continue
		}

		const carePoint = timeframe.get(b.entryId)
		if (carePoint !== undefined) {
			// The label printed above the statement becomes the box's care point.
			const siblings = target()
			const previous = siblings[siblings.length - 1]
			if (previous?.type === 'paragraph' && plainText(previous).trim() === carePoint.trim())
				siblings.pop()
			const statement = paragraph(runsOf(b, false))
			openTimeframe = { type: 'timeframe', attrs: { carePoint }, content: [statement] }
			siblings.push(openTimeframe)
			stats.timeframes++
			lastParagraph = statement
			orPending = false
			continue
		}
		if (openTimeframe && /^or$/i.test(content)) {
			orPending = true
			continue
		}
		if (openTimeframe && orPending) {
			const alternative = paragraph(runsOf(b, false))
			openTimeframe.content?.push(alternative)
			lastParagraph = alternative
			orPending = false
			continue
		}
		closeTimeframe()
		pushParagraph(paragraph(runsOf(b, false)))
	}

	if (pendingRuns.length > 0) root.push(paragraph([...pendingRuns]))
	return { type: 'doc', content: root.length > 0 ? root : [{ type: 'paragraph' }] }
}

// ---------------------------------------------------------------------------
// References — the endnotes, with the URL the References list printed beside each
// ---------------------------------------------------------------------------

function buildReferences(
	input: SeedInput,
	documentId: string,
	blocksBySection: Map<string, CanonicalBlock[]>,
	resourceUrl: Map<string, string>,
	inline: InlineRuns,
	blockBySeq: Map<number, CanonicalBlock>,
): ReferenceRow[] {
	const { canonical, id } = input
	const referencesSection = canonical.sections.find((s) => s.address === 'references')
	const urlByNumber = new Map<number, string>()
	if (referencesSection) {
		let lastUrl: string | null = null
		for (const b of blocksBySection.get(referencesSection.entryId) ?? []) {
			if (b.role === 'Span') {
				lastUrl = resourceUrl.get(b.entryId) ?? lastUrl
				continue
			}
			const number = /^(\d+)\s/.exec(b.textContent)
			if (!number) continue
			const record = inline[String(b.sourceElement.seq)]
			const inlineUrl = record?.parts
				.map((part) => blockBySeq.get(part.seq))
				.map((part) => (part ? resourceUrl.get(part.entryId) : undefined))
				.find((url) => url !== undefined)
			const url = inlineUrl ?? lastUrl
			if (url) urlByNumber.set(Number(number[1]), url)
			lastUrl = null
		}
	}
	return canonical.endnoteEntries.map((entry) => ({
		id: id('reference', `${canonical.document.id}:${entry.printedNumber}`),
		documentId,
		citation: entry.text,
		url: urlByNumber.get(entry.printedNumber) ?? null,
		printedNumber: entry.printedNumber,
	}))
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function seedTemplate(input: SeedInput): SeedResult {
	const { canonical, inline, orgId, id } = input
	const kind = canonical.document.kind
	const templateId = templateIdFor(kind, canonical.document.consultationDate)
	const documentId = id('document', `${templateId}:core`)

	const template: TemplateRow = {
		id: templateId,
		kind,
		label: `Public consultation draft, ${canonical.document.consultationDate}`,
		sourceFile: canonical.document.sourceFile,
		issuedOn: canonical.document.consultationDate,
		pageCount: canonical.document.pageCount,
	}

	const document: DocumentRow = {
		id: documentId,
		kind: 'core',
		templateId,
		orgId,
		slug: CORE_SLUG[kind],
		title: canonical.document.title,
		subject: CORE_SUBJECT[kind],
		audience: kind,
	}

	// Lookups over the satellites, by block.
	const blocksBySection = new Map<string, CanonicalBlock[]>()
	const blockBySeq = new Map<number, CanonicalBlock>()
	for (const b of canonical.blocks) {
		const list = blocksBySection.get(b.sectionEntryId)
		if (list) list.push(b)
		else blocksBySection.set(b.sectionEntryId, [b])
		blockBySeq.set(b.sourceElement.seq, b)
	}
	for (const list of blocksBySection.values()) list.sort((a, b) => a.position - b.position)

	const referenceIdByEntry = new Map(
		canonical.endnoteEntries.map((e) => [
			e.entryId,
			id('reference', `${canonical.document.id}:${e.printedNumber}`),
		]),
	)
	const markers = new Map<string, Marker[]>()
	for (const m of canonical.endnoteMarkers) {
		const referenceId = referenceIdByEntry.get(m.endnoteEntryId)
		if (!referenceId) continue
		const list = markers.get(m.blockEntryId)
		const marker = { printedNumber: m.printedNumber, referenceId }
		if (list) list.push(marker)
		else markers.set(m.blockEntryId, [marker])
	}
	const resourceUrl = new Map<string, string>()
	const resourceTitle = new Map<string, string>()
	for (const r of [...canonical.resources].sort((a, b) => a.position - b.position)) {
		if (resourceUrl.has(r.blockEntryId)) continue
		resourceUrl.set(r.blockEntryId, r.url)
		resourceTitle.set(r.blockEntryId, r.title)
	}
	// One box per statement block; where the template offers two labels for one statement
	// ('Timeframe for treatment' / 'Timeframe for [treatment modality]'), the first wins.
	const timeframe = new Map<string, string>()
	for (const t of canonical.timeframeComponents)
		if (!timeframe.has(t.blockEntryId)) timeframe.set(t.blockEntryId, t.carePoint)
	const slots = new Map<string, string[]>()
	for (const s of canonical.editableSlots) {
		const list = slots.get(s.blockEntryId)
		if (list) {
			if (!list.includes(s.placeholderText)) list.push(s.placeholderText)
		} else slots.set(s.blockEntryId, [s.placeholderText])
	}
	const consumed = new Set<string>()
	for (const b of canonical.blocks) {
		const record = inline[String(b.sourceElement.seq)]
		if (!record) continue
		for (const part of record.parts) {
			const own = blockBySeq.get(part.seq)
			if (own && own.entryId !== b.entryId) consumed.add(own.entryId)
		}
	}
	const stats: SeedResult['stats'] = {
		checkItems: 0,
		citations: 0,
		timeframes: 0,
		guidance: 0,
		links: 0,
		placeholders: 0,
	}
	const lookups: Lookups = {
		inline,
		blockBySeq,
		checkItems: new Set(canonical.checklistItems.map((k) => k.blockEntryId)),
		markers,
		resourceUrl,
		resourceTitle,
		timeframe,
		slots,
		consumed,
		known: knownWords(canonical),
		stats,
	}

	const sectionId = (s: CanonicalSection) => id('section', `${canonical.document.id}:${s.address}`)
	const byEntry = new Map(canonical.sections.map((s) => [s.entryId, s]))
	const sections: SectionRow[] = canonical.sections.map((s) => {
		const parent = s.parentEntryId ? byEntry.get(s.parentEntryId) : undefined
		return {
			id: sectionId(s),
			documentId,
			parentId: parent ? sectionId(parent) : null,
			address: s.address,
			canonical: s.canonical,
			printedNumber: s.printedNumber,
			title: s.headingText,
			headingLevel: s.headingLevel,
			orderIndex: s.orderIndex,
			stepNumber: s.stepNumber,
			ownership: 'owned',
			pathwayOwnership: s.ownership === 'shared' ? 'shared' : 'owned',
			apparatus: isApparatus(s.address),
			bodyJson: buildBody(s, blocksBySection.get(s.entryId) ?? [], lookups),
		}
	})

	const references = buildReferences(
		input,
		documentId,
		blocksBySection,
		resourceUrl,
		inline,
		blockBySeq,
	)
	return { template, document, sections, references, stats }
}
