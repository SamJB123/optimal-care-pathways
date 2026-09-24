/**
 * Conversation on a section (decisions 99, 110, 26, and the scope round's email items):
 * the COMPOSER, which offers the document's people as the writer types "@" and sends
 * whom it names so they are emailed; a section's THREAD, replies set under the comment
 * they answer; and a SUGGESTION as the central team reads it — the pathway and drafter,
 * the words, the pathway's own copy when it has taken one, the replies, and the answer
 * (reply, reply and resolve, resolve), which emails the drafter and lands in their margin.
 */

import { Button, Field, TextArea, ToolPanelActions } from '@aicolab/ui-solid'
import { Link } from '@tanstack/solid-router'
import { createMemo, createSignal, createUniqueId, For, onSettled, Show, untrack } from 'solid-js'
import { shortDate } from '#/lib/labels.ts'
import { workspaceLink } from '#/lib/links.ts'
import type { SuggestionWire } from '#/server/lifecycle.ts'
import {
	addComment,
	type CommentWire,
	replyToSuggestion,
	resolveComment,
} from '#/server/lifecycle-fns.ts'
import { mentionable } from '#/server/workspace-fns.ts'
import './thread.css'

interface Person {
	userId: string
	name: string
	team: 'document' | 'central'
}

/** Who may be named, per document: fetched once a page. */
const people = new Map<string, Promise<Person[]>>()
const peopleOf = (documentId: string): Promise<Person[]> => {
	let found = people.get(documentId)
	if (!found) {
		found = mentionable({ data: { documentId } })
		people.set(documentId, found)
		found.catch(() => people.delete(documentId))
	}
	return found
}

/** The "@name" being typed just before the caret, if any. */
const MENTION_AT_CARET = /(?:^|\s)@([\p{L}\p{M}'’.-]*(?: [\p{L}\p{M}'’.-]*)?)$/u

export function Composer(props: {
	label: string
	action: string
	busy: boolean
	/** The document whose people "@" offers; none, no mentions. */
	documentId?: string
	onSubmit: (body: string, mentions: string[]) => void
	/** A second way to send, beside the first ("Reply and resolve"). */
	also?: { action: string; onSubmit: (body: string, mentions: string[]) => void }
}) {
	let area: HTMLTextAreaElement | undefined
	const listId = `ocp-mentions-${createUniqueId()}`
	const [everyone, setEveryone] = createSignal<Person[]>([])
	const [query, setQuery] = createSignal<string | null>(null)
	const [active, setActive] = createSignal(0)
	// Name → person, for everyone picked from the list; sent only if the name is still there.
	const [named, setNamed] = createSignal<ReadonlyMap<string, string>>(new Map())
	onSettled(() => {
		const documentId = untrack(() => props.documentId)
		if (documentId) void peopleOf(documentId).then(setEveryone, () => setEveryone([]))
	})
	const matches = createMemo(() => {
		const q = query()
		if (q === null) return []
		const needle = q.trim().toLowerCase()
		return everyone()
			.filter((p) => p.name.toLowerCase().includes(needle))
			.slice(0, 6)
	})
	const readCaret = () => {
		if (!area) return
		const found = MENTION_AT_CARET.exec(area.value.slice(0, area.selectionStart))
		setQuery(found ? (found[1] ?? '') : null)
		setActive(0)
	}
	const pick = (person: Person) => {
		if (!area) return
		const caret = area.selectionStart
		const before = area.value.slice(0, caret).replace(/@[^@]*$/, `@${person.name} `)
		area.value = before + area.value.slice(caret)
		area.setSelectionRange(before.length, before.length)
		area.focus()
		setNamed((m) => new Map(m).set(person.name, person.userId))
		setQuery(null)
	}
	const send = (submit: (body: string, mentions: string[]) => void) => {
		const text = area?.value.trim() ?? ''
		if (!text) return
		const mentions = [...named()]
			.filter(([name]) => text.includes(`@${name}`))
			.map(([, userId]) => userId)
		submit(text, mentions)
		if (area) area.value = ''
		setNamed(new Map())
		setQuery(null)
	}
	const option = (i: number) => `${listId}-${i}`
	return (
		<form
			class="ocp-composer"
			onSubmit={(event) => {
				event.preventDefault()
				send(props.onSubmit)
			}}
		>
			<Field
				label={props.label}
				hint={
					props.documentId ? 'Type @ to name someone on the team; they are emailed.' : undefined
				}
			>
				<TextArea
					ref={(el) => {
						area = el
					}}
					rows={3}
					role={props.documentId ? 'combobox' : undefined}
					aria-autocomplete={props.documentId ? 'list' : undefined}
					aria-expanded={props.documentId ? (matches().length > 0 ? 'true' : 'false') : undefined}
					aria-controls={props.documentId ? listId : undefined}
					aria-activedescendant={matches().length > 0 ? option(active()) : undefined}
					onInput={readCaret}
					onClick={readCaret}
					onKeyDown={(event) => {
						const list = matches()
						if (list.length === 0) return
						if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
							event.preventDefault()
							setActive(
								(i) => (i + (event.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length,
							)
						} else if (event.key === 'Enter' || event.key === 'Tab') {
							const person = list[active()]
							if (!person) return
							event.preventDefault()
							pick(person)
						} else if (event.key === 'Escape') {
							event.preventDefault()
							setQuery(null)
						}
					}}
				/>
			</Field>
			<Show when={matches().length > 0}>
				<div class="ocp-mentions" id={listId} role="listbox" aria-label="People to name">
					<For each={matches()}>
						{(person, i) => (
							// biome-ignore lint/a11y/useFocusableInteractive: focus stays in the text area (aria-activedescendant); the rule does not read Solid's lowercase tabindex
							<div
								id={option(i())}
								role="option"
								tabindex={-1}
								aria-selected={i() === active() ? 'true' : 'false'}
								onPointerDown={(event) => {
									// Before the text area loses the caret.
									event.preventDefault()
									pick(person)
								}}
							>
								<span>{person.name}</span>
								<Show when={person.team === 'central'}>
									<span class="ocp-muted"> · central team</span>
								</Show>
							</div>
						)}
					</For>
				</div>
			</Show>
			<ToolPanelActions>
				<Button type="submit" variant="solid" disabled={props.busy}>
					{props.action}
				</Button>
				<Show when={props.also}>
					{(also) => (
						<Button
							type="button"
							variant="outline"
							disabled={props.busy}
							onClick={() => send(also().onSubmit)}
						>
							{also().action}
						</Button>
					)}
				</Show>
			</ToolPanelActions>
		</form>
	)
}

/** A section's comments: each first comment with its replies under it, Reply and Resolve
 *  for the team. */
export function CommentThread(props: {
	documentId: string
	sectionId: string
	comments: CommentWire[]
	canWrite: boolean
	onChanged: () => Promise<void>
}) {
	const [replying, setReplying] = createSignal<string | null>(null)
	const [busy, setBusy] = createSignal(false)
	const [error, setError] = createSignal<string | null>(null)
	const run = async (action: () => Promise<unknown>) => {
		setBusy(true)
		setError(null)
		try {
			await action()
			await props.onChanged()
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}
	const firsts = createMemo(() =>
		props.comments.filter((c) => !c.replyTo || !props.comments.some((p) => p.id === c.replyTo)),
	)
	const repliesTo = (id: string) => props.comments.filter((c) => c.replyTo === id)
	return (
		<div class="ocp-thread">
			<Show when={error()}>
				{(text) => (
					<p class="ocp-margin-error" role="alert">
						{text()}
					</p>
				)}
			</Show>
			<Show
				when={firsts().length > 0}
				fallback={<p class="ocp-muted">No comments on this section.</p>}
			>
				<For each={firsts()}>
					{(comment) => (
						<article class="ocp-comment" data-resolved={comment.resolvedAt ? 'true' : undefined}>
							<header>
								<strong>{comment.authorName}</strong>
								<span class="ocp-muted"> {shortDate(comment.createdAt)}</span>
								<Show when={comment.kind === 'suggestion'}>
									<span class="ocp-comment-kind">Suggestion to the core</span>
								</Show>
								<Show when={comment.resolvedAt}>
									<span class="ocp-comment-kind">Resolved</span>
								</Show>
							</header>
							<p>{comment.body}</p>
							<Show when={repliesTo(comment.id).length > 0}>
								<div class="ocp-replies">
									<For each={repliesTo(comment.id)}>
										{(reply) => (
											<article class="ocp-comment ocp-reply">
												<header>
													<strong>{reply.authorName}</strong>
													<span class="ocp-muted"> {shortDate(reply.createdAt)}</span>
												</header>
												<p>{reply.body}</p>
											</article>
										)}
									</For>
								</div>
							</Show>
							<Show when={props.canWrite}>
								<p class="ocp-comment-actions">
									<button
										type="button"
										class="ocp-link-button"
										disabled={busy()}
										onClick={() => setReplying(replying() === comment.id ? null : comment.id)}
									>
										Reply
									</button>
									<button
										type="button"
										class="ocp-link-button"
										disabled={busy()}
										onClick={() =>
											run(() =>
												resolveComment({
													data: { commentId: comment.id, resolved: !comment.resolvedAt },
												}),
											)
										}
									>
										{comment.resolvedAt ? 'Reopen' : 'Resolve'}
									</button>
								</p>
								<Show when={replying() === comment.id}>
									<Composer
										label={`Reply to ${comment.authorName}`}
										action="Reply"
										busy={busy()}
										documentId={props.documentId}
										onSubmit={(body, mentions) =>
											run(async () => {
												await addComment({
													data: {
														documentId: props.documentId,
														sectionId: props.sectionId,
														kind: 'comment',
														body,
														replyTo: comment.id,
														mentions,
													},
												})
												setReplying(null)
											})
										}
									/>
								</Show>
							</Show>
						</article>
					)}
				</For>
			</Show>
			<Show when={props.canWrite}>
				<Composer
					label="Comment"
					action="Add the comment"
					busy={busy()}
					documentId={props.documentId}
					onSubmit={(body, mentions) =>
						run(() =>
							addComment({
								data: {
									documentId: props.documentId,
									sectionId: props.sectionId,
									kind: 'comment',
									body,
									mentions,
								},
							}),
						)
					}
				/>
			</Show>
		</div>
	)
}

/** One suggestion as the central team reads it, with the way to answer it. */
export function SuggestionCard(props: {
	suggestion: SuggestionWire
	onChanged: () => Promise<void>
}) {
	const [busy, setBusy] = createSignal(false)
	const [error, setError] = createSignal<string | null>(null)
	const answer = async (body: string | null, resolve: boolean) => {
		setBusy(true)
		setError(null)
		try {
			await replyToSuggestion({ data: { suggestionId: props.suggestion.id, body, resolve } })
			await props.onChanged()
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}
	const s = () => props.suggestion
	return (
		<article class="ocp-comment ocp-suggestion" data-resolved={s().resolvedAt ? 'true' : undefined}>
			<header>
				<strong>{s().authorName}</strong>
				<span class="ocp-muted">
					{' '}
					· <Link {...workspaceLink(s().pathway.documentId)}>{s().pathway.title}</Link> ·{' '}
					{shortDate(s().createdAt)}
				</span>
				<Show when={s().resolvedAt}>
					<span class="ocp-comment-kind">Resolved</span>
				</Show>
			</header>
			<p>{s().body}</p>
			<Show when={s().pathway.diverged}>
				<p class="ocp-muted">The pathway has since taken its own copy of this section.</p>
			</Show>
			<Show when={s().replies.length > 0}>
				<div class="ocp-replies">
					<For each={s().replies}>
						{(reply) => (
							<article class="ocp-comment ocp-reply">
								<header>
									<strong>{reply.authorName}</strong>
									<span class="ocp-muted"> {shortDate(reply.createdAt)}</span>
								</header>
								<p>{reply.body}</p>
							</article>
						)}
					</For>
				</div>
			</Show>
			<Show when={error()}>
				{(text) => (
					<p class="ocp-margin-error" role="alert">
						{text()}
					</p>
				)}
			</Show>
			<Show
				when={!s().resolvedAt}
				fallback={
					<p class="ocp-comment-actions">
						<button
							type="button"
							class="ocp-link-button"
							disabled={busy()}
							onClick={async () => {
								setBusy(true)
								try {
									await resolveComment({ data: { commentId: s().id, resolved: false } })
									await props.onChanged()
								} finally {
									setBusy(false)
								}
							}}
						>
							Reopen
						</button>
					</p>
				}
			>
				<Composer
					label={`Reply to ${s().authorName}`}
					action="Reply"
					busy={busy()}
					onSubmit={(body) => void answer(body, false)}
					also={{ action: 'Reply and resolve', onSubmit: (body) => void answer(body, true) }}
				/>
				<p class="ocp-comment-actions">
					<button
						type="button"
						class="ocp-link-button"
						disabled={busy()}
						onClick={() => void answer(null, true)}
					>
						Resolve without a reply
					</button>
				</p>
			</Show>
		</article>
	)
}
