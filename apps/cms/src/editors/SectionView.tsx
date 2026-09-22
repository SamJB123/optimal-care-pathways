/**
 * One section on a step page: its heading, then either the live editor (an owned
 * section, once the room is up) or the read-only rendering of the body it renders
 * (a shared section: the core document's).
 */

import type { DocHandle, DocRoomClient } from '@aicolab/app-kit/doc-room/client'
import { DOMSerializer } from '@prosekit/pm/model'
import { createEffect, createMemo, createSignal, Show, useContext } from 'solid-js'
import { contentSchema, type JsonNode, parseBody } from '#/content/schema.ts'
import type { SectionWireRow } from '#/lib/live-topics.ts'
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

function OwnedBody(props: { sectionId: string }) {
	const workspace = useContext(DocumentContext)
	const [handle, setHandle] = createSignal<DocHandle | null>(null)
	createEffect(
		() => workspace.client(),
		(client) => {
			if (!client) return
			const opened = client.room.openDoc(props.sectionId)
			setHandle(opened)
			return () => {
				opened.close()
				setHandle(null)
			}
		},
	)
	// One value for the flow component, so its callback reads nothing at the top.
	const live = createMemo((): { room: DocRoomClient; handle: DocHandle } | null => {
		const client = workspace.client()
		const h = handle()
		return client && h ? { room: client.room, handle: h } : null
	})
	return (
		<Show when={live()} fallback={<StaticBody sectionId={props.sectionId} />}>
			{(value) => (
				<SectionEditor room={value().room} handle={value().handle} sectionId={props.sectionId} />
			)}
		</Show>
	)
}

/** The resting body, rendered once; what a shared section shows, and what an owned
 *  section shows before its room is connected. */
function StaticBody(props: { sectionId: string }) {
	const [body, setBody] = createSignal<JsonNode | null | undefined>(undefined)
	createEffect(
		() => props.sectionId,
		(sectionId) => {
			let cancelled = false
			void sectionBody({ data: { sectionId } })
				.then((result) => !cancelled && setBody(result.body))
				.catch(() => !cancelled && setBody(null))
			return () => {
				cancelled = true
			}
		},
	)
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
