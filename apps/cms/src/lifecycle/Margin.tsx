/**
 * The margin (decisions U4, U6, U9, U13, U15): the workspace's right-hand column — on a
 * phone, the drawer that rises from the bottom (ui-solid's ResponsiveInspector) — about
 * the section at the reading line, or the one the reader clicked into. In order:
 *
 *   - what the section is: its mark and number, shared / own copy / written here / added;
 *   - in a pathway, the template's notes for it: each guidance note in the template's
 *     words with one control, Done, which folds it to "Done · name · date" (openable, for
 *     the reviewer); undoing restores it. The note's mark in the text's gutter lights
 *     while the note is under the pointer;
 *   - what can be done to the section: hide or show it; add a subsection; rename or
 *     delete one the team added; put it in the quick reference guide; for shared
 *     content, suggest a change or take an own copy; for an own copy, return to the
 *     shared version (each asks once, in place);
 *   - its review decision, its comments, and what the previous edition said.
 *
 * With nothing at the reading line (the top of a part, the overview) a pathway's margin
 * shows the template's instructions for the whole document.
 */

import { Button, Chip, Field, TextArea, TextInput, ToolPanelActions, ToolPanelSection } from '@aicolab/ui-solid'
import type { JSX } from '@solidjs/web'
import { createMemo, createSignal, For, Loading, onSettled, Show, untrack, useContext } from 'solid-js'
import { RenderedBody } from '#/content/render.tsx'
import type { JsonNode } from '#/content/schema.ts'
import { forgetBody, restingBody } from '#/editors/SectionView.tsx'
import { ago, shortDate } from '#/lib/labels.ts'
import { sectionAnchor } from '#/lib/links.ts'
import { legacyOriginsOf } from '#/server/legacy-fns.ts'
import { addComment, decideSection, divergeSection, resolveComment, revertSection } from '#/server/lifecycle-fns.ts'
import { addSubsection, deleteSection, renameSection, setPointOfCare, setSectionHidden } from '#/server/structure-fns.ts'
import { divergedFrom, instructionsFor } from '#/server/workspace-fns.ts'
import { type MarginNote, marginNotesOf } from './guidance.ts'
import { atLeast, DocumentContext, MARK_GLYPH, MARK_WORDS, markOf, sectionLabel } from './workspace.ts'
import './margin.css'

export function Margin() {
	const workspace = useContext(DocumentContext)
	const section = createMemo(() => workspace.sections().find((s) => s.id === workspace.focused()) ?? null)
	return (
		<div class="ocp-margin" data-guidance={workspace.guidance}>
			<Show when={section()} keyed fallback={<WholeDocument />}>
				{(s) => <SectionMargin sectionId={s.id} />}
			</Show>
		</div>
	)
}

/** A pathway's margin with no section in view: the template's instructions. */
function WholeDocument() {
	const workspace = useContext(DocumentContext)
	const instructions = createMemo(() => instructionsFor({ data: { documentId: workspace.documentId } }))
	return (
		<Show
			when={workspace.guidance === 'margin'}
			fallback={
				<section class="ocp-margin-quiet">
					<p class="ocp-margin-kicker">This template</p>
					<p>Scroll to a section, or click into one, and its actions and comments appear here. The marks in the spine say what each pathway gets:</p>
					<MarkKey />
				</section>
			}
		>
			<section class="ocp-margin-whole" aria-labelledby="ocp-margin-whole">
				<p class="ocp-margin-kicker" id="ocp-margin-whole">
					For the whole document
				</p>
				<Loading fallback={<p class="ocp-muted">Reading the template’s instructions…</p>}>
					<Show when={instructions().sections.length > 0} fallback={<p class="ocp-muted">The template gives no instructions of its own.</p>}>
						<p class="ocp-muted">From the {instructions().source}. Scroll to a section for its own notes.</p>
						<For each={instructions().sections}>
							{(s) => (
								<div class="ocp-margin-instruction" data-depth={s.depth}>
									<p class="ocp-margin-instruction-title">{s.title ?? s.address}</p>
									<Show when={s.body}>{(body) => <RenderedBody body={body()} />}</Show>
								</div>
							)}
						</For>
					</Show>
				</Loading>
			</section>
		</Show>
	)
}

function MarkKey() {
	return (
		<dl class="ocp-margin-marks">
			<For each={['shared', 'scaffold', 'instructions'] as const}>
				{(m) => (
					<div>
						<dt data-mark={m}>{MARK_GLYPH[m]}</dt>
						<dd>{MARK_WORDS[m]}</dd>
					</div>
				)}
			</For>
		</dl>
	)
}

function SectionMargin(props: { sectionId: string }) {
	const workspace = useContext(DocumentContext)
	const s = createMemo(() => workspace.sections().find((row) => row.id === props.sectionId) ?? null)
	const change = createMemo(() => workspace.state().changes.find((c) => c.sectionId === props.sectionId) ?? null)
	const thread = createMemo(() => workspace.comments().filter((c) => c.sectionId === props.sectionId))
	const review = () => workspace.state().review
	const canEdit = () => atLeast(workspace.role, 'member')
	const canDecide = () => {
		const r = review()
		return r !== null && r.decision === null && r.superseded === 0 && atLeast(workspace.role, 'admin')
	}
	const [busy, setBusy] = createSignal(false)
	const [error, setError] = createSignal<string | null>(null)
	const run = async (action: () => Promise<unknown>) => {
		setBusy(true)
		setError(null)
		try {
			await action()
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}

	// ---- the template's notes -------------------------------------------------------
	const [body, setBody] = createSignal<JsonNode | null>(null)
	const [notesTick, setNotesTick] = createSignal(0)
	const readBody = () => {
		const control = workspace.editors.get(props.sectionId)
		if (control) {
			setBody(control.body())
			return
		}
		void restingBody(props.sectionId).then((r) => setBody(r.body))
	}
	onSettled(() => {
		readBody()
		// A drafter typing elsewhere in the section can add or remove notes: read again now
		// and then while the margin is on this section.
		const again = setInterval(readBody, 4000)
		return () => clearInterval(again)
	})
	const notes = createMemo(() => {
		notesTick()
		return workspace.guidance === 'margin' ? marginNotesOf(body()) : []
	})
	const light = (index: number | null) => {
		const host = document.getElementById(sectionAnchor(untrack(() => s()?.address ?? '')))
		const marks = host ? [...host.querySelectorAll<HTMLElement>('[data-ocp="guidance"]')] : []
		marks.forEach((m, i) => {
			if (i === index) m.dataset.lit = ''
			else delete m.dataset.lit
		})
	}
	const tick = (index: number, done: boolean) => {
		const control = workspace.editors.get(props.sectionId)
		if (!control) return
		control.setGuidanceDone(index, done, workspace.selfName())
		setBody(control.body())
		setNotesTick((n) => n + 1)
	}

	// ---- what the previous edition said -----------------------------------------------
	const origins = createMemo(() => (workspace.document.kind === 'pathway' ? legacyOriginsOf({ data: { sectionId: props.sectionId } }) : null))
	const diverged = createMemo(() => (workspace.document.kind === 'core' ? divergedFrom({ data: { sectionId: props.sectionId } }) : null))

	return (
		<Show when={s()}>
			{(row) => (
				<div class="ocp-margin-section">
					<header class="ocp-margin-head">
						<p class="ocp-margin-kicker">
							<span class="ocp-margin-mark" data-mark={markOf(row())}>
								{MARK_GLYPH[markOf(row())]}
							</span>
							{row().added ? 'Added by this document’s team' : MARK_WORDS[markOf(row())]}
							<Show when={row().hidden}> · hidden</Show>
						</p>
						<h2 class="ocp-margin-title">{sectionLabel(row())}</h2>
						<p class="ocp-margin-pin">
							<Show
								when={workspace.pinned() === row().id}
								fallback={<span class="ocp-muted">Following your reading</span>}
							>
								<span class="ocp-muted">Kept on this section · </span>
								<button type="button" class="ocp-link-button" onClick={() => workspace.focus(null)}>
									Follow my reading
								</button>
							</Show>
						</p>
						<Show when={row().updatedAt}>
							{(at) => <p class="ocp-margin-meta ocp-muted">Last changed {ago(at(), Date.now())}</p>}
						</Show>
						<Show when={change()}>
							{(c) => (
								<p class="ocp-margin-meta">
									<Show
										when={row().added || !workspace.state().published}
										fallback={
											<>
												Changed since the published edition: {c().annotated.inserted} characters added, {c().annotated.deleted} removed
											</>
										}
									>
										{workspace.state().published ? 'New in this draft' : 'Written for the first edition'}
										{c().annotated.inserted > 0 ? `: ${c().annotated.inserted} characters` : ', not yet written'}
									</Show>
								</p>
							)}
						</Show>
						<Show when={row().migrationNote}>
							{(note) => <p class="ocp-margin-meta ocp-muted">{note().replace(/^(unplaced|proposed):\s*/, 'From the previous edition: ')}</p>}
						</Show>
					</header>

					<Show when={error()}>
						{(text) => (
							<p class="ocp-margin-error" role="alert">
								{text()}
							</p>
						)}
					</Show>

					<Show when={notes().length > 0}>
						<section class="ocp-margin-notes" aria-label="The template’s notes for this section">
							<p class="ocp-margin-kicker">From the template</p>
							<For each={notes()}>
								{(note) => (
									<NoteView
										note={note}
										canTick={canEdit() && row().ownership === 'owned' && workspace.editors.get(row().id) !== undefined}
										onTick={tick}
										onLight={light}
									/>
								)}
							</For>
						</section>
					</Show>

					<Show when={canEdit() && !row().apparatus}>
						<ToolPanelSection title="This section">
							<div class="ocp-margin-actions">
								<Confirming
									label={row().hidden ? 'Show again' : `Hide ${row().printedNumber ?? 'this section'} from this ${workspace.document.kind === 'core' ? 'template' : 'pathway'}`}
									question={row().hidden ? null : 'Hide it and everything under it? Its number stays reserved, the published page leaves it out, and your review request lists it. Show again brings it back as it was.'}
									confirm="Hide it"
									busy={busy()}
									onGo={() =>
										run(async () => {
											await setSectionHidden({ data: { sectionId: row().id, hidden: !row().hidden } })
											await workspace.refreshState()
										})
									}
								/>
								<Show when={!row().hidden}>
									<AddSubsection
										busy={busy()}
										onAdd={(title) =>
											run(async () => {
												const children = workspace.sections().filter((c) => c.parentId === row().id).sort((a, b) => a.orderIndex - b.orderIndex)
												await addSubsection({ data: { parentId: row().id, title, afterId: children.at(-1)?.id ?? null } })
												await workspace.refreshState()
											})
										}
									/>
									<Show when={!row().instructions}>
										<label class="ocp-margin-toggle">
											<input
												type="checkbox"
												checked={row().pointOfCare}
												disabled={busy()}
												onChange={(e) => {
													const on = e.currentTarget.checked
													void run(() => setPointOfCare({ data: { sectionId: row().id, on } }))
												}}
											/>
											<span>
												In the quick reference guide
												<small>The guide gathers the sections marked for use at the point of care.</small>
											</span>
										</label>
									</Show>
								</Show>
								<Show when={row().added}>
									<RenameSection
										current={row().title ?? ''}
										busy={busy()}
										onRename={(title) => run(() => renameSection({ data: { sectionId: row().id, title } }))}
									/>
									<Confirming
										label="Delete this subsection"
										question="Delete it and its text? This cannot be undone once confirmed."
										confirm="Delete"
										danger
										busy={busy()}
										onGo={() =>
											run(async () => {
												await deleteSection({ data: { sectionId: row().id } })
												workspace.focus(null)
												await workspace.refreshState()
											})
										}
									/>
								</Show>
							</div>
						</ToolPanelSection>
					</Show>

					<Show when={row().ownership === 'shared' && canEdit()}>
						<ToolPanelSection title="Shared content">
							<p class="ocp-muted">
								Every pathway reads this section from the core template. Suggest a change to the central team, or take your
								own copy to write it here.
							</p>
							<Composer
								label="Suggest a change"
								action="Send the suggestion"
								busy={busy()}
								onSubmit={(text) =>
									run(async () => {
										await addComment({ data: { documentId: workspace.documentId, sectionId: row().id, kind: 'suggestion', body: text } })
										await workspace.refreshComments()
									})
								}
							/>
							<Confirming
								label="Take your own copy"
								question="Take your own copy? The shared text becomes this pathway’s draft and stops following the core template."
								confirm="Take the copy"
								busy={busy()}
								onGo={() =>
									run(async () => {
										await divergeSection({ data: { sectionId: row().id } })
										forgetBody(row().id)
										await workspace.refreshState()
									})
								}
							/>
						</ToolPanelSection>
					</Show>

					<Show when={row().ownership === 'owned' && row().coreSectionId && canEdit()}>
						<ToolPanelSection title="Your own copy of a shared section">
							<Confirming
								label="Return to the shared version"
								question="Return to the shared version? This pathway’s own text for the section is discarded."
								confirm="Return to it"
								danger
								busy={busy()}
								onGo={() =>
									run(async () => {
										await revertSection({ data: { sectionId: row().id } })
										forgetBody(row().id)
										await workspace.refreshState()
									})
								}
							/>
						</ToolPanelSection>
					</Show>

					<Show when={diverged()}>
						{(list) => (
							<Loading fallback={null}>
								<Show when={list().length > 0}>
									<ToolPanelSection title="Pathways with their own copy" meta={`${list().length}`}>
										<ul class="ocp-margin-list">
											<For each={list()}>
												{(p) => (
													<li>
														<a href={`/d/${p.documentId}`}>{p.name}</a>
													</li>
												)}
											</For>
										</ul>
									</ToolPanelSection>
								</Show>
							</Loading>
						)}
					</Show>

					<Show when={change() && review()}>
						<ToolPanelSection title="Review decision">
							<Show when={change()?.decision?.decision} fallback={<p class="ocp-muted">Waiting for a decision.</p>}>
								{(decision) => (
									<p>
										<Chip tone={decision() === 'approved' ? 'live' : 'accent'}>{decision() === 'approved' ? 'Approved' : 'Changes asked for'}</Chip>
										<Show when={change()?.decision?.note}>{(note) => <span class="ocp-muted"> {note()}</span>}</Show>
									</p>
								)}
							</Show>
							<Show when={canDecide()}>
								<DecisionStrip
									busy={busy()}
									onDecide={(decision, note) =>
										run(async () => {
											const r = review()
											if (!r) return
											await decideSection({ data: { reviewId: r.reviewId, sectionId: row().id, decision, note } })
											await workspace.refreshState()
										})
									}
								/>
							</Show>
						</ToolPanelSection>
					</Show>

					<ToolPanelSection title="Comments" meta={thread().length > 0 ? `${thread().length}` : undefined}>
						<Show when={thread().length > 0} fallback={<p class="ocp-muted">No comments on this section.</p>}>
							<For each={thread()}>
								{(comment) => (
									<article class="ocp-comment" data-resolved={comment.resolvedAt ? 'true' : undefined}>
										<header>
											<strong>{comment.authorName}</strong>
											<span class="ocp-muted"> {shortDate(comment.createdAt)}</span>
											<Show when={comment.kind === 'suggestion'}>
												<span class="ocp-comment-kind">Suggestion to the core</span>
											</Show>
										</header>
										<p>{comment.body}</p>
										<Show when={canEdit()}>
											<button
												type="button"
												class="ocp-link-button"
												disabled={busy()}
												onClick={() =>
													run(async () => {
														await resolveComment({ data: { commentId: comment.id, resolved: !comment.resolvedAt } })
														await workspace.refreshComments()
													})
												}
											>
												{comment.resolvedAt ? 'Reopen' : 'Resolve'}
											</button>
										</Show>
									</article>
								)}
							</For>
						</Show>
						<Show when={canEdit()}>
							<Composer
								label="Comment"
								action="Add the comment"
								busy={busy()}
								onSubmit={(text) =>
									run(async () => {
										await addComment({ data: { documentId: workspace.documentId, sectionId: row().id, kind: 'comment', body: text } })
										await workspace.refreshComments()
									})
								}
							/>
						</Show>
					</ToolPanelSection>

					<Show when={origins()}>
						{(found) => (
							<Loading fallback={<p class="ocp-muted">Looking up the previous edition…</p>}>
								<Show when={found().origins.length > 0}>
									<ToolPanelSection title="The previous edition said" meta={`${found().origins.length}`}>
										<p class="ocp-muted">
											From{' '}
											<Show when={found().legacySlug} fallback={found().legacyTitle}>
												{(slug) => <a href={`/legacy/${slug()}`}>{found().legacyTitle}</a>}
											</Show>
											, as printed.
										</p>
										<For each={found().origins}>
											{(origin) => (
												<details class="ocp-origin">
													<summary>
														<strong>{origin.heading ?? origin.key}</strong>
														<span class="ocp-muted"> · {origin.chars.toLocaleString()} characters</span>
													</summary>
													<Show when={origin.body}>{(b) => <RenderedBody body={b()} />}</Show>
												</details>
											)}
										</For>
									</ToolPanelSection>
								</Show>
							</Loading>
						)}
					</Show>
				</div>
			)}
		</Show>
	)
}

/** One note from the template: open, or folded once done. */
function NoteView(props: { note: MarginNote; canTick: boolean; onTick: (index: number, done: boolean) => void; onLight: (index: number | null) => void }) {
	const [open, setOpen] = createSignal(false)
	return (
		<Show
			when={props.note.kind === 'guidance' ? props.note : null}
			fallback={
				<div class="ocp-note" data-kind="instruction">
					<p>{props.note.kind === 'instruction' ? props.note.text : ''}</p>
					<p class="ocp-muted ocp-note-sub">Written into the shared text: keep or leave out the words it names by taking your own copy.</p>
				</div>
			}
		>
			{(g) => (
				<div
					class="ocp-note"
					data-done={g().done ? '' : undefined}
					onPointerEnter={() => props.onLight(g().index)}
					onPointerLeave={() => props.onLight(null)}
				>
					<Show
						when={!g().done || open()}
						fallback={
							<button type="button" class="ocp-note-folded" onClick={() => setOpen(true)} title="Read the note">
								Done{g().doneBy ? ` · ${g().doneBy}` : ''}
								{g().doneAt ? ` · ${shortDate(g().doneAt)}` : ''}
							</button>
						}
					>
						<For each={g().paragraphs}>{(p) => <p>{p}</p>}</For>
					</Show>
					<Show when={props.canTick}>
						<label class="ocp-note-tick">
							<input
								type="checkbox"
								checked={g().done}
								onChange={(e) => {
									props.onTick(g().index, e.currentTarget.checked)
									setOpen(false)
								}}
							/>
							Done
						</label>
					</Show>
				</div>
			)}
		</Show>
	)
}

/** An action that asks once, in place: the button becomes the question and two answers. */
function Confirming(props: {
	label: string
	/** Null: no question, the button acts at once. */
	question: string | null
	confirm: string
	danger?: boolean
	busy: boolean
	onGo: () => void
}): JSX.Element {
	const [asking, setAsking] = createSignal(false)
	return (
		<Show
			when={asking()}
			fallback={
				<Button
					variant="outline"
					colorBase={props.danger ? 'error' : undefined}
					disabled={props.busy}
					onClick={() => (props.question === null ? props.onGo() : setAsking(true))}
				>
					{props.label}
				</Button>
			}
		>
			{/* biome-ignore lint/a11y/useSemanticElements: a question and its two buttons, named by the action; a fieldset's legend would sit on the border */}
			<div class="ocp-confirm" role="group" aria-label={props.label}>
				<p>{props.question}</p>
				<div class="ocp-confirm-actions">
					<Button
						variant="solid"
						colorBase={props.danger ? 'error' : undefined}
						disabled={props.busy}
						onClick={() => {
							setAsking(false)
							props.onGo()
						}}
					>
						{props.confirm}
					</Button>
					<Button variant="text" onClick={() => setAsking(false)}>
						Cancel
					</Button>
				</div>
			</div>
		</Show>
	)
}

function AddSubsection(props: { busy: boolean; onAdd: (title: string) => void }) {
	const [adding, setAdding] = createSignal(false)
	const [title, setTitle] = createSignal('')
	return (
		<Show when={adding()} fallback={<Button variant="outline" disabled={props.busy} onClick={() => setAdding(true)}>Add a subsection</Button>}>
			<form
				class="ocp-inline-form"
				onSubmit={(e) => {
					e.preventDefault()
					const t = title().trim()
					if (!t) return
					props.onAdd(t)
					setTitle('')
					setAdding(false)
				}}
			>
				<Field label="Heading of the new subsection" hint="Unnumbered, under this section. Your review request lists it.">
					<TextInput value={title()} onInput={(e) => setTitle(e.currentTarget.value)} autofocus />
				</Field>
				<ToolPanelActions>
					<Button type="submit" variant="solid" disabled={props.busy || !title().trim()}>
						Add it
					</Button>
					<Button type="button" variant="text" onClick={() => setAdding(false)}>
						Cancel
					</Button>
				</ToolPanelActions>
			</form>
		</Show>
	)
}

function RenameSection(props: { current: string; busy: boolean; onRename: (title: string) => void }) {
	const [editing, setEditing] = createSignal(false)
	const [title, setTitle] = createSignal('')
	return (
		<Show
			when={editing()}
			fallback={
				<Button
					variant="outline"
					disabled={props.busy}
					onClick={() => {
						setTitle(props.current)
						setEditing(true)
					}}
				>
					Rename
				</Button>
			}
		>
			<form
				class="ocp-inline-form"
				onSubmit={(e) => {
					e.preventDefault()
					const t = title().trim()
					if (!t) return
					props.onRename(t)
					setEditing(false)
				}}
			>
				<Field label="Heading">
					<TextInput value={title()} onInput={(e) => setTitle(e.currentTarget.value)} autofocus />
				</Field>
				<ToolPanelActions>
					<Button type="submit" variant="solid" disabled={props.busy || !title().trim()}>
						Rename
					</Button>
					<Button type="button" variant="text" onClick={() => setEditing(false)}>
						Cancel
					</Button>
				</ToolPanelActions>
			</form>
		</Show>
	)
}

function DecisionStrip(props: { busy: boolean; onDecide: (decision: 'approved' | 'changes_requested', note: string | null) => void }) {
	let note!: HTMLTextAreaElement
	return (
		<div class="ocp-decision">
			<Field label="A note for the drafter (optional)">
				<TextArea ref={note} rows={2} />
			</Field>
			<ToolPanelActions>
				<Button variant="solid" colorBase="success" disabled={props.busy} onClick={() => props.onDecide('approved', note.value.trim() || null)}>
					Approve
				</Button>
				<Button variant="outline" colorBase="warning" disabled={props.busy} onClick={() => props.onDecide('changes_requested', note.value.trim() || null)}>
					Ask for changes
				</Button>
			</ToolPanelActions>
		</div>
	)
}

function Composer(props: { label: string; action: string; busy: boolean; onSubmit: (body: string) => void }) {
	let body!: HTMLTextAreaElement
	return (
		<form
			class="ocp-composer"
			onSubmit={(event) => {
				event.preventDefault()
				const text = body.value.trim()
				if (!text) return
				props.onSubmit(text)
				body.value = ''
			}}
		>
			<Field label={props.label}>
				<TextArea ref={body} rows={3} />
			</Field>
			<ToolPanelActions>
				<Button type="submit" variant="solid" disabled={props.busy}>
					{props.action}
				</Button>
			</ToolPanelActions>
		</form>
	)
}
