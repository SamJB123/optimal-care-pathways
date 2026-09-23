/**
 * A document's workspace: the outline as navigation (front matter, the steps, back
 * matter) with the review tools beneath it, the stage for the selected part (child
 * route), the inspector for the section in focus (its thread, its review decision, its
 * shared-content actions), and the room shared by every section editor on the page.
 *
 * SSR renders from the snapshots; after hydration the live sections topic and the room
 * take over identically. Where the document stands (versions, the open review, the
 * changes since the published version) is read once here and refreshed after an action.
 */

import {
	RaisedSheet,
	ResponsiveInspector,
	WorkspaceNavigation,
	WorkspaceNavigationGroup,
	WorkspaceNavigationItem,
	WorkspaceNavigationList,
	WorkspaceShell,
	WorkspaceStage,
} from '@aicolab/ui-solid'
import { createFileRoute, Outlet, useNavigate } from '@tanstack/solid-router'
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'
import type { SectionWireRow } from '#/lib/live-topics.ts'
import { type PathwayClient, pathwayClientFor } from '#/lib/ocp-client.ts'
import { PublishWizard } from '#/lifecycle/PublishWizard.tsx'
import { SectionInspector } from '#/lifecycle/SectionInspector.tsx'
import {
	atLeast,
	type DiffView,
	DocumentContext,
	type DocumentWorkspace,
	partsOf,
	type WorkspaceMode,
} from '#/lifecycle/workspace.ts'
import { Masthead } from '#/components/Masthead.tsx'
import { documentName } from '#/lib/labels.ts'
import { publishedHref } from '#/lib/links.ts'
import { sectionsSnapshot } from '#/server/documents.ts'
import {
	type CommentWire,
	documentState,
	listComments,
	requestReview,
} from '#/server/lifecycle-fns.ts'
import type { DocumentState } from '#/server/lifecycle.ts'
import './document.css'

export {
	atLeast,
	DocumentContext,
	type DocumentWorkspace,
	type Part,
	partsOf,
} from '#/lifecycle/workspace.ts'

export const Route = createFileRoute('/d/$documentId')({
	loader: async ({ params }) => {
		const data = { documentId: params.documentId }
		const [snapshot, state, comments] = await Promise.all([
			sectionsSnapshot({ data }),
			documentState({ data }),
			listComments({ data }),
		])
		return { ...snapshot, state, comments }
	},
	component: DocumentShell,
})

function DocumentShell() {
	const params = Route.useParams()
	const data = Route.useLoaderData()
	const navigate = useNavigate()
	const [client, setClient] = createSignal<PathwayClient | null>(null)
	const [live, setLive] = createSignal<SectionWireRow[] | null>(null)
	const [liveState, setLiveState] = createSignal<DocumentState | null>(null)
	const [liveComments, setLiveComments] = createSignal<CommentWire[] | null>(null)
	const [mode, setMode] = createSignal<WorkspaceMode>('edit')
	const [focused, setFocused] = createSignal<string | null>(null)
	const [diffView, setDiffView] = createSignal<DiffView>('marks')
	const [publishing, setPublishing] = createSignal(false)
	const [message, setMessage] = createSignal<string | null>(null)

	// Client-only by construction: effects never run during SSR. The client is a
	// page-lifetime singleton per document (lib/ocp-client.ts): this effect only
	// subscribes the outline and unsubscribes on document switch — it never creates or
	// closes a session (the hive's HiveShell / createCollectionSignal wiring).
	createEffect(
		() => params().documentId,
		(documentId) => {
			const next = pathwayClientFor(documentId)
			setClient(next)
			const update = () => {
				if (next.ready()) setLive([...next.sections.values()])
			}
			update()
			const subscription = next.sections.subscribeChanges(update)
			// The cleanup is the apply function's RETURN VALUE and writes no signal.
			return () => subscription.unsubscribe()
		},
	)

	const sections = createMemo(() => live() ?? data().sections)
	const parts = createMemo(() => partsOf(sections()))
	const state = createMemo(() => liveState() ?? data().state)
	const comments = createMemo(() => liveComments() ?? data().comments)

	const refreshState = async () => {
		setLiveState(await documentState({ data: { documentId: params().documentId } }))
	}
	const refreshComments = async () => {
		setLiveComments(await listComments({ data: { documentId: params().documentId } }))
	}

	const workspace: DocumentWorkspace = {
		get documentId() {
			return params().documentId
		},
		get document() {
			return data().document
		},
		get role() {
			return state().role
		},
		get derived() {
			return data().derived
		},
		sections,
		client,
		state,
		refreshState,
		comments,
		refreshComments,
		mode,
		setMode,
		focused,
		focus: setFocused,
		diffView,
		setDiffView,
		openPublish: () => setPublishing(true),
	}

	const changes = () => state().changes.length
	const review = () => state().review
	const reviewLine = () => {
		const r = review()
		if (!r) return 'No review requested'
		if (r.decision === 'approved') return 'Review approved in full'
		if (r.decision === 'changes_requested') return 'Review: changes requested'
		return `Review open: ${r.decided} of ${r.total} decided`
	}
	const versionLine = () => {
		const s = state()
		return s.published
			? `Published v${s.published.versionNo}${s.published.label ? ` · ${s.published.label}` : ''} · draft v${s.draft.versionNo}`
			: `Not yet published · draft v${s.draft.versionNo}`
	}

	const request = async () => {
		const note = window.prompt('A note for the reviewers (optional):', '')
		if (note === null) return
		try {
			const result = await requestReview({
				data: { documentId: params().documentId, note: note || null },
			})
			setMessage(
				`Review requested: ${result.sections} changed section${result.sections === 1 ? '' : 's'}.`,
			)
			await refreshState()
		} catch (error) {
			setMessage(error instanceof Error ? error.message : String(error))
		}
	}

	return (
		<DocumentContext value={workspace}>
			<Masthead
				crumbs={[
					{ label: 'Pathways', href: '/' },
					{ label: documentName(data().document), href: `/d/${params().documentId}`, accent: data().document.accent },
				]}
				central={state().central}
				links={
					state().published
						? [{ label: `Published, edition ${state().published?.versionNo}`, href: publishedHref(data().document.slug) }]
						: [{ label: 'Not yet published', href: `/d/${params().documentId}` }]
				}
			/>
			<WorkspaceShell
				class="ocp-workspace"
				hasRaisedSheet={publishing()}
				navigation={
					<WorkspaceNavigation
						label="Document outline"
						brand={<span class="ocp-shell-brand">{data().document.title}</span>}
					>
						<WorkspaceNavigationGroup id="ocp-nav-parts" label="Outline" colorBase="primary">
							<WorkspaceNavigationList label="Parts of the document">
								<WorkspaceNavigationItem
									label="Overview"
									mark="◈"
									onSelect={() =>
										void navigate({
											to: '/d/$documentId',
											params: { documentId: params().documentId },
										})
									}
								/>
								<For each={parts()}>
									{(part) => (
										<WorkspaceNavigationItem
											label={part.label}
											mark={part.root.printedNumber ?? '¶'}
											onSelect={() =>
												void navigate({
													to: '/d/$documentId/$part',
													params: { documentId: params().documentId, part: part.key },
												})
											}
										/>
									)}
								</For>
							</WorkspaceNavigationList>
						</WorkspaceNavigationGroup>
						<WorkspaceNavigationGroup
							id="ocp-nav-review"
							label="Review and publish"
							colorBase="secondary"
						>
							<WorkspaceNavigationList label="Where the document stands">
								<WorkspaceNavigationItem
									label={versionLine()}
									mark="⎘"
									muted
									onSelect={() => undefined}
								/>
								<WorkspaceNavigationItem
									label={reviewLine()}
									mark="✓"
									muted
									onSelect={() => undefined}
								/>
								<Show when={changes() > 0}>
									<WorkspaceNavigationItem
										label={
											mode() === 'review'
												? 'Back to editing'
												: `Review changes (${changes()} section${changes() === 1 ? '' : 's'})`
										}
										mark={mode() === 'review' ? '✎' : '⇄'}
										current={mode() === 'review'}
										onSelect={() => setMode(mode() === 'review' ? 'edit' : 'review')}
									/>
								</Show>
								<Show when={atLeast(state().role, 'member') && changes() > 0}>
									<WorkspaceNavigationItem
										label={
											review() && review()?.decision === null
												? 'Request review again'
												: 'Request review'
										}
										mark="➤"
										onSelect={() => void request()}
									/>
								</Show>
								<Show when={state().central}>
									<WorkspaceNavigationItem
										label="Publish…"
										mark="⬆"
										onSelect={() => setPublishing(true)}
									/>
								</Show>
								<WorkspaceNavigationItem
									label="Versions"
									mark="≡"
									onSelect={() =>
										void navigate({
											to: '/d/$documentId/versions',
											params: { documentId: params().documentId },
										})
									}
								/>
								<Show when={data().document.kind === 'core' && state().central}>
									<WorkspaceNavigationItem
										label="Suggestions from pathways"
										mark="✉"
										onSelect={() =>
											void navigate({
												to: '/d/$documentId/suggestions',
												params: { documentId: params().documentId },
											})
										}
									/>
								</Show>
							</WorkspaceNavigationList>
						</WorkspaceNavigationGroup>
					</WorkspaceNavigation>
				}
				stage={
					<WorkspaceStage label={data().document.title}>
						<Show when={message()}>
							{(text) => (
								<p class="ocp-workspace-message" role="status">
									{text()}
								</p>
							)}
						</Show>
						<Outlet />
					</WorkspaceStage>
				}
				inspector={
					<ResponsiveInspector label="Section" activeKey={focused()} hidden={focused() === null}>
						<SectionInspector />
					</ResponsiveInspector>
				}
			>
				<Show when={publishing()}>
					<RaisedSheet title="Publish this document" onClose={() => setPublishing(false)}>
						<PublishWizard onDone={() => setPublishing(false)} />
					</RaisedSheet>
				</Show>
			</WorkspaceShell>
		</DocumentContext>
	)
}
