/**
 * One part of the document (a step, a front- or back-matter part) as a continuous page:
 * the page's one toolbar at the top of the text column, then every section of the
 * subtree in order — an owned section as its live editor, a shared section rendered
 * read-only from the core document, a hidden one (while hidden sections are shown)
 * collapsed to its struck heading.
 *
 * The READING LINE: a third of the way down the stage, below the masthead and the
 * toolbar. The section whose heading most recently crossed it is the one the margin is
 * about, until the reader clicks into another (the shell's pin).
 */

import { Notice } from '@aicolab/ui-solid'
import { createFileRoute } from '@tanstack/solid-router'
import { createMemo, For, onSettled, Show, useContext } from 'solid-js'
import { MapContext } from '#/content/blocks.tsx'
import { SectionView } from '#/editors/SectionView.tsx'
import { StageToolbar } from '#/editors/tools/Toolbar.tsx'
import { partHref } from '#/lib/links.ts'
import type { SectionWireRow } from '#/lib/live-topics.ts'
import { ReviewBar } from '#/lifecycle/ReviewBar.tsx'
import { atLeast, DocumentContext, partsOf } from '#/lifecycle/workspace.ts'

export const Route = createFileRoute('/d/$documentId/$part')({ component: PartPage })

/** The subtree under `root`, depth-first in reading order. A hidden section is left out
 *  unless `shown` says otherwise (hidden sections on request; a removal under review). */
function subtree(
	sections: SectionWireRow[],
	root: SectionWireRow,
	shown: (hidden: SectionWireRow) => boolean,
): { section: SectionWireRow; depth: number }[] {
	const byParent = new Map<string | null, SectionWireRow[]>()
	for (const s of sections) {
		const list = byParent.get(s.parentId) ?? []
		list.push(s)
		byParent.set(s.parentId, list)
	}
	const out: { section: SectionWireRow; depth: number }[] = []
	const walk = (node: SectionWireRow, depth: number) => {
		if (node.apparatus || (node.hidden && !shown(node))) return
		out.push({ section: node, depth })
		// A hidden section's subsections are hidden with it: its struck heading stands for all.
		if (node.hidden) return
		for (const child of (byParent.get(node.id) ?? []).sort((a, b) => a.orderIndex - b.orderIndex))
			walk(child, depth + 1)
	}
	walk(root, 0)
	return out
}

function PartPage() {
	const params = Route.useParams()
	const workspace = useContext(DocumentContext)
	const root = createMemo(
		() =>
			workspace.sections().find((s) => s.parentId === null && s.address === params().part) ?? null,
	)
	const reviewing = () => workspace.mode() === 'review'
	const changed = createMemo(() => new Set(workspace.state().changes.map((c) => c.sectionId)))
	const rows = createMemo(() => {
		const r = root()
		if (!r) return []
		// Review mode shows a removal (struck) whatever the hidden switch says.
		const all = subtree(
			workspace.sections(),
			r,
			(hidden) => workspace.showHidden() || (reviewing() && changed().has(hidden.id)),
		)
		return reviewing() && workspace.reviewScope() === 'changed'
			? all.filter((row) => changed().has(row.section.id))
			: all
	})
	/** The next part along with a change in it, for a part read changed-only with none. */
	const nextChangedPart = createMemo(() => {
		const keys = partsOf(workspace.sections(), true).map((p) => p.key)
		const here = keys.indexOf(params().part)
		const withChanges = [...new Set(workspace.changeOrder().map((e) => e.part))]
		return (
			withChanges.find((p) => keys.indexOf(p) > here) ??
			withChanges.find((p) => p !== params().part) ??
			null
		)
	})
	// The step this part is (for the map's ring), read where it is used.
	const at = () => ({ currentStep: rows()[0]?.section.stepNumber ?? null })
	let page: HTMLDivElement | undefined

	onSettled(() => {
		// The reading line: whichever section's top most recently passed it. The observer
		// only says when to look; the pick reads positions.
		const line = () => window.innerHeight * 0.34
		const pick = () => {
			if (!page) return
			const sections = [...page.querySelectorAll<HTMLElement>('.ocp-section[data-section-id]')]
			let current: string | null = null
			for (const el of sections) {
				if (el.getBoundingClientRect().top <= line()) current = el.dataset.sectionId ?? null
				else break
			}
			workspace.setReading(current)
		}
		const observer = new IntersectionObserver(pick, {
			rootMargin: '0px 0px -66% 0px',
			threshold: [0, 1],
		})
		const watch = () => {
			observer.disconnect()
			for (const el of page?.querySelectorAll('.ocp-section[data-section-id]') ?? [])
				observer.observe(el)
			pick()
		}
		watch()
		const mutations = new MutationObserver(watch)
		if (page) mutations.observe(page, { childList: true })
		// Arriving at #section from the jump or a link: take the reader there.
		if (location.hash)
			document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' })
		return () => {
			observer.disconnect()
			mutations.disconnect()
			workspace.setReading(null)
		}
	})

	return (
		<MapContext value={at}>
			<Show
				when={reviewing()}
				fallback={
					<Show when={atLeast(workspace.role, 'member')}>
						<StageToolbar />
					</Show>
				}
			>
				<ReviewBar />
			</Show>
			<div class="ocp-part" ref={page}>
				<Show
					when={rows().length > 0}
					fallback={
						<Show
							when={root() && reviewing()}
							fallback={
								<Notice colorBase="info" variant="soft">
									This document has no such part.
								</Notice>
							}
						>
							<div class="ocp-review-empty">
								<p>Nothing in this part has changed since the published edition.</p>
								<Show when={nextChangedPart()}>
									{(part) => (
										<a class="ocp-link-button" href={partHref(workspace.documentId, part())}>
											To the next part with changes
										</a>
									)}
								</Show>
							</div>
						</Show>
					}
				>
					{/* Keyed by the SECTION ID — never by the row object, which `rows()` allocates
					    afresh on every outline tick. Identity keying remounted every section view
					    (and reopened every facet) on each live update, which the fold's own
					    republish then re-triggered: the one-second flip. See the hive's DocPage:
					    the editor slot is keyed by the doc, never by a projection tick. */}
					<For each={rows()} keyed={(row) => row.section.id}>
						{(row) => <SectionView section={row().section} depth={row().depth} />}
					</For>
				</Show>
			</div>
		</MapContext>
	)
}
