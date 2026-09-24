/**
 * The shape of a document's outline, shared by every surface that reads it: reading
 * order over the section tree, and the SPINE (decision U18) — the front matter, the seven
 * pathway steps, the back matter — that the atlas columns, the workspace spine and the
 * published page's step index all draw. Pure; server and client alike.
 */

/** An address segment ("appendix-e-members-of-the-…") held to 64 characters, cut at the
 *  last whole word ("…-for-older-people", never "…-for-older-peopl"). The templates' and
 *  the imports' addresses both end this way; each makes its own segment first. */
export function addressSegment(slug: string): string {
	if (slug.length <= 64) return slug || 'section'
	const lastBreak = slug.slice(0, 65).lastIndexOf('-')
	return (lastBreak > 0 ? slug.slice(0, lastBreak) : slug.slice(0, 64)) || 'section'
}

export interface OutlineRow {
	id: string
	parentId: string | null
	orderIndex: number
	stepNumber: number | null
}

/** Depth-first reading order over the section tree. */
export function outlineOrder<T extends Pick<OutlineRow, 'id' | 'parentId' | 'orderIndex'>>(
	rows: readonly T[],
): T[] {
	const byParent = new Map<string | null, T[]>()
	for (const row of rows) {
		const list = byParent.get(row.parentId) ?? []
		list.push(row)
		byParent.set(row.parentId, list)
	}
	const out: T[] = []
	const walk = (parentId: string | null) => {
		for (const row of (byParent.get(parentId) ?? []).sort((a, b) => a.orderIndex - b.orderIndex)) {
			out.push(row)
			walk(row.id)
		}
	}
	walk(null)
	return out
}

export const STEPS = [1, 2, 3, 4, 5, 6, 7] as const
export type Step = (typeof STEPS)[number]
export type SpineBand = 'front' | Step | 'back'
export const SPINE_BANDS: readonly SpineBand[] = ['front', ...STEPS, 'back']

const isStep = (n: number | null): n is Step => n !== null && n >= 1 && n <= 7

/** A band from its written form ('front', '3', 'back'), as a data attribute carries it. */
export const bandFrom = (value: string): SpineBand | null =>
	value === 'front' || value === 'back' ? value : (STEPS.find((s) => String(s) === value) ?? null)

/** The band a spine column is, in words: 'Front matter', 'Step 3', 'Back matter'. */
export const bandLabel = (band: SpineBand): string =>
	band === 'front' ? 'Front matter' : band === 'back' ? 'Back matter' : `Step ${band}`

export interface SpineBandRows<T> {
	band: SpineBand
	/** The top-level sections the band is made of, in order. */
	roots: T[]
	/** Every included section in the band, in reading order. */
	sections: T[]
}

/**
 * The document's rows laid on the spine. A top-level section carrying a step number is
 * that step; top-level sections before the first step are the front matter, after the
 * last the back matter. `include` decides which sections count (a hidden section and
 * everything under it, say); a section is left out with its excluded ancestor.
 */
export function spineOf<T extends OutlineRow>(
	rows: readonly T[],
	include: (row: T) => boolean = () => true,
): SpineBandRows<T>[] {
	const ordered = outlineOrder(rows)
	const byId = new Map(rows.map((r) => [r.id, r]))
	const included = (row: T): boolean => {
		for (let at: T | undefined = row; at; at = at.parentId ? byId.get(at.parentId) : undefined)
			if (!include(at)) return false
		return true
	}
	const rootOf = (row: T): T => {
		let at = row
		for (
			let parent = at.parentId ? byId.get(at.parentId) : undefined;
			parent;
			parent = at.parentId ? byId.get(at.parentId) : undefined
		)
			at = parent
		return at
	}
	const roots = ordered.filter((r) => r.parentId === null)
	const lastStepAt = roots.reduce((last, r, i) => (isStep(r.stepNumber) ? i : last), -1)
	const bandOfRoot = new Map<string, SpineBand>()
	// A top-level section between two steps belongs to the step before it.
	let step: Step | null = null
	roots.forEach((root, i) => {
		if (isStep(root.stepNumber)) step = root.stepNumber
		bandOfRoot.set(
			root.id,
			isStep(root.stepNumber)
				? root.stepNumber
				: step === null
					? 'front'
					: i > lastStepAt
						? 'back'
						: step,
		)
	})
	return SPINE_BANDS.map((band) => ({
		band,
		roots: roots.filter((r) => bandOfRoot.get(r.id) === band && included(r)),
		sections: ordered.filter((r) => bandOfRoot.get(rootOf(r).id) === band && included(r)),
	}))
}
