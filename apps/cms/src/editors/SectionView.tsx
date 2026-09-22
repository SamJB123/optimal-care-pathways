/**
 * One section on a step page: its heading with its lifecycle chips (changes since the
 * published version, comments), then either the live editor (an owned section, once the
 * room is up), the read-only rendering of the body it renders (a shared section: the
 * core document's), or — in review mode (decision 108) — the read-only annotated body,
 * changes painted inline against the published version.
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
import { Chip, Segmented } from '@aicolab/ui-solid'
import { createMemo, createSignal, For, onSettled, Show, untrack, useContext } from 'solid-js'
import { CitationInline, DerivedContext } from '#/content/blocks.tsx'
import { RenderedBody } from '#/content/render.tsx'
import type { JsonNode } from '#/content/schema.ts'
import { numberLabel } from '#/lib/labels.ts'
import type { SectionWireRow } from '#/lib/live-topics.ts'
import { pathwayClientFor } from '#/lib/ocp-client.ts'
import { DocumentContext } from '#/lifecycle/workspace.ts'
import { sectionBody } from '#/server/documents.ts'
import SectionEditor from './SectionEditor.tsx'

export function SectionView(props: { section: SectionWireRow; depth: number }) {
	const workspace = useContext(DocumentContext)
	const change = createMemo(
		() => workspace.state().changes.find((c) => c.sectionId === props.section.id) ?? null,
	)
	const openComments = createMemo(
		() =>
			workspace.comments().filter((c) => c.sectionId === props.section.id && !c.resolvedAt).length,
	)
	const focused = () => workspace.focused() === props.section.id
	const reviewing = () => workspace.mode() === 'review'
	return (
		<section
			class="ocp-section"
			data-address={props.section.address}
			data-focused={focused() ? 'true' : undefined}
			onFocusIn={() => workspace.focus(props.section.id)}
		>
			<div class="ocp-section-heading">
				<Show when={props.section.printedNumber}>
					{(n) => <span class="ocp-section-number">{numberLabel(n())}</span>}
				</Show>
				<span class="ocp-section-title" data-depth={props.depth}>
					{props.section.title ?? props.section.address}
				</span>
				<TitleCitations ids={props.section.titleCitations} />
				<span class="ocp-section-chips">
					<Show when={change()}>
						{(c) => (
							<button
								type="button"
								class="ocp-chip-button"
								onClick={() => workspace.focus(props.section.id)}
							>
								<Chip
									tone={c().decision?.decision === 'approved' ? 'live' : 'accent'}
									title="Changed since the published version"
								>
									{c().decision?.decision === 'approved'
										? 'Approved'
										: c().decision?.decision === 'changes_requested'
											? 'Changes requested'
											: `+${c().annotated.inserted} −${c().annotated.deleted}`}
								</Chip>
							</button>
						)}
					</Show>
					<button
						type="button"
						class="ocp-chip-button"
						title={
							openComments() > 0 ? `${openComments()} open comments` : 'Comment on this section'
						}
						onClick={() => workspace.focus(props.section.id)}
					>
						<Chip tone={openComments() > 0 ? 'accent' : 'plain'}>
							💬 {openComments() > 0 ? openComments() : ''}
						</Chip>
					</button>
				</span>
			</div>
			<Show
				when={reviewing()}
				fallback={
					<Show
						when={props.section.ownership === 'owned'}
						fallback={<SharedBody sectionId={props.section.id} />}
					>
						<OwnedBody sectionId={props.section.id} />
					</Show>
				}
			>
				<Show when={change()} fallback={<StaticBody sectionId={props.section.id} />}>
					{(c) => <ReviewBody body={c().annotated.body} />}
				</Show>
			</Show>
		</section>
	)
}

/** The markers a heading carries in print ("…care⁵²"), numbered with the section's. */
function TitleCitations(props: { ids: string[] }) {
	const workspace = useContext(DocumentContext)
	return (
		<Show when={props.ids.length > 0}>
			<DerivedContext value={() => workspace.derived}>
				<span class="ocp-section-citations">
					<For each={props.ids}>{(id) => <CitationInline referenceId={id} />}</For>
				</span>
			</DerivedContext>
		</Show>
	)
}

/** Review mode: the body annotated against the published version (decision 112), with
 *  the marks/clean switch (the page's, so every section flips together). */
function ReviewBody(props: { body: JsonNode }) {
	const workspace = useContext(DocumentContext)
	return (
		<div class="ocp-review-body" data-view={workspace.diffView()}>
			<Segmented
				label="Show changes"
				class="ocp-diff-switch"
				options={[
					{ id: 'marks', label: 'Changes marked' },
					{ id: 'clean', label: 'As it will publish' },
				]}
				value={workspace.diffView()}
				onChange={(view) => workspace.setDiffView(view)}
			/>
			<div class={workspace.diffView() === 'clean' ? 'ocp-body-clean' : undefined}>
				<RenderedBody body={props.body} derived={workspace.derived} />
			</div>
		</div>
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
			{({ id, handle, room }) => (
				<SectionEditor room={room} handle={handle} sectionId={id} derived={workspace.derived} />
			)}
		</Show>
	)
}

/** The resting body, rendered once; what a shared section shows, and what an owned
 *  section shows before its room is connected. */
function StaticBody(props: {
	sectionId: string
	onSource?: (source: 'published' | 'draft' | null) => void
}) {
	const workspace = useContext(DocumentContext)
	const [body, setBody] = createSignal<JsonNode | null | undefined>(undefined)
	// Fetched once per mount: a resting body is static by definition, and the view is
	// keyed by section id upstream, so a different section is a different mount.
	onSettled(() => {
		let cancelled = false
		const onSource = untrack(() => props.onSource)
		void sectionBody({ data: { sectionId: untrack(() => props.sectionId) } })
			.then((result) => {
				if (cancelled) return
				setBody(result.body)
				onSource?.(result.coreSource)
			})
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
			{(json) => <RenderedBody body={json()} derived={workspace.derived} />}
		</Show>
	)
}

function SharedBody(props: { sectionId: string }) {
	const [source, setSource] = createSignal<'published' | 'draft' | null>(null)
	return (
		<div class="ocp-section-shared">
			<p class="ocp-section-shared-note">
				{source() === 'draft'
					? 'Shared content from the core document, which has not been published yet: this is its draft.'
					: 'Shared content from the core document, as published. Select the section to suggest a change or take your own copy.'}
			</p>
			<StaticBody sectionId={props.sectionId} onSource={setSource} />
		</div>
	)
}
