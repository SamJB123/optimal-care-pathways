/**
 * One part of the document (a step, the front matter, the back matter) as a continuous
 * page: every section of the subtree in order, an owned section as its live editor, a
 * shared section rendered read-only from the core document.
 */

import { Notice } from '@aicolab/ui-solid'
import { createFileRoute } from '@tanstack/solid-router'
import { createMemo, For, Show, useContext } from 'solid-js'
import { SectionView } from '#/editors/SectionView.tsx'
import type { SectionWireRow } from '#/lib/live-topics.ts'
import { DocumentContext } from './d.$documentId.tsx'

export const Route = createFileRoute('/d/$documentId/$part')({ component: PartPage })

/** The subtree under `root`, depth-first in reading order. */
function subtree(
	sections: SectionWireRow[],
	root: SectionWireRow,
): { section: SectionWireRow; depth: number }[] {
	const byParent = new Map<string | null, SectionWireRow[]>()
	for (const s of sections) {
		const list = byParent.get(s.parentId) ?? []
		list.push(s)
		byParent.set(s.parentId, list)
	}
	const out: { section: SectionWireRow; depth: number }[] = []
	const walk = (node: SectionWireRow, depth: number) => {
		if (node.hidden || node.apparatus) return
		out.push({ section: node, depth })
		for (const child of (byParent.get(node.id) ?? []).sort((a, b) => a.orderIndex - b.orderIndex))
			walk(child, depth + 1)
	}
	walk(root, 0)
	return out
}

function PartPage() {
	const params = Route.useParams()
	const workspace = useContext(DocumentContext)
	const rows = createMemo(() => {
		const root = workspace
			.sections()
			.find((s) => s.parentId === null && s.address === params().part)
		return root ? subtree(workspace.sections(), root) : []
	})
	return (
		<div class="ocp-part">
			<Show
				when={rows().length > 0}
				fallback={
					<Notice colorBase="info" variant="soft">
						No such part of this document.
					</Notice>
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
	)
}
