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

import {
	Button,
	Chip,
	Field,
	TextArea,
	TextInput,
	ToolPanelActions,
	ToolPanelSection,
} from '@aicolab/ui-solid'
import type { JSX } from '@solidjs/web'
import { Link } from '@tanstack/solid-router'
import {
	createMemo,
	createSignal,
	For,
	Loading,
	onSettled,
	Show,
	untrack,
	useContext,
} from 'solid-js'
import { RenderedBody } from '#/content/render.tsx'
import type { JsonNode } from '#/content/schema.ts'
import { ago, shortDate } from '#/lib/labels.ts'
import { legacyLink, sectionAnchor, workspaceLink } from '#/lib/links.ts'
import { legacyOriginsOf } from '#/server/legacy-fns.ts'
import type { SectionChange } from '#/server/lifecycle.ts'
import {
	addComment,
	decideSection,
	divergeSection,
	revertSection,
	suggestionsForCore,
} from '#/server/lifecycle-fns.ts'
import {
	addSubsection,
	deleteSection,
	renameSection,
	setPointOfCare,
	setSectionHidden,
} from '#/server/structure-fns.ts'
import { divergedFrom, instructionsFor } from '#/server/workspace-fns.ts'
import { type MarginNote, marginNotesOf } from './guidance.ts'
import { CommentThread, Composer, SuggestionCard } from './Thread.tsx'
import {
	atLeast,
	DocumentContext,
	MARK_GLYPH,
	MARK_WORDS,
	markOf,
	sectionLabel,
} from './workspace.ts'
import './margin.css'

export function Margin() {
	const workspace = useContext(DocumentContext)
	const section = createMemo(
		() => workspace.sections().find((s) => s.id === workspace.focused()) ?? null,
	)
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
	const instructions = createMemo(() =>
		instructionsFor({ data: { documentId: workspace.documentId } }),
	)
	return (
		<Show
			when={workspace.guidance === 'margin'}
			fallback={
				<section class="ocp-margin-quiet">
					<p class="ocp-margin-kicker">This template</p>
					<p>
						Scroll to a section, or click into one, and its actions and comments appear here. The
						marks in the spine say what each pathway gets:
					</p>
					<MarkKey />
				</section>
			}
		>
			<section class="ocp-margin-whole" aria-labelledby="ocp-margin-whole">
				<p class="ocp-margin-kicker" id="ocp-margin-whole">
					For the whole document
				</p>
				<Loading fallback={<p class="ocp-muted">Reading the template’s instructions…</p>}>
					<Show
						when={instructions().sections.length > 0}
						fallback={<p class="ocp-muted">The template gives no instructions of its own.</p>}
					>
						<p class="ocp-muted">
							From the {instructions().source}. Scroll to a section for its own notes.
						</p>
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

/** What changed in a section since the published edition, in words. */
function changeLine(c: SectionChange, added: boolean, published: boolean): string {
	if (c.change === 'removal')
		return 'Hidden since the published edition: it and everything under it are left out.'
	if (added || !published) {
		const lead = published ? 'New in this draft' : 'Written for the first edition'
		return c.annotated.inserted > 0
			? `${lead}: ${c.annotated.inserted} characters`
			: `${lead}, not yet written`
	}
	// The diff counts words; links, formatting and layout can move without them.
	if (c.annotated.inserted === 0 && c.annotated.deleted === 0)
		return 'Changed since the published edition in its links, formatting or layout; the words are the same.'
	return `Changed since the published edition: ${c.annotated.inserted} characters added, ${c.annotated.deleted} removed`
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
	const change = createMemo(
		() => workspace.state().changes.find((c) => c.sectionId === props.sectionId) ?? null,
	)
	const thread = createMemo(() =>
		workspace.comments().filter((c) => c.sectionId === props.sectionId),
	)
	const canEdit = () => atLeast(workspace.role, 'member')
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
		void workspace.bodies.load(props.sectionId).then((r) => setBody(r.body))
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
	const origins = createMemo(() =>
		workspace.document.kind === 'pathway'
			? legacyOriginsOf({ data: { sectionId: props.sectionId } })
			: null,
	)
	const diverged = createMemo(() =>
		workspace.document.kind === 'core'
			? divergedFrom({ data: { sectionId: props.sectionId } })
			: null,
	)

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
							{(at) => (
								<p class="ocp-margin-meta ocp-muted">Last changed {ago(at(), Date.now())}</p>
							)}
						</Show>
						<Show when={change()}>
							{(c) => (
								<p class="ocp-margin-meta">
									{changeLine(c(), row().added, workspace.state().published !== null)}
								</p>
							)}
						</Show>
						<Show when={row().migrationNote}>
							{(note) => (
								<p class="ocp-margin-meta ocp-muted">
									{note().replace(/^(unplaced|proposed):\s*/, 'From the previous edition: ')}
								</p>
							)}
						</Show>
					</header>

					<Show when={error()}>
						{(text) => (
							<p class="ocp-margin-error" role="alert">
								{text()}
							</p>
						)}
					</Show>

					{/* Reading the changes, the decision leads. */}
					<Show when={workspace.mode() === 'review'}>
						<ReviewDecision sectionId={row().id} />
					</Show>

					<Show when={notes().length > 0}>
						<section class="ocp-margin-notes" aria-label="The template’s notes for this section">
							<p class="ocp-margin-kicker">From the template</p>
							<For each={notes()}>
								{(note) => (
									<NoteView
										note={note}
										canTick={
											canEdit() &&
											row().ownership === 'owned' &&
											workspace.editors.get(row().id) !== undefined
										}
										onTick={tick}
										onLight={light}
									/>
								)}
							</For>
						</section>
					</Show>

					<Show when={canEdit() && !row().apparatus && workspace.mode() === 'edit'}>
						<ToolPanelSection title="This section">
							<div class="ocp-margin-actions">
								<Confirming
									label={
										row().hidden
											? 'Show again'
											: `Hide ${row().printedNumber ?? 'this section'} from this ${workspace.document.kind === 'core' ? 'template' : 'pathway'}`
									}
									question={
										row().hidden
											? null
											: 'Hide it and everything under it? Its number stays reserved, the published page leaves it out, and your review request lists it. Show again brings it back as it was.'
									}
									confirm="Hide it"
									busy={busy()}
									onGo={() =>
										run(async () => {
											await setSectionHidden({
												data: { sectionId: row().id, hidden: !row().hidden },
											})
											await workspace.refreshState()
										})
									}
								/>
								<Show when={!row().hidden}>
									<AddSubsection
										busy={busy()}
										onAdd={(title) =>
											run(async () => {
												const children = workspace
													.sections()
													.filter((c) => c.parentId === row().id)
													.sort((a, b) => a.orderIndex - b.orderIndex)
												await addSubsection({
													data: { parentId: row().id, title, afterId: children.at(-1)?.id ?? null },
												})
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
												<small>
													The guide gathers the sections marked for use at the point of care.
												</small>
											</span>
										</label>
									</Show>
								</Show>
								<Show when={row().added}>
									<RenameSection
										current={row().title ?? ''}
										busy={busy()}
										onRename={(title) =>
											run(() => renameSection({ data: { sectionId: row().id, title } }))
										}
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

					<Show when={row().ownership === 'shared' && canEdit() && workspace.mode() === 'edit'}>
						<ToolPanelSection title="Shared content">
							<p class="ocp-muted">
								Every pathway reads this section from the core template. Suggest a change to the
								central team, or take your own copy to write it here.
							</p>
							<Composer
								label="Suggest a change"
								action="Send the suggestion"
								busy={busy()}
								onSubmit={(text) =>
									run(async () => {
										await addComment({
											data: {
												documentId: workspace.documentId,
												sectionId: row().id,
												kind: 'suggestion',
												body: text,
											},
										})
										await workspace.refreshComments()
									})
								}
								// A suggestion goes to the central team as a whole: it names no one.
							/>
							<Confirming
								label="Take your own copy"
								question="Take your own copy? The shared text becomes this pathway’s draft and stops following the core template."
								confirm="Take the copy"
								busy={busy()}
								onGo={() =>
									run(async () => {
										await divergeSection({ data: { sectionId: row().id } })
										workspace.bodies.forget(row().id)
										await workspace.refreshState()
									})
								}
							/>
						</ToolPanelSection>
					</Show>

					<Show
						when={
							row().ownership === 'owned' &&
							row().coreSectionId &&
							canEdit() &&
							workspace.mode() === 'edit'
						}
					>
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
										workspace.bodies.forget(row().id)
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
														<Link {...workspaceLink(p.documentId)}>{p.name}</Link>
													</li>
												)}
											</For>
										</ul>
									</ToolPanelSection>
								</Show>
							</Loading>
						)}
					</Show>

					<Show when={workspace.mode() === 'edit'}>
						<ReviewDecision sectionId={row().id} />
					</Show>

					<Show when={workspace.document.kind === 'core' && workspace.state().central}>
						<SectionSuggestions coreSectionId={row().id} />
					</Show>

					<ToolPanelSection
						title="Comments"
						meta={thread().length > 0 ? `${thread().length}` : undefined}
					>
						<CommentThread
							documentId={workspace.documentId}
							sectionId={row().id}
							comments={thread()}
							canWrite={canEdit()}
							onChanged={workspace.refreshComments}
						/>
					</ToolPanelSection>

					<Show when={origins()}>
						{(found) => (
							<Loading fallback={<p class="ocp-muted">Looking up the previous edition…</p>}>
								<Show when={found().origins.length > 0}>
									<ToolPanelSection
										title="The previous edition said"
										meta={`${found().origins.length}`}
									>
										<p class="ocp-muted">
											From{' '}
											<Show when={found().legacySlug} fallback={found().legacyTitle}>
												{(slug) => <Link {...legacyLink(slug())}>{found().legacyTitle}</Link>}
											</Show>
											, as printed.
										</p>
										<For each={found().origins}>
											{(origin) => (
												<details class="ocp-origin">
													<summary>
														<strong>{origin.heading ?? origin.key}</strong>
														<span class="ocp-muted">
															{' '}
															· {origin.chars.toLocaleString()} characters
														</span>
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
function NoteView(props: {
	note: MarginNote
	canTick: boolean
	onTick: (index: number, done: boolean) => void
	onLight: (index: number | null) => void
}) {
	const [open, setOpen] = createSignal(false)
	return (
		<Show
			when={props.note.kind === 'guidance' ? props.note : null}
			fallback={
				<div class="ocp-note" data-kind="instruction">
					<p>{props.note.kind === 'instruction' ? props.note.text : ''}</p>
					<p class="ocp-muted ocp-note-sub">
						Written into the shared text: keep or leave out the words it names by taking your own
						copy.
					</p>
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
							<button
								type="button"
								class="ocp-note-folded"
								onClick={() => setOpen(true)}
								title="Read the note"
							>
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
		<Show
			when={adding()}
			fallback={
				<Button variant="outline" disabled={props.busy} onClick={() => setAdding(true)}>
					Add a subsection
				</Button>
			}
		>
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
				<Field
					label="Heading of the new subsection"
					hint="Unnumbered, under this section. Your review request lists it."
				>
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

function RenameSection(props: {
	current: string
	busy: boolean
	onRename: (title: string) => void
}) {
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

/** A change's standing in the open review: its decision, the reviewer's strip, and in
 *  review mode the way on to the next change. */
function ReviewDecision(props: { sectionId: string }) {
	const workspace = useContext(DocumentContext)
	const change = createMemo(
		() => workspace.state().changes.find((c) => c.sectionId === props.sectionId) ?? null,
	)
	const review = () => workspace.state().review
	const canDecide = () => {
		const r = review()
		return (
			r !== null && r.decision === null && r.superseded === 0 && atLeast(workspace.role, 'admin')
		)
	}
	const [busy, setBusy] = createSignal(false)
	const [error, setError] = createSignal<string | null>(null)
	const decide = async (decision: 'approved' | 'changes_requested', note: string | null) => {
		const r = review()
		if (!r) return
		setBusy(true)
		setError(null)
		try {
			await decideSection({
				data: { reviewId: r.reviewId, sectionId: props.sectionId, decision, note },
			})
			await workspace.refreshState()
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}
	return (
		<Show when={review() ? change() : null}>
			{(c) => (
				<ToolPanelSection title="Review decision">
					<Show
						when={c().decision}
						fallback={
							<p class="ocp-muted">
								Changed after the review was requested, so this review does not cover it. Ask for
								review again to include it.
							</p>
						}
					>
						{(pinned) => (
							<>
								<Show
									when={pinned().decision}
									fallback={<p class="ocp-muted">Waiting for a decision.</p>}
								>
									{(decision) => (
										<p>
											<Chip tone={decision() === 'approved' ? 'live' : 'accent'}>
												{decision() === 'approved' ? 'Approved' : 'Changes asked for'}
											</Chip>
											<Show when={pinned().note}>
												{(note) => <span class="ocp-muted"> {note()}</span>}
											</Show>
										</p>
									)}
								</Show>
								<Show when={canDecide()}>
									<DecisionStrip
										busy={busy()}
										onDecide={(decision, note) => void decide(decision, note)}
									/>
								</Show>
							</>
						)}
					</Show>
					<Show when={error()}>
						{(text) => (
							<p class="ocp-margin-error" role="alert">
								{text()}
							</p>
						)}
					</Show>
					<Show when={workspace.mode() === 'review'}>
						<Button variant="text" onClick={() => workspace.goToChange(1)}>
							Next change to read (J)
						</Button>
					</Show>
				</ToolPanelSection>
			)}
		</Show>
	)
}

function DecisionStrip(props: {
	busy: boolean
	onDecide: (decision: 'approved' | 'changes_requested', note: string | null) => void
}) {
	let note: HTMLTextAreaElement | undefined
	const written = () => note?.value.trim() || null
	return (
		<div class="ocp-decision">
			<Field label="A note for the drafter (optional)">
				<TextArea
					ref={(el) => {
						note = el
					}}
					rows={2}
				/>
			</Field>
			<ToolPanelActions>
				<Button
					variant="solid"
					colorBase="success"
					disabled={props.busy}
					onClick={() => props.onDecide('approved', written())}
				>
					Approve
				</Button>
				<Button
					variant="outline"
					colorBase="warning"
					disabled={props.busy}
					onClick={() => props.onDecide('changes_requested', written())}
				>
					Ask for changes
				</Button>
			</ToolPanelActions>
		</div>
	)
}

/** A core section's suggestions from the pathways that share it, for the central team:
 *  what they asked, and the answer, beside the text it is about. */
function SectionSuggestions(props: { coreSectionId: string }) {
	const workspace = useContext(DocumentContext)
	const [version, setVersion] = createSignal(0)
	const all = createMemo(() => {
		version()
		return suggestionsForCore({ data: { documentId: workspace.documentId } })
	})
	const here = () => all().filter((s) => s.coreSectionId === props.coreSectionId)
	const open = () => here().filter((s) => !s.resolvedAt).length
	return (
		<Loading fallback={null}>
			<Show when={here().length > 0}>
				<ToolPanelSection
					title="Suggestions from pathways"
					meta={open() > 0 ? `${open()} open` : 'all resolved'}
				>
					<For each={here()}>
						{(suggestion) => (
							<SuggestionCard
								suggestion={suggestion}
								onChanged={async () => {
									setVersion((v) => v + 1)
								}}
							/>
						)}
					</For>
				</ToolPanelSection>
			</Show>
		</Loading>
	)
}
