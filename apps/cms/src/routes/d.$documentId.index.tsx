/**
 * The document's hub (decisions 67, 78): the pathway map as the landing view with live
 * state on its nodes, then the document's status and version, the reviews awaiting a
 * decision and the latest activity.
 */

import { ActivityFeed, EmptyState, Notice, Panel } from '@aicolab/ui-solid'
import { createFileRoute } from '@tanstack/solid-router'
import { For, Show, useContext } from 'solid-js'
import { PathwayMap } from '#/content/blocks.tsx'
import { hubSnapshot } from '#/server/documents.ts'
import { DocumentContext } from './d.$documentId.tsx'
import './hub.css'

export const Route = createFileRoute('/d/$documentId/')({
	loader: async ({ params }) => hubSnapshot({ data: { documentId: params.documentId } }),
	component: HubPage,
})

const STATUS_LABEL: Record<string, string> = {
	draft: 'Draft',
	in_review: 'In review',
	approved: 'Approved',
}

const when = (ms: number) =>
	new Date(ms).toLocaleString('en-AU', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	})

function HubPage() {
	const hub = Route.useLoaderData()
	const workspace = useContext(DocumentContext)
	const document = () => workspace.document
	return (
		<div class="ocp-hub">
			<Show
				when={workspace.derived.map}
				fallback={
					<Notice colorBase="info" variant="soft">
						This document's template declares no steps map.
					</Notice>
				}
			>
				{(map) => <PathwayMap map={map()} class="ocp-hub-map" />}
			</Show>
			<div class="ocp-hub-panels">
				<Panel title="Status" kicker={document().title} variant="soft">
					<dl class="ocp-hub-facts">
						<dt>State</dt>
						<dd>{STATUS_LABEL[document().status] ?? document().status}</dd>
						<dt>Published version</dt>
						<dd>
							{document().publishedVersionNo > 0
								? `Version ${document().publishedVersionNo}`
								: 'Not yet published'}
						</dd>
						<dt>Last change</dt>
						<dd>{document().updatedAt ? when(document().updatedAt ?? 0) : 'No changes yet'}</dd>
					</dl>
				</Panel>
				<Panel title="Open reviews" variant="soft">
					<Show
						when={hub().reviews.length > 0}
						fallback={<EmptyState title="No reviews awaiting a decision" pad="1.25rem" />}
					>
						<ul class="ocp-hub-reviews">
							<For each={hub().reviews}>
								{(review) => (
									<li>
										<span>Requested {when(review.requestedAt)}</span>
										<Show when={review.note}>
											<span class="ocp-hub-review-note">{review.note}</span>
										</Show>
									</li>
								)}
							</For>
						</ul>
					</Show>
				</Panel>
				<Panel title="Activity" variant="soft">
					<ActivityFeed
						label="Recent activity"
						items={hub().activity.map((event) => ({
							key: event.id,
							glyph: '•',
							line: (
								<>
									<strong>{event.actorName}</strong> {event.kind.replace(/[._]/g, ' ')}
								</>
							),
							time: when(event.at),
						}))}
						empty={() => <EmptyState title="Nothing has happened here yet" pad="1.25rem" />}
					/>
				</Panel>
			</div>
		</div>
	)
}
