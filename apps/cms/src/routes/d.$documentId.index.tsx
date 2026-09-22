/**
 * The document's hub (decisions 67, 78, 88): the pathway map as the landing view with
 * live state on its nodes, then where the document stands — its published and draft
 * versions, the review under way, the changes waiting — and the latest activity.
 */

import { ActivityFeed, Button, EmptyState, Notice, Panel } from '@aicolab/ui-solid'
import { createFileRoute } from '@tanstack/solid-router'
import { Show, useContext } from 'solid-js'
import { PathwayMap } from '#/content/blocks.tsx'
import { type ActivityRow, hubSnapshot } from '#/server/documents.ts'
import { atLeast, DocumentContext } from '#/lifecycle/workspace.ts'
import './hub.css'

export const Route = createFileRoute('/d/$documentId/')({
	loader: async ({ params }) => hubSnapshot({ data: { documentId: params.documentId } }),
	component: HubPage,
})

const when = (ms: number) =>
	new Date(ms).toLocaleString('en-AU', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	})

/** The activity line for an event, in words. */
function describe(event: ActivityRow): string {
	const d = event.detail ?? {}
	switch (event.kind) {
		case 'review.requested':
			return `requested a review of ${d.sections ?? '?'} changed section${d.sections === 1 ? '' : 's'}`
		case 'review.decided':
			return d.decision === 'approved'
				? 'approved the review in full'
				: 'asked for changes in the review'
		case 'version.published':
			return `published version ${d.versionNo ?? '?'}${d.label ? ` (${d.label})` : ''}`
		case 'section.diverged':
			return `took an own copy of section ${d.address ?? ''}`
		case 'section.reverted':
			return `returned section ${d.address ?? ''} to the shared version`
		case 'suggestion.made':
			return 'suggested a change to shared content'
		default:
			return event.kind.replace(/[._]/g, ' ')
	}
}

function HubPage() {
	const hub = Route.useLoaderData()
	const workspace = useContext(DocumentContext)
	const document = () => workspace.document
	const state = () => workspace.state()
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
				<Panel title="Versions" kicker={document().title} variant="soft">
					<dl class="ocp-hub-facts">
						<dt>Published</dt>
						<dd>
							<Show when={state().published} fallback="Not yet published">
								{(p) => (
									<>
										Version {p().versionNo}
										{p().label ? ` · ${p().label}` : ''}
										<Show when={p().publishedAt}>
											{(at) => <span class="ocp-muted"> · {when(at())}</span>}
										</Show>
									</>
								)}
							</Show>
						</dd>
						<dt>Draft</dt>
						<dd>
							Version {state().draft.versionNo} · {state().changes.length} section
							{state().changes.length === 1 ? '' : 's'} changed
						</dd>
						<dt>Last change</dt>
						<dd>{document().updatedAt ? when(document().updatedAt ?? 0) : 'No changes yet'}</dd>
					</dl>
					<Show when={state().published?.releaseNotes}>
						{(notes) => (
							<p class="ocp-hub-release-notes">
								<strong>What changed:</strong> {notes()}
							</p>
						)}
					</Show>
					<Show when={state().central}>
						<div class="ocp-hub-actions">
							<Button variant="solid" colorBase="primary" onClick={() => workspace.openPublish()}>
								Publish…
							</Button>
						</div>
					</Show>
				</Panel>
				<Panel title="Review" variant="soft">
					<Show
						when={state().review}
						fallback={
							<EmptyState
								title={
									state().changes.length > 0
										? 'Changes are waiting for a review request'
										: 'Nothing has changed since the published version'
								}
								pad="1.25rem"
							/>
						}
					>
						{(review) => (
							<dl class="ocp-hub-facts">
								<dt>State</dt>
								<dd>
									{review().decision === 'approved'
										? 'Approved in full'
										: review().decision === 'changes_requested'
											? 'Changes requested'
											: `Open · ${review().decided} of ${review().total} decided`}
								</dd>
								<dt>Requested</dt>
								<dd>{when(review().requestedAt)}</dd>
								<dt>Note</dt>
								<dd class="ocp-hub-review-note">{review().note ?? 'No note'}</dd>
							</dl>
						)}
					</Show>
					<Show when={state().changes.length > 0}>
						<div class="ocp-hub-actions">
							<Button variant="outline" onClick={() => workspace.setMode('review')}>
								Read the changes
							</Button>
							<Show when={atLeast(workspace.role, 'admin') && state().review?.decision === null}>
								<span class="ocp-muted">Decide each section from its inspector.</span>
							</Show>
						</div>
					</Show>
				</Panel>
				<Panel title="Activity" variant="soft">
					<ActivityFeed
						label="Recent activity"
						items={hub().activity.map((event) => ({
							key: event.id,
							glyph: '•',
							// A lazy slot: the feed creates the markup under its own <For> (hydration).
							line: () => (
								<>
									<strong>{event.actorName}</strong> {describe(event)}
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
