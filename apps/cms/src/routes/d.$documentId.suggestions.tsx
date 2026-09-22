/**
 * Suggestions from pathways on this core document's shared sections (decision 26): what
 * drafters asked the central team to change, newest first, resolvable here.
 */

import { Button, Chip, EmptyState, Panel } from '@aicolab/ui-solid'
import { createFileRoute, useRouter } from '@tanstack/solid-router'
import { For, Show, useContext } from 'solid-js'
import { resolveComment, suggestionsForCore } from '#/server/lifecycle-fns.ts'
import { DocumentContext } from '#/lifecycle/workspace.ts'

export const Route = createFileRoute('/d/$documentId/suggestions')({
	loader: async ({ params }) => suggestionsForCore({ data: { documentId: params.documentId } }),
	component: SuggestionsPage,
})

const when = (ms: number) =>
	new Date(ms).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })

function SuggestionsPage() {
	const suggestions = Route.useLoaderData()
	const router = useRouter()
	const workspace = useContext(DocumentContext)
	const sectionTitle = (id: string | null) => {
		const s = workspace.sections().find((row) => row.id === id)
		return s
			? `${s.printedNumber ? `${s.printedNumber} ` : ''}${s.title ?? s.address}`
			: 'a shared section'
	}
	return (
		<div class="ocp-part">
			<Panel title="Suggestions from pathways" variant="soft">
				<Show
					when={suggestions().length > 0}
					fallback={<EmptyState title="No pathway has suggested a change yet" pad="1.25rem" />}
				>
					<ul class="ocp-suggestions">
						<For each={suggestions()}>
							{(s) => (
								<li class="ocp-comment" data-resolved={s.resolvedAt ? 'true' : undefined}>
									<header>
										<strong>{s.authorName}</strong>
										<span class="ocp-muted">
											{' '}
											· {s.pathwayTitle} · {sectionTitle(s.coreSectionId)} · {when(s.createdAt)}
										</span>
										<Show when={s.resolvedAt}>
											<Chip tone="live">Resolved</Chip>
										</Show>
									</header>
									<p>{s.body}</p>
									<Button
										variant="text"
										onClick={async () => {
											await resolveComment({ data: { commentId: s.id, resolved: !s.resolvedAt } })
											await router.invalidate()
										}}
									>
										{s.resolvedAt ? 'Reopen' : 'Mark resolved'}
									</Button>
								</li>
							)}
						</For>
					</ul>
				</Show>
			</Panel>
		</div>
	)
}
