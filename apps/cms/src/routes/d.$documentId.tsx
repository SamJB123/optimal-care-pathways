/**
 * A document's workspace (decisions U6, U12, U13, U24): the masthead, then ui-solid's
 * WorkspaceShell — the SPINE on the left (the document's parts, the part being read open
 * to its sections), the TEXT on the stage (the child route: the overview, a part, the
 * references, the editions), and the MARGIN on the right, which on a phone is the
 * organism's drawer rising from the bottom. The room is shared by every editor on the
 * page; the page's one toolbar acts on the editor that holds the caret.
 *
 * Where the reader is: the margin follows the section at the reading line as the page
 * scrolls, and stays on a section the reader clicks into until they ask it to follow
 * again or scroll it out of view.
 *
 * SSR renders from the snapshots; after hydration the live sections topic and the room
 * take over identically. Where the document stands (editions, the review, the changes
 * since publishing, the structure changes) is read once here and after each action.
 */

import {
	AdaptiveModalSheet,
	BottomNavigation,
	BottomNavigationCentreContent,
	openCommandPalette,
	ResponsiveInspector,
	WorkspaceShell,
	WorkspaceStage,
} from '@aicolab/ui-solid'
import { createFileRoute, Outlet, useNavigate } from '@tanstack/solid-router'
import { JUMP_ID } from '#/components/Jump.tsx'
import { createEffect, createMemo, createSignal, onSettled, Show } from 'solid-js'
import type { JumpTarget } from '#/components/Jump.tsx'
import { Masthead } from '#/components/Masthead.tsx'
import { useAuthSession } from '#/lib/auth-client.ts'
import { familyStyle } from '#/lib/family.ts'
import { documentName, numberLabel } from '#/lib/labels.ts'
import { partHref, previewHref, publishedHref, sectionAnchor } from '#/lib/links.ts'
import type { SectionWireRow } from '#/lib/live-topics.ts'
import { type PathwayClient, pathwayClientFor } from '#/lib/ocp-client.ts'
import { Margin } from '#/lifecycle/Margin.tsx'
import { PublishWizard } from '#/lifecycle/PublishWizard.tsx'
import { RequestReviewSheet } from '#/lifecycle/RequestReview.tsx'
import { Spine } from '#/lifecycle/Spine.tsx'
import {
	atLeast,
	type DiffView,
	DocumentContext,
	type DocumentWorkspace,
	type EditorControl,
	type PresenceEntry,
	type WorkspaceMode,
} from '#/lifecycle/workspace.ts'
import { spineOf } from '#/lib/outline.ts'
import { sectionsSnapshot } from '#/server/documents.ts'
import { type CommentWire, documentState, listComments } from '#/server/lifecycle-fns.ts'
import type { DocumentState } from '#/server/lifecycle.ts'
import { searchSections } from '#/server/search.ts'
import { namesIn } from '#/server/workspace-fns.ts'
import { RaisedSheet } from '@aicolab/ui-solid'
import './document.css'

export { atLeast, DocumentContext, type DocumentWorkspace, type Part, partsOf } from '#/lifecycle/workspace.ts'

export const Route = createFileRoute('/d/$documentId')({
	loader: async ({ params }) => {
		const data = { documentId: params.documentId }
		const [snapshot, state, comments] = await Promise.all([sectionsSnapshot({ data }), documentState({ data }), listComments({ data })])
		return { ...snapshot, state, comments }
	},
	component: DocumentShell,
})

function DocumentShell() {
	const params = Route.useParams()
	const data = Route.useLoaderData()
	const session = useAuthSession()
	const [client, setClient] = createSignal<PathwayClient | null>(null)
	const [live, setLive] = createSignal<SectionWireRow[] | null>(null)
	const [liveState, setLiveState] = createSignal<DocumentState | null>(null)
	const [liveComments, setLiveComments] = createSignal<CommentWire[] | null>(null)
	const [mode, setMode] = createSignal<WorkspaceMode>('edit')
	const [pinned, setPinned] = createSignal<string | null>(null)
	const [reading, setReading] = createSignal<string | null>(null)
	const [diffView, setDiffView] = createSignal<DiffView>('marks')
	const [publishing, setPublishing] = createSignal(false)
	const [asking, setAsking] = createSignal(false)
	const [showHidden, setShowHidden] = createSignal(false)
	const [active, setActive] = createSignal<string | null>(null)
	const [registry, setRegistry] = createSignal<ReadonlyMap<string, EditorControl>>(new Map(), { ownedWrite: true })
	const [online, setOnline] = createSignal<{ userId: string; sectionId: string | null }[]>([])
	const [names, setNames] = createSignal<Record<string, string>>({})
	const [contents, setContents] = createSignal(false)
	const [raise, setRaise] = createSignal(0)
	const navigate = useNavigate()

	// Client-only by construction: effects never run during SSR. The client is a
	// page-lifetime singleton per document (lib/ocp-client.ts): this effect only
	// subscribes the outline and the roster and unsubscribes on document switch — it
	// never creates or closes a session.
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
			const readRoster = () =>
				setOnline(
					next.room.online.get().map((row) => {
						const place = row.place
						const sectionId =
							place && typeof place === 'object' && !Array.isArray(place) && typeof place.sectionId === 'string' ? place.sectionId : null
						return { userId: row.userId, sectionId }
					}),
				)
			readRoster()
			const offRoster = next.room.online.subscribe(readRoster)
			// The cleanup is the apply function's RETURN VALUE and writes no signal.
			return () => {
				subscription.unsubscribe()
				offRoster()
			}
		},
	)

	// Names for the people in the room, fetched as new ones arrive.
	createEffect(
		() => ({ unknown: online().map((o) => o.userId).filter((id) => !(id in names())), documentId: params().documentId }),
		({ unknown, documentId }) => {
			if (unknown.length === 0) return
			void namesIn({ data: { documentId, userIds: unknown } }).then((found) => setNames((n) => ({ ...n, ...found })))
		},
	)

	const sections = createMemo(() => live() ?? data().sections)
	const state = createMemo(() => liveState() ?? data().state)
	const comments = createMemo(() => liveComments() ?? data().comments)
	const focused = () => pinned() ?? reading()
	const selfId = () => session().user?.id ?? null
	const presence = createMemo((): PresenceEntry[] =>
		online()
			.filter((o) => o.userId !== selfId())
			.map((o) => ({ userId: o.userId, name: names()[o.userId] ?? 'Someone', sectionId: o.sectionId })),
	)

	// Tell the room where this reader is, so others see it in their spine.
	createEffect(
		() => ({ sectionId: focused(), room: client()?.room ?? null }),
		({ sectionId, room }) => {
			room?.setPlace(sectionId ? { sectionId } : null)
		},
	)

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
		focus: setPinned,
		pinned,
		setReading,
		diffView,
		setDiffView,
		openPublish: () => setPublishing(true),
		openRequestReview: () => setAsking(true),
		get guidance() {
			return data().document.kind === 'core' ? 'inline' : 'margin'
		},
		showHidden,
		setShowHidden,
		editors: {
			register(control) {
				setRegistry((m) => new Map(m).set(control.sectionId, control))
				return () =>
					setRegistry((m) => {
						const next = new Map(m)
						next.delete(control.sectionId)
						return next
					})
			},
			get: (sectionId) => registry().get(sectionId),
			active: () => {
				const id = active()
				return id ? (registry().get(id) ?? null) : null
			},
			activate: setActive,
		},
		presence,
		selfName: () => session().user?.name ?? 'You',
	}

	// ---- the jump: this document's sections, its actions, and its words ----------------
	const jumpSections = createMemo((): JumpTarget[] => {
		const bands = spineOf(sections(), (s) => !s.apparatus && !s.hidden)
		return bands.flatMap((band) =>
			band.sections.map((s) => {
				const root = band.roots.find((r) => s.address === r.address || s.address.startsWith(`${r.address}/`) || s.address.startsWith(`${r.address}.`))
				return {
					id: `sec:${s.id}`,
					label: [s.printedNumber ? numberLabel(s.printedNumber) : null, s.title ?? s.address].filter(Boolean).join(' '),
					kind: 'Section',
					keywords: [s.address],
					go: `${partHref(params().documentId, root?.address ?? s.address)}#${sectionAnchor(s.address)}`,
				}
			}),
		)
	})
	const jumpActions = createMemo((): JumpTarget[] => [
		...(state().changes.length > 0
			? [{ id: 'act:changes', label: mode() === 'review' ? 'Back to writing' : 'Read the changes', kind: 'Action', keywords: ['review', 'diff'], go: () => setMode(mode() === 'review' ? 'edit' : 'review') }]
			: []),
		...(atLeast(state().role, 'member') && state().changes.length > 0
			? [{ id: 'act:review', label: 'Ask for review', kind: 'Action', keywords: ['request'], go: () => setAsking(true) }]
			: []),
		...(state().central ? [{ id: 'act:publish', label: 'Publish…', kind: 'Action', keywords: ['edition'], go: () => setPublishing(true) }] : []),
		{ id: 'act:editions', label: 'Editions', kind: 'Action', keywords: ['versions', 'compare'], go: `/d/${params().documentId}/versions` },
		{ id: 'act:preview', label: 'Preview the draft', kind: 'Action', keywords: ['preview'], go: previewHref(params().documentId) },
		{ id: 'act:references', label: 'References', kind: 'Action', keywords: ['citations'], go: `/d/${params().documentId}/references` },
		{ id: 'act:hidden', label: showHidden() ? 'Leave hidden sections out' : 'Show hidden sections', kind: 'Action', keywords: ['hidden'], go: () => setShowHidden(!showHidden()) },
	])
	const search = async (query: string): Promise<JumpTarget[]> =>
		(await searchSections({ data: { query, documentId: params().documentId } })).map((hit) => ({
			id: `hit:${hit.sectionId}`,
			label: hit.here ? hit.label : `${hit.documentName}: ${hit.label}`,
			detail: hit.snippet,
			kind: hit.here ? 'In the text' : 'Elsewhere',
			go: `${partHref(hit.documentId, hit.part)}#${sectionAnchor(hit.address)}`,
		}))

	onSettled(() => {
		// A section scrolled out of view lets go of the margin: it follows the reading again.
		const release = () => {
			const id = pinned()
			if (!id) return
			const el = document.querySelector(`[data-section-id="${id}"]`)
			if (!el) return
			const box = el.getBoundingClientRect()
			if (box.bottom < 0 || box.top > window.innerHeight) setPinned(null)
		}
		window.addEventListener('scroll', release, { passive: true })
		return () => window.removeEventListener('scroll', release)
	})

	return (
		<DocumentContext value={workspace}>
			<div class="ocp-document" style={familyStyle(data().document.accent)} data-kind={data().document.kind}>
				<Masthead
					crumbs={[
						{ label: 'Pathways', href: '/' },
						{ label: documentName(data().document), href: `/d/${params().documentId}`, accent: data().document.accent },
					]}
					central={state().central}
					links={
						state().published
							? [{ label: `Published edition ${state().published?.versionNo}`, href: publishedHref(data().document.slug) }]
							: []
					}
					presence={
						<Show when={presence().length > 0}>
							<span class="ocp-presence" title={presence().map((p) => p.name).join(', ')}>
								{presence().length === 1 ? `${presence()[0]?.name} is here` : `${presence().length} others here`}
							</span>
						</Show>
					}
					sections={jumpSections()}
					actions={jumpActions()}
					search={search}
				/>
				<WorkspaceShell
					class="ocp-workspace"
					hasRaisedSheet={publishing()}
					navigation={<Spine onRequestReview={() => setAsking(true)} />}
					stage={
						<WorkspaceStage label={data().document.title}>
							<Outlet />
						</WorkspaceStage>
					}
					inspector={
						// A click into a section binds the margin (and on a phone raises its drawer);
						// the reading line only changes what it shows.
						<ResponsiveInspector label="Margin" activeKey={pinned()} raise={raise()}>
							<Margin />
						</ResponsiveInspector>
					}
					mobileNavigation={
						<BottomNavigation
							label="Document"
							items={[
								{ id: 'overview', label: 'Overview', icon: () => <span aria-hidden="true">◇</span> },
								{ id: 'contents', label: 'Contents', icon: () => <span aria-hidden="true">≡</span> },
								{ id: 'margin', label: 'Margin', icon: () => <span aria-hidden="true">▤</span> },
								{ id: 'editions', label: 'Editions', icon: () => <span aria-hidden="true">⎘</span> },
							]}
							activeId={null}
							onSelect={(id) => {
								if (id === 'overview') void navigate({ to: '/d/$documentId', params: { documentId: params().documentId } })
								else if (id === 'contents') setContents(true)
								else if (id === 'margin') setRaise((n) => n + 1)
								else void navigate({ to: '/d/$documentId/versions', params: { documentId: params().documentId } })
							}}
							centre={
								<button type="button" class="ocp-bnav-jump" onClick={() => openCommandPalette(JUMP_ID)}>
									<BottomNavigationCentreContent icon={<span aria-hidden="true">⌕</span>} label="Jump" />
								</button>
							}
						/>
					}
				>
					<Show when={publishing()}>
						<RaisedSheet title="Publish this document" onClose={() => setPublishing(false)}>
							<PublishWizard onDone={() => setPublishing(false)} />
						</RaisedSheet>
					</Show>
				</WorkspaceShell>
				<RequestReviewSheet open={asking()} onDismiss={() => setAsking(false)} />
				{/* On a phone the spine is a sheet the bottom bar opens. */}
				<AdaptiveModalSheet open={contents()} label="Contents" title="Contents" onDismiss={() => setContents(false)}>
					{/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: a delegated listener: the clicks come from the spine's own buttons and links, which the keyboard activates too */}
					<div class="ocp-contents-sheet" onClick={(e) => e.target instanceof HTMLElement && e.target.closest('button, a') && setContents(false)}>
						<Spine onRequestReview={() => setAsking(true)} />
					</div>
				</AdaptiveModalSheet>
			</div>
		</DocumentContext>
	)
}
