/**
 * The Insert menu: the template's blocks in plain words, each with a line on what it is
 * for, filtered as you type. Opened from the toolbar's Insert button or by '/' on an
 * empty line, with the caret in the filter: Enter puts in the first match (or the one
 * the arrows move to), Esc closes and hands the caret back to the text. A footnote asks
 * for its note and an image for its file and description before going in; a
 * cross-reference hands over to the Link tool.
 */

import { Button, Field, Notice, TextInput } from '@aicolab/ui-solid'
import {
	createMemo,
	createSignal,
	createUniqueId,
	For,
	Match,
	Show,
	Switch,
	untrack,
} from 'solid-js'
import type { JsonNode } from '#/content/schema.ts'
import type { EditorControl } from '#/lifecycle/workspace.ts'
import { IMAGE_ACCEPT, imageProblem, imageUploadForm, uploadImage } from '#/server/files.ts'
import * as build from './insert.ts'

type Action =
	| { kind: 'nodes'; nodes: () => JsonNode[] }
	| { kind: 'footnote' }
	| { kind: 'image' }
	| { kind: 'crossReference' }

interface InsertItem {
	id: string
	label: string
	description: string
	/** Other words an author might type for it. */
	keywords: string
	action: Action
}

const ITEMS: readonly InsertItem[] = [
	{
		id: 'box',
		label: 'Box with a title',
		description: 'A bordered box headed by a title band.',
		keywords: 'panel frame banner heading callout',
		action: { kind: 'nodes', nodes: build.boxWithTitle },
	},
	{
		id: 'timeframe',
		label: 'Timeframe',
		description: 'A care point and how soon it should happen.',
		keywords: 'care point time days weeks',
		action: { kind: 'nodes', nodes: build.timeframe },
	},
	{
		id: 'or',
		label: 'Or alternative',
		description: 'Two alternative wordings, of which a pathway keeps one.',
		keywords: 'variant option either choice',
		action: { kind: 'nodes', nodes: build.orAlternative },
	},
	{
		id: 'resource',
		label: 'Find out more resource',
		description: 'A titled link to further reading, with a line about it.',
		keywords: 'see also link website reading',
		action: { kind: 'nodes', nodes: build.findOutMoreResource },
	},
	{
		id: 'check',
		label: 'Check item',
		description: 'An action for this step, set with a tick box.',
		keywords: 'tick checklist action todo point of care',
		action: { kind: 'nodes', nodes: build.checkItem },
	},
	{
		id: 'columns',
		label: 'Two columns',
		description: 'Two blocks of text set side by side.',
		keywords: 'layout side grid',
		action: { kind: 'nodes', nodes: build.twoColumns },
	},
	{
		id: 'table',
		label: 'Table',
		description: 'Three columns under a header row.',
		keywords: 'grid rows cells',
		action: { kind: 'nodes', nodes: () => build.table() },
	},
	{
		id: 'quote',
		label: 'Quote',
		description: 'A passage quoted from another source.',
		keywords: 'blockquote citation words',
		action: { kind: 'nodes', nodes: build.quote },
	},
	{
		id: 'rule',
		label: 'Rule',
		description: 'A thin line across the column, to set off what follows.',
		keywords: 'divider line separator horizontal',
		action: { kind: 'nodes', nodes: build.rule },
	},
	{
		id: 'footnote',
		label: 'Footnote',
		description: 'A note printed at the foot of the page, marked in the text.',
		keywords: 'note aside',
		action: { kind: 'footnote' },
	},
	{
		id: 'image',
		label: 'Image',
		description: 'A figure from your computer, with a description for readers who cannot see it.',
		keywords: 'picture figure photo diagram upload',
		action: { kind: 'image' },
	},
	{
		id: 'crossReference',
		label: 'Cross-reference',
		description: 'A link to another section of this document.',
		keywords: 'section link see refer',
		action: { kind: 'crossReference' },
	},
]

/** The items whose words hold every word of the query; a title that starts with the
 *  query comes first. */
function filtered(query: string): InsertItem[] {
	const q = query.trim().toLowerCase()
	if (q === '') return [...ITEMS]
	const words = q.split(/\s+/)
	const hits = ITEMS.filter((item) => {
		const text = `${item.label} ${item.description} ${item.keywords}`.toLowerCase()
		return words.every((w) => text.includes(w))
	})
	return [
		...hits.filter((item) => item.label.toLowerCase().startsWith(q)),
		...hits.filter((item) => !item.label.toLowerCase().startsWith(q)),
	]
}

/** Focus a field once it is in the document (a ref runs before insertion). */
const focusSoon = (el: HTMLElement) => requestAnimationFrame(() => el.focus())

export function InsertMenu(props: {
	control: EditorControl | null
	documentId: string
	/** Close the menu (before the caret goes back to the text). */
	close: () => void
	/** Open the Link tool on its "This document" tab. */
	onCrossReference: () => void
}) {
	const listId = `ocp-insert-${createUniqueId()}`
	const [view, setView] = createSignal<'list' | 'footnote' | 'image'>('list')
	const [query, setQuery] = createSignal('')
	const [cursor, setCursor] = createSignal(0)
	const matches = createMemo(() => filtered(query()))
	const current = () => matches()[Math.min(cursor(), matches().length - 1)]

	const put = (nodes: JsonNode[]) => {
		const control = props.control
		props.close()
		control?.insert(nodes)
	}

	const choose = (item: InsertItem | undefined) => {
		if (!item || !props.control) return
		const action = item.action
		if (action.kind === 'nodes') put(action.nodes())
		else if (action.kind === 'crossReference') props.onCrossReference()
		else setView(action.kind)
	}

	const onFilterKey = (event: KeyboardEvent) => {
		const count = matches().length
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault()
			if (count === 0) return
			const step = event.key === 'ArrowDown' ? 1 : -1
			setCursor((c) => (Math.min(c, count - 1) + step + count) % count)
		} else if (event.key === 'Enter') {
			event.preventDefault()
			choose(current())
		}
	}

	return (
		<div class="ocp-insert">
			<Switch>
				<Match when={view() === 'list'}>
					<input
						class="ocp-tool-filter"
						type="text"
						role="combobox"
						aria-label="Find something to insert"
						aria-expanded="true"
						aria-controls={listId}
						aria-activedescendant={current() ? `${listId}-${current()?.id}` : undefined}
						placeholder="Type to find a block…"
						autocomplete="off"
						spellcheck={false}
						value={query()}
						ref={focusSoon}
						onInput={(event) => {
							setQuery(event.currentTarget.value)
							setCursor(0)
						}}
						onKeyDown={onFilterKey}
					/>
					<Show
						when={matches().length > 0}
						fallback={
							<p class="ocp-tool-empty">Nothing by that name. Try "box", "table" or "image".</p>
						}
					>
						<div class="ocp-insert-list" id={listId} role="listbox" aria-label="Blocks to insert">
							<For each={matches()}>
								{(item, i) => (
									// biome-ignore lint/a11y/useFocusableInteractive: focus stays in the filter (aria-activedescendant); the rule does not read Solid's lowercase tabindex
									<div
										id={`${listId}-${item.id}`}
										role="option"
										tabindex={-1}
										class="ocp-insert-option"
										aria-selected={current()?.id === item.id ? 'true' : 'false'}
										aria-disabled={props.control ? undefined : 'true'}
										onMouseDown={(event) => event.preventDefault()}
										onPointerMove={() => setCursor(i())}
										onClick={() => choose(item)}
										onKeyDown={(event) => {
											if (event.key === 'Enter') choose(item)
										}}
									>
										<span class="ocp-insert-label">{item.label}</span>
										<span class="ocp-insert-description">{item.description}</span>
									</div>
								)}
							</For>
						</div>
					</Show>
				</Match>
				<Match when={view() === 'footnote'}>
					<FootnoteForm
						onInsert={(text) => put(build.footnote(text))}
						onBack={() => setView('list')}
					/>
				</Match>
				<Match when={view() === 'image'}>
					<ImageForm
						documentId={props.documentId}
						onInsert={(src, alt) => put(build.image(src, alt))}
						onBack={() => setView('list')}
					/>
				</Match>
			</Switch>
		</div>
	)
}

function FootnoteForm(props: { onInsert: (text: string) => void; onBack: () => void }) {
	const [text, setText] = createSignal('')
	const submit = (event: SubmitEvent) => {
		event.preventDefault()
		if (text().trim()) props.onInsert(text())
	}
	return (
		<form class="ocp-tool-form" onSubmit={submit}>
			<p class="ocp-tool-heading">Footnote</p>
			<Field
				label="The note"
				hint="Printed at the foot of the page; a small mark goes where the caret is."
			>
				<TextInput
					value={text()}
					ref={focusSoon}
					maxlength={1000}
					onInput={(event) => setText(event.currentTarget.value)}
				/>
			</Field>
			<div class="ocp-tool-actions">
				<Button type="button" variant="ghost" colorBase="neutral" onClick={() => props.onBack()}>
					Back
				</Button>
				<Button type="submit" disabled={text().trim() === ''}>
					Insert footnote
				</Button>
			</div>
		</form>
	)
}

type Upload =
	| { state: 'none' }
	| { state: 'uploading'; name: string }
	| { state: 'done'; name: string; src: string }
	| { state: 'failed'; message: string }

function ImageForm(props: {
	documentId: string
	onInsert: (src: string, alt: string) => void
	onBack: () => void
}) {
	const [upload, setUpload] = createSignal<Upload>({ state: 'none' })
	const [alt, setAlt] = createSignal('')
	const [tried, setTried] = createSignal(false)
	const documentId = untrack(() => props.documentId)

	const choose = (file: File | undefined) => {
		if (!file) return
		const problem = imageProblem(file)
		if (problem) {
			setUpload({ state: 'failed', message: problem })
			return
		}
		setUpload({ state: 'uploading', name: file.name })
		// Over plain HTTP, not the app's socket: a file of megabytes is a request body, not a
		// tunnelled message. The kit checks CSRF and reads the session cookie on this path.
		uploadImage({
			data: imageUploadForm(documentId, file),
			fetch: (input, init) => fetch(input, init),
		})
			.then(({ src }) => setUpload({ state: 'done', name: file.name, src }))
			.catch((error: unknown) =>
				setUpload({
					state: 'failed',
					message: error instanceof Error ? error.message : 'The upload did not finish. Try again.',
				}),
			)
	}

	const uploaded = createMemo(() => {
		const u = upload()
		return u.state === 'done' ? u : null
	})
	const failure = createMemo(() => {
		const u = upload()
		return u.state === 'failed' ? u.message : null
	})

	const submit = (event: SubmitEvent) => {
		event.preventDefault()
		setTried(true)
		const done = uploaded()
		if (done && alt().trim()) props.onInsert(done.src, alt())
	}

	return (
		<form class="ocp-tool-form" onSubmit={submit}>
			<p class="ocp-tool-heading">Image</p>
			<Field label="The image" hint="PNG, JPEG, WebP, GIF or SVG, up to 8 MB.">
				<input
					class="ocp-tool-file"
					type="file"
					accept={IMAGE_ACCEPT}
					ref={focusSoon}
					onChange={(event) => choose(event.currentTarget.files?.[0])}
				/>
			</Field>
			<Show when={upload().state === 'uploading'}>
				<p class="ocp-tool-status" role="status">
					Uploading…
				</p>
			</Show>
			<Show when={uploaded()}>
				{(done) => (
					<figure class="ocp-tool-preview">
						<img src={done().src} alt="" />
						<figcaption>{done().name}</figcaption>
					</figure>
				)}
			</Show>
			<Show when={failure()}>
				{(message) => (
					<Notice colorBase="error" variant="soft" role="alert">
						{message()}
					</Notice>
				)}
			</Show>
			<Field
				label="Describe it"
				hint="One short sentence saying what the image shows, read aloud to people who cannot see it."
			>
				<TextInput
					value={alt()}
					maxlength={300}
					required
					aria-invalid={tried() && alt().trim() === '' ? 'true' : undefined}
					onInput={(event) => setAlt(event.currentTarget.value)}
				/>
			</Field>
			<Show when={tried() && alt().trim() === ''}>
				<p class="ocp-tool-error">Describe the image before inserting it.</p>
			</Show>
			<div class="ocp-tool-actions">
				<Button type="button" variant="ghost" colorBase="neutral" onClick={() => props.onBack()}>
					Back
				</Button>
				<Button type="submit" disabled={!uploaded()}>
					Insert image
				</Button>
			</div>
		</form>
	)
}
