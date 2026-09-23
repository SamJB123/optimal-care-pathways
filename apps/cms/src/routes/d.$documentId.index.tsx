/**
 * The document's overview (decisions 67, 78, S13 and the overview round): the edition's
 * imprint as the published page sets it, where the draft stands and the next step for the
 * reader's role, the review summed up (who asked, what is decided, what was sent back and
 * why), the pathway map with each step's state, the template's instructions for
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
import { legacyHref, partHref, publishedHref, sectionAnchor } from '#/lib/links.ts'
import { atLeast, type ChangeEntry, DocumentContext, sectionLabel } from '#/lifecycle/workspace.ts'
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
		case 'review.requested': {
			const count = (n: unknown, one: string, many: string) => (typeof n === 'number' && n > 0 ? `${n} ${n === 1 ? one : many}` : null)
			const covered = [count(d.sections, 'changed section', 'changed sections'), count(d.hidden, 'hidden section', 'hidden sections')].filter((p) => p !== null)
			return covered.length > 0 ? `asked for a review of ${covered.join(' and ')}` : 'asked for a review'
		}
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
			return { text: `The review waits on ${r.total - r.decided} of ${r.total} changes.`, label: 'Decide the review', go: workspace.startReview }
		if (r?.decision === 'approved' && s.central) return { text: 'The review is approved in full.', label: 'Publish…', go: workspace.openPublish }
		if (r?.decision === 'changes_requested' && atLeast(workspace.role, 'member'))
			return { text: 'The review asked for changes. Make them, then ask again.', label: 'Read the decisions', go: workspace.startReview }
		if (!r && s.changes.length > 0 && atLeast(workspace.role, 'member'))
			return {
				text: s.published
					? `${s.changes.length} change${s.changes.length === 1 ? '' : 's'} since the published edition.`
					: `Nothing is published yet: the first edition has ${s.changes.length} section${s.changes.length === 1 ? '' : 's'} to review.`,
				label: 'Ask for review',
				go: workspace.openRequestReview,
			}
		return null
	}

	// ---- the review, summed up ------------------------------------------------------
	const sentBack = createMemo(() => workspace.changeOrder().filter((e) => e.change.decision?.decision === 'changes_requested'))
	const notCovered = createMemo(() => (state().review ? workspace.changeOrder().filter((e) => e.change.decision === null).length : 0))
	const hrefOf = (e: ChangeEntry) => `${partHref(workspace.documentId, e.part)}#${sectionAnchor(e.section.address)}`

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
							Edition {state().draft.versionNo} ·{' '}
							{state().published
								? `${state().changes.length} change${state().changes.length === 1 ? '' : 's'}`
								: `${state().changes.length} section${state().changes.length === 1 ? '' : 's'} written`}
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
				<Show when={hub().legacy}>
					{(legacy) => (
						<p class="ocp-imprint-notes">
							Drafted from the <a href={legacyHref(legacy().slug)}>{`${legacy().edition?.toLowerCase() ?? 'previous edition'}, as printed`}</a>.
						</p>
					)}
				</Show>
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

			<Show when={state().review}>
				{(r) => (
					<section class="ocp-overview-review" aria-labelledby="ocp-review">
						<h2 id="ocp-review">The review</h2>
						<p>
							Asked for by {r().requestedByName} {ago(r().requestedAt, hub().now)}
							{r().note ? <>: <q>{r().note}</q></> : '.'}
						</p>
						<ul class="ocp-review-tally" aria-label="Decisions">
							<li data-tone="approved">
								<strong>{r().approved}</strong> approved
							</li>
							<li data-tone="changes_requested">
								<strong>{r().changesRequested}</strong> sent back
							</li>
							<li>
								<strong>{r().total - r().decided}</strong> waiting
							</li>
						</ul>
						<Show when={notCovered() > 0}>
							<p class="ocp-muted">
								{notCovered()} change{notCovered() === 1 ? '' : 's'} made after the request {notCovered() === 1 ? 'is' : 'are'} not in this review. Ask for review again to include{' '}
								{notCovered() === 1 ? 'it' : 'them'}.
							</p>
						</Show>
						<Show when={sentBack().length > 0}>
							<h3>Sent back for changes</h3>
							<ul class="ocp-review-sent-back">
								<For each={sentBack()}>
									{(e) => (
										<li>
											<a href={hrefOf(e)} onClick={() => workspace.setMode('review')}>
												{sectionLabel(e.section)}
											</a>
											<Show when={e.change.decision?.note}>{(note) => <span class="ocp-muted"> {note()}</span>}</Show>
										</li>
									)}
								</For>
							</ul>
						</Show>
						<Button variant="outline" onClick={() => workspace.startReview()}>
							Read the changes
						</Button>
					</section>
				)}
			</Show>

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
