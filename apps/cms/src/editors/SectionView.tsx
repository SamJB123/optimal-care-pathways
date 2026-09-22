/**
 * One section on a step page: its heading, then either the live editor (an owned
 * section, once the room is up) or the read-only rendering of the body it renders
 * (a shared section: the core document's).
 *
 * The handle is opened ONCE per mount, in `onSettled` over UNTRACKED props — the hive's
 * DocPage wiring — and closed when the view leaves. Never in a reactive effect over the
 * section row: the row object is reallocated on every outline tick (a fold bumps the
 * section's `updatedAt`, the topic publishes it, `rows()` recomputes), and an effect
 * keyed on it re-opened every handle per tick. Each re-mounted editor's binding then
 * touched the body, which folded, which ticked the outline: the one-second flip
 * (2026-09-22). The editor slot is keyed by (section id, handle, room): a fresh object
 * only when a different section opens, never on a role change, never on a tick. The
 * client itself is a page-lifetime singleton and is never closed here.
 */

import type { DocHandle, DocRoomClient } from '@aicolab/app-kit/doc-room/client'
import { DOMSerializer } from '@prosekit/pm/model'
import { createEffect, createSignal, onSettled, Show, untrack, useContext } from 'solid-js'
import { contentSchema, type JsonNode, parseBody } from '#/content/schema.ts'
import type { SectionWireRow } from '#/lib/live-topics.ts'
import { pathwayClientFor } from '#/lib/ocp-client.ts'
import { DocumentContext } from '#/routes/d.$documentId.tsx'
import { sectionBody } from '#/server/documents.ts'
import SectionEditor from './SectionEditor.tsx'

export function SectionView(props: { section: SectionWireRow; depth: number }) {
	return (
		<section class="ocp-section" data-address={props.section.address}>
			<div class="ocp-section-heading">
				<Show when={props.section.printedNumber}>
					{(n) => <span class="ocp-section-number">{n()}</span>}
				</Show>
				<span class="ocp-section-title" data-depth={props.depth}>
					{props.section.title ?? props.section.address}
				</span>
			</div>
			<Show
				when={props.section.ownership === 'owned'}
				fallback={<SharedBody sectionId={props.section.id} />}
			>
				<OwnedBody sectionId={props.section.id} />
			</Show>
		</section>
	)
}

interface EditorSlot {
	id: string
	handle: DocHandle
	room: DocRoomClient
}

function OwnedBody(props: { sectionId: string }) {
	const workspace = useContext(DocumentContext)
	const [opened, setOpened] = createSignal<EditorSlot | null>(null)
	// Once per mount, untracked (see the module doc): the page-lifetime client for this
	// document, one handle for this section, closed when the view leaves.
	onSettled(() => {
		const id = untrack(() => props.sectionId)
		const client = pathwayClientFor(untrack(() => workspace.documentId))
		const handle = client.room.openDoc(id)
		setOpened({ id, handle, room: client.room })
		return () => handle.close()
	})
	return (
		<Show when={opened()} fallback={<StaticBody sectionId={props.sectionId} />} keyed>
			{({ id, handle, room }) => <SectionEditor room={room} handle={handle} sectionId={id} />}
		</Show>
	)
}

/** The resting body, rendered once; what a shared section shows, and what an owned
 *  section shows before its room is connected. */
function StaticBody(props: { sectionId: string }) {
	const [body, setBody] = createSignal<JsonNode | null | undefined>(undefined)
	// Fetched once per mount: a resting body is static by definition, and the view is
	// keyed by section id upstream, so a different section is a different mount.
	onSettled(() => {
		let cancelled = false
		void sectionBody({ data: { sectionId: untrack(() => props.sectionId) } })
			.then((result) => !cancelled && setBody(result.body))
			.catch(() => !cancelled && setBody(null))
		return () => {
			cancelled = true
		}
	})
	return (
		<Show
			when={body()}
			fallback={
				<p class="ocp-section-empty">{body() === undefined ? 'Loading…' : 'No content yet.'}</p>
			}
		>
			{(json) => <RenderedBody body={json()} />}
		</Show>
	)
}

function SharedBody(props: { sectionId: string }) {
	return (
		<div class="ocp-section-shared">
			<p class="ocp-section-shared-note">
				Shared content from the core document. Rendered by reference; not editable here.
			</p>
			<StaticBody sectionId={props.sectionId} />
		</div>
	)
}

function RenderedBody(props: { body: JsonNode }) {
	let host!: HTMLDivElement
	createEffect(
		() => props.body,
		(body) => {
			const node = parseBody(body)
			host.replaceChildren(DOMSerializer.fromSchema(contentSchema).serializeFragment(node.content))
		},
	)
	return <div class="ocp-body ocp-body-static" ref={host} />
}
