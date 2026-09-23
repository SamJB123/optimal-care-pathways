/**
 * Suggestions from pathways on this core document's shared sections (decision 26, and the
 * scope round): what drafters asked the central team to change, GROUPED BY THE CORE
 * SECTION they are about, in reading order, the open ones first within each. Each can be
 * answered here (a reply, a reply that resolves, or resolving), which emails the drafter
 * and lands in their margin; "Open beside the text" goes to the section in this workspace,
 * where the margin carries the same suggestions next to the words they are about.
 */

import { EmptyState } from '@aicolab/ui-solid'
import { createFileRoute, useRouter } from '@tanstack/solid-router'
import { createMemo, For, Show, useContext } from 'solid-js'
import { partHref, sectionAnchor } from '#/lib/links.ts'
import { SuggestionCard } from '#/lifecycle/Thread.tsx'
import { DocumentContext, sectionLabel } from '#/lifecycle/workspace.ts'
import { outlineOrder } from '#/lib/outline.ts'
import type { SuggestionWire } from '#/server/lifecycle.ts'
import { suggestionsForCore } from '#/server/lifecycle-fns.ts'
import './suggestions.css'

export const Route = createFileRoute('/d/$documentId/suggestions')({
	loader: async ({ params }) => suggestionsForCore({ data: { documentId: params.documentId } }),
	component: SuggestionsPage,
})

function SuggestionsPage() {
	const suggestions = Route.useLoaderData()
	const router = useRouter()
	const workspace = useContext(DocumentContext)
	/** The core sections with suggestions, in reading order, each with its own. */
	const groups = createMemo(() => {
		const sections = workspace.sections()
		const byId = new Map(sections.map((s) => [s.id, s]))
		const rootOf = (id: string) => {
			let at = byId.get(id)
			while (at?.parentId) at = byId.get(at.parentId)
			return at?.address ?? null
		}
		const bySection = new Map<string, SuggestionWire[]>()
		for (const s of suggestions()) if (s.coreSectionId) bySection.set(s.coreSectionId, [...(bySection.get(s.coreSectionId) ?? []), s])
		// Reading order over the whole outline, then the sections that have suggestions.
		return outlineOrder(sections)
			.filter((s) => bySection.has(s.id))
			.map((section) => ({
				section,
				part: rootOf(section.id),
				items: (bySection.get(section.id) ?? []).toSorted((a, b) => Number(a.resolvedAt !== null) - Number(b.resolvedAt !== null) || b.createdAt - a.createdAt),
			}))
	})
	const open = () => suggestions().filter((s) => !s.resolvedAt).length
	return (
		<div class="ocp-part ocp-suggestions-page">
			<header class="ocp-suggestions-head">
				<h1>Suggestions from pathways</h1>
				<p class="ocp-muted">
					{suggestions().length === 0
						? 'What pathway teams ask the central team to change in the shared content, section by section.'
						: `${open()} open of ${suggestions().length}, across ${groups().length} section${groups().length === 1 ? '' : 's'}.`}
				</p>
			</header>
			<Show when={groups().length > 0} fallback={<EmptyState title="No pathway has suggested a change yet" pad="1.25rem" />}>
				<For each={groups()}>
					{(group) => (
						<section class="ocp-suggestions-group" aria-label={sectionLabel(group.section)}>
							<header>
								<h2>{sectionLabel(group.section)}</h2>
								<Show when={group.part}>
									{(part) => (
										<a class="ocp-link-button" href={`${partHref(workspace.documentId, part())}#${sectionAnchor(group.section.address)}`}>
											Open beside the text
										</a>
									)}
								</Show>
							</header>
							<For each={group.items}>{(s) => <SuggestionCard suggestion={s} onChanged={() => router.invalidate()} />}</For>
						</section>
					)}
				</For>
			</Show>
		</div>
	)
}
