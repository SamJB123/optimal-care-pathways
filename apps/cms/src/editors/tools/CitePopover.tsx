/**
 * The Cite tool: find a reference this document can cite and put its marker at the
 * caret. Empty, it lists the references already cited, in the order the document
 * numbers them; typing searches every reference the document can cite (its own, and the
 * core template's it reads through shared sections). "New reference" writes one of the
 * document's own and cites it at once. The marker's number is derived at render, so it
 * is never typed here.
 */

import { Button, Field, Notice, TextArea, TextInput } from '@aicolab/ui-solid'
import { createMemo, createSignal, createUniqueId, For, onSettled, Show, untrack } from 'solid-js'
import type { EditorControl } from '#/lifecycle/workspace.ts'
import type { ReferenceEntry } from '#/server/references.ts'
import { addReference, listReferences, searchReferences } from '#/server/references-fns.ts'
import { citation } from './insert.ts'

const FIRST = 30
const DEBOUNCE_MS = 200

const messageOf = (error: unknown, fallback: string): string =>
	error instanceof Error ? error.message : fallback

/** A web address as a reference may carry it: blank, or http(s). */
const urlProblem = (url: string): string | null => {
	const text = url.trim()
	if (text === '') return null
	const parsed = URL.canParse(text) ? new URL(text) : null
	return parsed && (parsed.protocol === 'http:' || parsed.protocol === 'https:')
		? null
		: 'A link must be a web address starting with http:// or https://.'
}

export function CitePopover(props: {
	control: EditorControl | null
	documentId: string
	close: () => void
}) {
	const documentId = untrack(() => props.documentId)
	const listId = `ocp-cite-${createUniqueId()}`
	const [query, setQuery] = createSignal('')
	const [rows, setRows] = createSignal<readonly ReferenceEntry[] | null>(null)
	const [error, setError] = createSignal<string | null>(null)
	const [cursor, setCursor] = createSignal(0)
	const [adding, setAdding] = createSignal(false)
	const current = () => {
		const list = rows() ?? []
		return list[Math.min(cursor(), list.length - 1)]
	}
	let asked = 0
	let timer: ReturnType<typeof setTimeout> | undefined

	const load = (text: string) => {
		const ask = ++asked
		const q = text.trim()
		const found =
			q === ''
				? listReferences({ data: { documentId } }).then((list) =>
						list.references
							.filter((r) => !r.missing && !(r.unused && r.supersededBy !== null))
							.slice(0, FIRST),
					)
				: searchReferences({ data: { documentId, query: q } })
		found
			.then((list) => {
				if (ask !== asked) return
				setRows(list)
				setError(null)
				setCursor(0)
			})
			.catch((e: unknown) => {
				if (ask === asked) setError(messageOf(e, 'The references could not be read. Try again.'))
			})
	}

	onSettled(() => {
		load('')
		return () => clearTimeout(timer)
	})

	const onQuery = (text: string) => {
		setQuery(text)
		clearTimeout(timer)
		timer = setTimeout(() => load(text), DEBOUNCE_MS)
	}

	const cite = (referenceId: string) => {
		const control = props.control
		props.close()
		control?.insert(citation(referenceId))
	}

	const onKey = (event: KeyboardEvent) => {
		const count = rows()?.length ?? 0
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault()
			if (count === 0) return
			const step = event.key === 'ArrowDown' ? 1 : -1
			setCursor((c) => (Math.min(c, count - 1) + step + count) % count)
		} else if (event.key === 'Enter') {
			event.preventDefault()
			const row = current()
			if (row && props.control) cite(row.id)
		}
	}

	return (
		<div class="ocp-cite">
			<Show
				when={!adding()}
				fallback={
					<NewReference documentId={documentId} onCreated={cite} onBack={() => setAdding(false)} />
				}
			>
				<input
					class="ocp-tool-filter"
					type="search"
					role="combobox"
					aria-label="Find a reference"
					aria-expanded="true"
					aria-controls={listId}
					aria-activedescendant={current() ? `${listId}-${current()?.id}` : undefined}
					placeholder="Author, title, journal, year…"
					autocomplete="off"
					value={query()}
					ref={(el) => requestAnimationFrame(() => el.focus())}
					onInput={(event) => onQuery(event.currentTarget.value)}
					onKeyDown={onKey}
				/>
				<p class="ocp-tool-caption">
					{query().trim() === ''
						? 'Cited in this document, in order'
						: 'References this document can cite'}
				</p>
				<Show when={error()}>
					{(message) => (
						<Notice colorBase="error" variant="soft" role="alert">
							{message()}
						</Notice>
					)}
				</Show>
				<Show when={rows()} fallback={<p class="ocp-tool-status">Reading the references…</p>}>
					{(list) => (
						<Show
							when={list().length > 0}
							fallback={
								<p class="ocp-tool-empty">
									{query().trim() === ''
										? 'Nothing is cited yet. Search for a reference, or add a new one.'
										: 'No reference holds all of those words.'}
								</p>
							}
						>
							<div class="ocp-cite-list" id={listId} role="listbox" aria-label="References">
								<For each={list()}>
									{(row, i) => (
										// biome-ignore lint/a11y/useFocusableInteractive: focus stays in the search field (aria-activedescendant); the rule does not read Solid's lowercase tabindex
										<div
											id={`${listId}-${row.id}`}
											role="option"
											tabindex={-1}
											class="ocp-cite-option"
											aria-selected={current()?.id === row.id ? 'true' : 'false'}
											aria-disabled={props.control ? undefined : 'true'}
											onMouseDown={(event) => event.preventDefault()}
											onPointerMove={() => setCursor(i())}
											onClick={() => props.control && cite(row.id)}
											onKeyDown={(event) => {
												if (event.key === 'Enter' && props.control) cite(row.id)
											}}
										>
											<span
												class="ocp-cite-number"
												data-uncited={row.number === null ? '' : undefined}
											>
												{row.number === null ? 'not yet cited' : row.number}
											</span>
											<span class="ocp-cite-text">{row.citation}</span>
											<Show when={!row.own}>
												<span class="ocp-cite-source">from the core template</span>
											</Show>
										</div>
									)}
								</For>
							</div>
						</Show>
					)}
				</Show>
				<div class="ocp-tool-actions">
					<Button
						type="button"
						variant="outline"
						colorBase="neutral"
						onClick={() => setAdding(true)}
					>
						New reference
					</Button>
				</div>
			</Show>
		</div>
	)
}

function NewReference(props: {
	documentId: string
	onCreated: (referenceId: string) => void
	onBack: () => void
}) {
	const [text, setText] = createSignal('')
	const [url, setUrl] = createSignal('')
	const [busy, setBusy] = createSignal(false)
	const [tried, setTried] = createSignal(false)
	const [error, setError] = createSignal<string | null>(null)
	const badUrl = createMemo(() => (tried() ? urlProblem(url()) : null))

	const submit = (event: SubmitEvent) => {
		event.preventDefault()
		setTried(true)
		if (text().trim() === '' || urlProblem(url())) return
		setBusy(true)
		setError(null)
		addReference({
			data: { documentId: props.documentId, citation: text().trim(), url: url().trim() || null },
		})
			.then((row) => props.onCreated(row.id))
			.catch((e: unknown) => {
				setError(messageOf(e, 'The reference was not added. Try again.'))
				setBusy(false)
			})
	}

	return (
		<form class="ocp-tool-form" onSubmit={submit}>
			<p class="ocp-tool-heading">New reference</p>
			<Field
				label="Citation"
				hint="As it should appear in the reference list: authors, title, source, year."
			>
				<TextArea
					rows={4}
					value={text()}
					maxlength={4000}
					required
					aria-invalid={tried() && text().trim() === '' ? 'true' : undefined}
					ref={(el) => requestAnimationFrame(() => el.focus())}
					onInput={(event) => setText(event.currentTarget.value)}
				/>
			</Field>
			<Show when={tried() && text().trim() === ''}>
				<p class="ocp-tool-error">Write the citation first.</p>
			</Show>
			<Field
				label="Link (optional)"
				hint="Where a reader can find it: a web address starting with https://."
			>
				<TextInput
					type="url"
					value={url()}
					maxlength={2000}
					placeholder="https://"
					aria-invalid={badUrl() ? 'true' : undefined}
					onInput={(event) => setUrl(event.currentTarget.value)}
				/>
			</Field>
			<Show when={badUrl()}>{(message) => <p class="ocp-tool-error">{message()}</p>}</Show>
			<Show when={error()}>
				{(message) => (
					<Notice colorBase="error" variant="soft" role="alert">
						{message()}
					</Notice>
				)}
			</Show>
			<div class="ocp-tool-actions">
				<Button type="button" variant="ghost" colorBase="neutral" onClick={() => props.onBack()}>
					Back
				</Button>
				<Button type="submit" disabled={busy()}>
					{busy() ? 'Adding…' : 'Add and cite'}
				</Button>
			</div>
		</form>
	)
}
