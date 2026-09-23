/**
 * Views derived from a document's bodies at render time, never stored (decisions 15 and
 * 50): the citation numbers — first-cited order across the document, so a reference can
 * never carry a stale number — and the snapshot of optimal timeframes, read off the
 * `timeframe` boxes of the steps. Pure functions over the JSON bodies; the server
 * computes them for a page load and the client re-uses them when it renders a body.
 */

import type { JsonNode } from './schema.ts'

export interface TimeframeRow {
	stepNumber: number | null
	/** The section the box sits in, as printed ("2.3 Initial referral"). */
	section: string
	address: string
	carePoint: string
	/** One entry per statement, each the statement's alternatives: a paragraph is one
	 *  statement of one alternative, a `variants` block one statement of several. */
	statements: string[][]
}

/** One box of the pathway map (decisions 63, 72, 74): a step's section with what the
 *  map shows of it, or a note the template draws. */
export interface PathwayMapNodeView {
	id: string
	kind: 'step' | 'note'
	label: string
	/** The step number as printed; none for a note. */
	badge: string | null
	column: number
	row: number
	rowSpan: number
	/** The step's top-level section address (its part on the step page); none for a note. */
	address: string | null
	/** Open guidance boxes and placeholders left in the step's OWNED sections. */
	openItems: number
	/** The step's care points, from its timeframe boxes. */
	carePoints: string[]
	/** The latest `updated_at` across the step's sections. */
	updatedAt: number | null
}

export interface PathwayMapView {
	documentId: string
	nodes: PathwayMapNodeView[]
	edges: {
		from: string
		to: string
		route: 'down' | 'side' | 'elbow'
		kind?: 'arrow' | 'both' | 'line'
	}[]
	rail: { label: string; items: { label: string; address: string; partAddress: string }[] }
	footer: {
		label: string
		/** The Principles core document's principle sections, as cards. */
		documentId: string | null
		items: { label: string; address: string; icon: string | null }[]
	}
	caption: string
}

/** What a rendered body needs beyond its own JSON. */
export interface DerivedView {
	/** Reference id → number, in first-cited order. */
	referenceNumbers: Record<string, number>
	timeframes: TimeframeRow[]
	/** The steps map, when the document's template declares one (decision 72). */
	map: PathwayMapView | null
}

export const emptyDerived = (): DerivedView => ({
	referenceNumbers: {},
	timeframes: [],
	map: null,
})

/** Open items in a body (decision 24, 74): guidance not ticked done, placeholders left. */
export function openItemsIn(body: JsonNode | null): number {
	if (!body) return 0
	let count = 0
	walkNodes(body, (n) => {
		if (n.type === 'guidance' && n.attrs?.done !== true) count++
		else if (n.type === 'text' && n.marks?.some((m) => m.type === 'placeholder')) count++
	})
	return count
}

export interface MapSectionInput {
	id: string
	parentId: string | null
	address: string
	title: string | null
	printedNumber: string | null
	stepNumber: number | null
	ownership: 'shared' | 'owned'
	updatedAt: number | null
	/** The RESOLVED body (a shared section's core body). */
	body: JsonNode | null
}

export interface MapTopologyInput {
	steps: readonly { step: number; column: number; row: number; rowSpan?: number }[]
	notes: readonly { id: string; label: string; column: number; row: number }[]
	edges: readonly PathwayMapView['edges'][number][]
	rail: { label: string; sectionSuffix: string }
	footer: { label: string }
	caption: string
}

/**
 * The pathway map read off a document's sections (decisions 72, 74): each step node
 * carries its section's title, its subtree's open items and care points and its latest
 * change; the rail lists each step's own section on the rail's subject; the footer's
 * cards are the Principles document's principle sections.
 */
export function pathwayMapView(input: {
	documentId: string
	topology: MapTopologyInput
	sections: MapSectionInput[]
	principles: {
		documentId: string
		sections: { address: string; title: string | null; icon: string | null }[]
	} | null
}): PathwayMapView {
	const { topology, sections } = input
	const byParent = new Map<string | null, MapSectionInput[]>()
	for (const s of sections) {
		const list = byParent.get(s.parentId) ?? []
		list.push(s)
		byParent.set(s.parentId, list)
	}
	const subtree = (root: MapSectionInput): MapSectionInput[] => {
		const out: MapSectionInput[] = []
		const walk = (node: MapSectionInput) => {
			out.push(node)
			for (const child of byParent.get(node.id) ?? []) walk(child)
		}
		walk(root)
		return out
	}
	const stepRoot = (step: number) =>
		sections.find((s) => s.parentId === null && s.stepNumber === step) ?? null
	const nodes: PathwayMapNodeView[] = topology.steps.map((placement) => {
		const root = stepRoot(placement.step)
		const tree = root ? subtree(root) : []
		const carePoints: string[] = []
		for (const s of tree) {
			if (!s.body) continue
			walkNodes(s.body, (n) => {
				if (n.type !== 'timeframe') return
				const [carePoint] = n.content ?? []
				if (carePoint?.type === 'carePoint') {
					const text = inlineText(carePoint)
					if (text) carePoints.push(text)
				}
			})
		}
		return {
			id: `step-${placement.step}`,
			kind: 'step',
			label: root?.title ?? `Step ${placement.step}`,
			badge: String(placement.step),
			column: placement.column,
			row: placement.row,
			rowSpan: placement.rowSpan ?? 1,
			address: root?.address ?? null,
			openItems: tree.reduce((n, s) => n + (s.ownership === 'owned' ? openItemsIn(s.body) : 0), 0),
			carePoints,
			updatedAt: tree.reduce<number | null>(
				(latest, s) =>
					s.updatedAt !== null && (latest === null || s.updatedAt > latest) ? s.updatedAt : latest,
				null,
			),
		}
	})
	for (const note of topology.notes) {
		nodes.push({
			id: note.id,
			kind: 'note',
			label: note.label,
			badge: null,
			column: note.column,
			row: note.row,
			rowSpan: 1,
			address: null,
			openItems: 0,
			carePoints: [],
			updatedAt: null,
		})
	}
	const railItems = topology.steps.flatMap((placement) => {
		const root = stepRoot(placement.step)
		const own = root
			? sections.find(
					(s) =>
						s.parentId === root.id &&
						s.address === `${root.address}/${topology.rail.sectionSuffix}`,
				)
			: null
		return root && own
			? [
					{
						label: `Step ${placement.step}: ${root.title ?? root.address}`,
						address: own.address,
						partAddress: root.address,
					},
				]
			: []
	})
	return {
		documentId: input.documentId,
		nodes,
		edges: [...topology.edges],
		rail: { label: topology.rail.label, items: railItems },
		footer: {
			label: topology.footer.label,
			documentId: input.principles?.documentId ?? null,
			items: (input.principles?.sections ?? []).map((s) => ({
				label: s.title ?? s.address,
				address: s.address,
				icon: s.icon,
			})),
		},
		caption: topology.caption,
	}
}

export function walkNodes(node: JsonNode, visit: (n: JsonNode) => void): void {
	visit(node)
	for (const child of node.content ?? []) walkNodes(child, visit)
}

/** The plain text of a node's inline content: marks dropped, atoms skipped, and with
 *  them the superscript separators between citations ("^,^"). */
export function inlineText(node: JsonNode): string {
	let out = ''
	walkNodes(node, (n) => {
		if (n.type === 'text' && !n.marks?.some((m) => m.type === 'superscript')) out += n.text ?? ''
		else if (n.type === 'hardBreak') out += ' '
	})
	return out.replace(/\s+/g, ' ').trim()
}

/** Reference ids numbered by first citation across bodies given in reading order. */
/** A section as its citations count: the heading's own markers first, then the body —
 *  the order the page numbers them in, and so the order every numbering reads them in
 *  (the workspace, the reference list, publish, the published page, the exports). */
export function citedBody(
	titleCitations: readonly string[] | null,
	body: JsonNode | null,
): JsonNode | null {
	if (!titleCitations || titleCitations.length === 0) return body
	return {
		type: 'doc',
		content: [
			{
				type: 'paragraph',
				content: titleCitations.map((id) => ({ type: 'citation', attrs: { referenceId: id } })),
			},
			...(body?.content ?? []),
		],
	}
}

export function citationNumbers(bodies: (JsonNode | null)[]): Record<string, number> {
	const numbers: Record<string, number> = {}
	let next = 1
	for (const body of bodies) {
		if (!body) continue
		walkNodes(body, (n) => {
			const id = n.type === 'citation' ? n.attrs?.referenceId : undefined
			if (typeof id === 'string' && !(id in numbers)) numbers[id] = next++
		})
	}
	return numbers
}

/** The step a published section belongs to, read off its address: a step's address is
 *  its number ("2"), its parts' open with it ("2.3.1", "2/quick-reference-guide"). A
 *  frozen section keeps no step number of its own. */
export const stepNumberOfAddress = (address: string): number | null => {
	const head = /^(\d+)(?:[./]|$)/.exec(address)?.[1]
	return head ? Number(head) : null
}

/** The timeframe boxes of a document's sections, in reading order. */
export function timeframeRows(
	sections: {
		stepNumber: number | null
		address: string
		printedNumber: string | null
		title: string | null
		body: JsonNode | null
	}[],
): TimeframeRow[] {
	const rows: TimeframeRow[] = []
	for (const s of sections) {
		if (!s.body) continue
		walkNodes(s.body, (n) => {
			if (n.type !== 'timeframe') return
			const [carePoint, ...rest] = n.content ?? []
			const statements: string[][] = []
			for (const block of rest) {
				const alternatives = (block.type === 'variants' ? (block.content ?? []) : [block])
					.map(inlineText)
					.filter((t) => t !== '')
				if (alternatives.length > 0) statements.push(alternatives)
			}
			rows.push({
				stepNumber: s.stepNumber,
				section: [s.printedNumber, s.title].filter(Boolean).join(' '),
				address: s.address,
				carePoint: carePoint?.type === 'carePoint' ? inlineText(carePoint) : '',
				statements,
			})
		})
	}
	return rows
}
