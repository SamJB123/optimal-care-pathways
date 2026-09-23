/**
 * The document's overview (decisions 67, 78, S13 and the overview round): the edition's
 * imprint as the published page sets it, where the draft stands and the next step for the
 * reader's role, the pathway map with each step's state, the template's instructions for
 * the whole document (a pathway's drafters read them here and in the margin), the
 * structure changed since the last edition (sections hidden, subheadings added — what
 * the template asks a team to report), and the latest activity.
 */

import { ActivityFeed, Button, EmptyState } from '@aicolab/ui-solid'
import { createFileRoute } from '@tanstack/solid-router'
import { createMemo, For, Loading, Show, useContext } from 'solid-js'
import { PathwayMap } from '#/content/blocks.tsx'
import { RenderedBody } from '#/content/render.tsx'
import { ago, imprintDate } from '#/lib/labels.ts'
import { partHref, publishedHref, sectionAnchor } from '#/lib/links.ts'
import { atLeast, DocumentContext } from '#/lifecycle/workspace.ts'
import { type ActivityRow, hubSnapshot } from '#/server/documents.ts'
import { instructionsFor } from '#/server/workspace-fns.ts'
import './hub.css'

export const Route = createFileRoute('/d/$documentId/')({
	loader: async ({ params }) => ({ ...(await hubSnapshot({ data: { documentId: params.documentId } })), now: Date.now() }),
	component: OverviewPage,
})

/** The activity line for an event, in words. */
function describe(event: ActivityRow): string {
	const d = event.detail ?? {}
	const where = typeof d.address === 'string' ? ` ${d.address}` : ''
	switch (event.kind) {
		case 'review.requested':
			return `asked for a review of ${d.sections ?? '?'} changed section${d.sections === 1 ? '' : 's'}`
		case 'review.decided':
			return d.decision === 'approved' ? 'approved the review' : 'asked for changes in the review'
		case 'version.published':
			return `published edition ${d.versionNo ?? '?'}${d.label ? ` (${d.label})` : ''}`
		case 'section.diverged':
			return `took an own copy of section${where}`
		case 'section.reverted':
			return `returned section${where} to the shared version`
		case 'section.hidden':
			return `hid section${where}`
		case 'section.shown':
			return `showed section${where} again`
		case 'section.added':
			return `added the subsection${where}`
		case 'section.renamed':
			return `renamed the subsection${where}`
		case 'section.moved':
			return `moved the subsection${where}`
		case 'section.deleted':
			return `deleted the subsection${where}`
		case 'section.point_of_care':
			return `changed which sections are in the quick reference guide`
		case 'suggestion.made':
			return 'suggested a change to shared content'
		case 'reference.added':
			return 'added a reference'
		case 'reference.edited':
			return 'edited a reference'
		case 'reference.deleted':
			return 'deleted a reference'
		case 'document.imported':
			return 'finished the import of the previous edition'
		default:
			return event.kind.replace(/[._]/g, ' ')
	}
}

function OverviewPage() {
	const hub = Route.useLoaderData()
	const workspace = useContext(DocumentContext)
	const state = () => workspace.state()
	const instructions = createMemo(() => (workspace.guidance === 'margin' ? instructionsFor({ data: { documentId: workspace.documentId } }) : null))
	const partOf = (address: string) => {
		const row = workspace.sections().find((s) => s.address === address)
		let at = row
		while (at?.parentId) {
			const parentId = at.parentId
			at = workspace.sections().find((s) => s.id === parentId)
		}
		return at?.address ?? address
	}
	const lastChange = () => {
		const latest = workspace.sections().reduce<number | null>((max, s) => (s.updatedAt && (!max || s.updatedAt > max) ? s.updatedAt : max), null)
		return latest ? ago(latest, hub().now) : null
	}

	/** The one next step for this reader, in words, with its door. */
	const next = (): { text: string; label: string; go: () => void } | null => {
		const s = state()
		const r = s.review
		if (r && r.decision === null && atLeast(workspace.role, 'admin'))
			return { text: `The review waits on ${r.total - r.decided} of ${r.total} sections.`, label: 'Decide the review', go: () => workspace.setMode('review') }
		if (r?.decision === 'approved' && s.central) return { text: 'The review is approved in full.', label: 'Publish…', go: workspace.openPublish }
		if (r?.decision === 'changes_requested' && atLeast(workspace.role, 'member'))
			return { text: 'The review asked for changes. Make them, then ask again.', label: 'Read the decisions', go: () => workspace.setMode('review') }
		if (!r && s.changes.length > 0 && atLeast(workspace.role, 'member'))
			return {
				text: s.published
					? `${s.changes.length} section${s.changes.length === 1 ? ' has' : 's have'} changed since the published edition.`
					: `Nothing is published yet: the first edition has ${s.changes.length} section${s.changes.length === 1 ? '' : 's'} to review.`,
				label: 'Ask for review',
				go: workspace.openRequestReview,
			}
		return null
	}

	return (
		<div class="ocp-overview">
			<header class="ocp-imprint">
				<p class="ocp-imprint-kicker">{workspace.document.kind === 'core' ? 'Core template' : workspace.document.audience === 'population' ? 'Population pathway' : 'Cancer-specific pathway'}</p>
				<h1>{workspace.document.title}</h1>
				<dl class="ocp-imprint-facts">
					<div>
						<dt>Published</dt>
						<dd>
							<Show when={state().published} fallback="Not yet published">
								{(p) => (
									<>
										<a href={publishedHref(workspace.document.slug)}>{p().label ?? `Edition ${p().versionNo}`}</a>
										{p().publishedAt ? `, ${imprintDate(p().publishedAt ?? 0)}` : ''}
									</>
								)}
							</Show>
						</dd>
					</div>
					<div>
						<dt>Draft</dt>
						<dd>
							Edition {state().draft.versionNo} · {state().changes.length} section{state().changes.length === 1 ? '' : 's'}{' '}
							{state().published ? 'changed' : 'written'}
							{lastChange() ? ` · last change ${lastChange()}` : ''}
						</dd>
					</div>
					<Show when={state().review}>
						{(r) => (
							<div>
								<dt>Review</dt>
								<dd>
									{r().decision === 'approved' ? 'Approved in full' : r().decision === 'changes_requested' ? 'Changes asked for' : `Open, ${r().decided} of ${r().total} decided`}
									{r().note ? ` · “${r().note}”` : ''}
								</dd>
							</div>
						)}
					</Show>
				</dl>
				<Show when={state().published?.releaseNotes}>{(notes) => <p class="ocp-imprint-notes">{notes()}</p>}</Show>
				<Show when={next()}>
					{(n) => (
						<div class="ocp-next">
							<p>{n().text}</p>
							<Button variant="solid" onClick={() => n().go()}>
								{n().label}
							</Button>
						</div>
					)}
				</Show>
			</header>

			<Show when={workspace.derived.map}>
				{(map) => (
					<section class="ocp-overview-map" aria-label="The pathway map">
						<PathwayMap map={map()} />
					</section>
				)}
			</Show>

			<div class="ocp-overview-columns">
				<Show when={instructions()}>
					{(found) => (
						<section class="ocp-overview-instructions" aria-labelledby="ocp-whole">
							<h2 id="ocp-whole">For the whole document</h2>
							<Loading fallback={<p class="ocp-muted">Reading the template’s instructions…</p>}>
								<p class="ocp-muted">From the {found().source}: how to write this pathway. The same notes follow you in the margin.</p>
								<For each={found().sections}>
									{(s) => (
										<details class="ocp-overview-instruction" open={s.depth === 0}>
											<summary>{s.title ?? s.address}</summary>
											<Show when={s.body}>{(body) => <RenderedBody body={body()} />}</Show>
										</details>
									)}
								</For>
							</Loading>
						</section>
					)}
				</Show>

				<section class="ocp-overview-structure" aria-labelledby="ocp-structure">
					<h2 id="ocp-structure">Changed in structure since the last edition</h2>
					<Show
						when={state().structure.hidden.length + state().structure.added.length > 0}
						fallback={<p class="ocp-muted">No section hidden and no subheading added.</p>}
					>
						<Show when={state().structure.hidden.length > 0}>
							<h3>Hidden</h3>
							<ul>
								<For each={state().structure.hidden}>
									{(s) => (
										<li>
											<a href={`${partHref(workspace.documentId, partOf(s.address))}#${sectionAnchor(s.address)}`}>{s.title ?? s.address}</a>
										</li>
									)}
								</For>
							</ul>
						</Show>
						<Show when={state().structure.added.length > 0}>
							<h3>Added</h3>
							<ul>
								<For each={state().structure.added}>
									{(s) => (
										<li>
											<a href={`${partHref(workspace.documentId, partOf(s.address))}#${sectionAnchor(s.address)}`}>{s.title ?? s.address}</a>
										</li>
									)}
								</For>
							</ul>
						</Show>
					</Show>
				</section>

				<section class="ocp-overview-activity" aria-labelledby="ocp-activity">
					<h2 id="ocp-activity">Activity</h2>
					<ActivityFeed
						label="Recent activity"
						items={hub().activity.map((event) => ({
							key: event.id,
							glyph: '·',
							// A lazy slot: the feed creates the markup under its own <For> (hydration).
							line: () => (
								<>
									<strong>{event.actorName}</strong> {describe(event)}
								</>
							),
							time: ago(event.at, hub().now),
						}))}
						empty={() => <EmptyState title="Nothing has happened here yet" pad="1rem" />}
					/>
				</section>
			</div>
		</div>
	)
}
