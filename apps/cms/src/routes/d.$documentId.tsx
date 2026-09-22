/**
 * A document's workspace: the outline as navigation (front matter, the steps, back
 * matter), the stage for the selected part (child route), and the room shared by every
 * section editor on the page.
 *
 * SSR renders from the snapshot; after hydration the live sections topic and the room
 * take over identically.
 */

import {
	WorkspaceNavigation,
	WorkspaceNavigationGroup,
	WorkspaceNavigationItem,
	WorkspaceNavigationList,
	WorkspaceShell,
	WorkspaceStage,
} from '@aicolab/ui-solid'
import { createFileRoute, Outlet, useNavigate } from '@tanstack/solid-router'
import { createContext, createEffect, createMemo, createSignal, For } from 'solid-js'
import type { SectionWireRow } from '#/lib/live-topics.ts'
import { type PathwayClient, pathwayClientFor } from '#/lib/ocp-client.ts'
import type { Role } from '#/lib/roles.ts'
import { sectionsSnapshot } from '#/server/documents.ts'
import './document.css'

export const Route = createFileRoute('/d/$documentId')({
	loader: async ({ params }) => sectionsSnapshot({ data: { documentId: params.documentId } }),
	component: DocumentShell,
})

/** What every section view on the stage needs: the outline, the room, the role. */
export interface DocumentWorkspace {
	documentId: string
	role: Role
	sections: () => SectionWireRow[]
	client: () => PathwayClient | null
}

/** Default-less: the context IS the provider, and reading it outside one throws. */
export const DocumentContext = createContext<DocumentWorkspace>()

/** A part of the document as the navigation shows it: a top-level section and its subtree. */
export interface Part {
	key: string
	label: string
	root: SectionWireRow
}

export function partsOf(sections: SectionWireRow[]): Part[] {
	return sections
		.filter((s) => s.parentId === null && !s.apparatus && !s.hidden)
		.sort((a, b) => a.orderIndex - b.orderIndex)
		.map((root) => ({
			key: root.address,
			label: root.printedNumber
				? `${root.printedNumber}: ${root.title ?? ''}`
				: (root.title ?? root.address),
			root,
		}))
}

function DocumentShell() {
	const params = Route.useParams()
	const data = Route.useLoaderData()
	const navigate = useNavigate()
	const [client, setClient] = createSignal<PathwayClient | null>(null)
	const [live, setLive] = createSignal<SectionWireRow[] | null>(null)

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

	const workspace: DocumentWorkspace = {
		get documentId() {
			return params().documentId
		},
		get role() {
			return data().role
		},
		sections,
		client,
	}

	return (
		<DocumentContext value={workspace}>
			<WorkspaceShell
				class="ocp-workspace"
				navigation={
					<WorkspaceNavigation
						label="Document outline"
						brand={<span class="ocp-shell-brand">{data().document.title}</span>}
					>
						<WorkspaceNavigationGroup id="ocp-nav-parts" label="Outline" colorBase="primary">
							<WorkspaceNavigationList label="Parts of the document">
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
					</WorkspaceNavigation>
				}
				stage={
					<WorkspaceStage label={data().document.title}>
						<Outlet />
					</WorkspaceStage>
				}
			/>
		</DocumentContext>
	)
}
