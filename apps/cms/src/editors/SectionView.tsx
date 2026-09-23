/**
 * One section on a part page: its heading — the spine's mark (○ shared, ◐ diverged,
 * ● owned) in the document's colour before its number — then either the live editor (an
 * owned section, once the room is up), the read-only rendering of the body it renders (a
 * shared section: the core document's), or, in review mode (decision 108), the body
 * annotated against the published version. A hidden section collapses to its struck
 * heading with "Show again". In a pathway the template's guidance never enters the text:
 * the margin carries it (lifecycle/Margin.tsx).
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
import { Segmented } from '@aicolab/ui-solid'
import { createMemo, createSignal, For, onSettled, Show, untrack, useContext } from 'solid-js'
import { CitationInline, DerivedContext } from '#/content/blocks.tsx'
import { RenderedBody } from '#/content/render.tsx'
import type { JsonNode } from '#/content/schema.ts'
import { numberLabel } from '#/lib/labels.ts'
import { sectionAnchor } from '#/lib/links.ts'
import type { SectionWireRow } from '#/lib/live-topics.ts'
import { pathwayClientFor } from '#/lib/ocp-client.ts'
import { atLeast, DocumentContext, MARK_GLYPH, MARK_WORDS, markOf } from '#/lifecycle/workspace.ts'
import { sectionBody } from '#/server/documents.ts'
import { setSectionHidden } from '#/server/structure-fns.ts'
import SectionEditor from './SectionEditor.tsx'

/** Resting bodies fetched this page, by section: the margin reads the same ones. */
const bodies = new Map<string, Promise<{ body: JsonNode | null; coreSource: 'published' | 'draft' | null }>>()
export function restingBody(sectionId: string) {
	let found = bodies.get(sectionId)
	if (!found) {
		found = sectionBody({ data: { sectionId } }).then((r) => ({ body: r.body, coreSource: r.coreSource }))
		bodies.set(sectionId, found)
		found.catch(() => bodies.delete(sectionId))
	}
	return found
}
/** A section's resting body moved (a revert, a diverge): read it afresh next time. */
export const forgetBody = (sectionId: string) => bodies.delete(sectionId)

export function SectionView(props: { section: SectionWireRow; depth: number }) {
	const workspace = useContext(DocumentContext)
	const change = createMemo(() => workspace.state().changes.find((c) => c.sectionId === props.section.id) ?? null)
	const openComments = createMemo(
		() => workspace.comments().filter((c) => c.sectionId === props.section.id && !c.resolvedAt).length,
	)
	const focused = () => workspace.focused() === props.section.id
	const reviewing = () => workspace.mode() === 'review'
	const mark = () => markOf(props.section)
	const [busy, setBusy] = createSignal(false)
	const showAgain = async () => {
		setBusy(true)
		try {
			await setSectionHidden({ data: { sectionId: props.section.id, hidden: false } })
			await workspace.refreshState()
		} finally {
			setBusy(false)
		}
	}
	return (
		<section
			class="ocp-section"
			id={sectionAnchor(props.section.address)}
			data-section-id={props.section.id}
			data-address={props.section.address}
			data-depth={props.depth}
			data-mark={mark()}
			data-hidden={props.section.hidden ? '' : undefined}
			data-focused={focused() ? 'true' : undefined}
			onFocusIn={() => workspace.focus(props.section.id)}
			onPointerDown={() => workspace.focus(props.section.id)}
		>
			<header class="ocp-section-heading">
				<span class="ocp-section-mark" role="img" title={MARK_WORDS[mark()]} aria-label={MARK_WORDS[mark()]}>
					{MARK_GLYPH[mark()]}
				</span>
				<Show when={props.section.printedNumber}>{(n) => <span class="ocp-section-number">{numberLabel(n())}</span>}</Show>
				<span class="ocp-section-title">{props.section.title ?? props.section.address}</span>
				<TitleCitations ids={props.section.titleCitations} />
				<span class="ocp-section-meta">
					<Show when={props.section.hidden}>
						<span>Hidden from this {workspace.document.kind === 'core' ? 'template' : 'pathway'}</span>
					</Show>
					{/* Before the first edition every section is new: only a review decision marks one. */}
					<Show when={!props.section.hidden && (workspace.state().published || change()?.decision) ? change() : null}>
						{(c) => (
							<span class="ocp-section-change" data-decision={c().decision?.decision ?? undefined}>
								{c().decision?.decision === 'approved'
									? 'Approved'
									: c().decision?.decision === 'changes_requested'
										? 'Changes asked for'
										: props.section.added
											? 'New'
											: `+${c().annotated.inserted} −${c().annotated.deleted}`}
							</span>
						)}
					</Show>
					<Show when={openComments() > 0}>
						<button type="button" class="ocp-section-comments" onClick={() => workspace.focus(props.section.id)}>
							{openComments()} {openComments() === 1 ? 'comment' : 'comments'}
						</button>
					</Show>
				</span>
			</header>
			<Show
				when={!props.section.hidden}
				fallback={
					<Show when={atLeast(workspace.role, 'member')}>
						<button type="button" class="ocp-section-show" disabled={busy()} onClick={() => void showAgain()}>
							Show again
						</button>
					</Show>
				}
			>
				<Show
					when={reviewing()}
					fallback={
						<Show when={props.section.ownership === 'owned'} fallback={<SharedBody sectionId={props.section.id} />}>
							<OwnedBody sectionId={props.section.id} />
						</Show>
					}
				>
					<Show when={change()} fallback={<StaticBody sectionId={props.section.id} />}>
						{(c) => <ReviewBody body={c().annotated.body} />}
					</Show>
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
				<RenderedBody body={props.body} derived={workspace.derived} guidance={workspace.guidance} />
			</div>
		</div>
	)
}

interface EditorSlot {
	id: string
	handle: DocHandle
	room: DocRoomClient
}

/** The Insert menu's opener, set by the part page (the menu lives there, beside the
 *  toolbar); '/' on an empty line calls it with the caret's box. */
export type SlashOpener = (sectionId: string, caret: () => DOMRect) => void
let openSlash: SlashOpener = () => {}
export const setSlashOpener = (opener: SlashOpener) => {
	openSlash = opener
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
				<SectionEditor
					room={room}
					handle={handle}
					sectionId={id}
					derived={workspace.derived}
					guidance={workspace.guidance}
					register={workspace.editors.register}
					onActive={() => workspace.editors.activate(id)}
					onSlash={(caret) => openSlash(id, caret)}
				/>
			)}
		</Show>
	)
}

/** The resting body, rendered once; what a shared section shows, and what an owned
 *  section shows before its room is connected. */
function StaticBody(props: { sectionId: string; onSource?: (source: 'published' | 'draft' | null) => void }) {
	const workspace = useContext(DocumentContext)
	const [body, setBody] = createSignal<JsonNode | null | undefined>(undefined)
	// Fetched once per mount: a resting body is static by definition, and the view is
	// keyed by section id upstream, so a different section is a different mount.
	onSettled(() => {
		let cancelled = false
		const onSource = untrack(() => props.onSource)
		void restingBody(untrack(() => props.sectionId))
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
			fallback={<p class="ocp-section-empty">{body() === undefined ? 'Reading…' : 'Nothing written here yet.'}</p>}
		>
			{(json) => <RenderedBody body={json()} derived={workspace.derived} guidance={workspace.guidance} />}
		</Show>
	)
}

function SharedBody(props: { sectionId: string }) {
	const [source, setSource] = createSignal<'published' | 'draft' | null>(null)
	return (
		<div class="ocp-section-shared" data-source={source() ?? undefined}>
			<StaticBody sectionId={props.sectionId} onSource={setSource} />
		</div>
	)
}
