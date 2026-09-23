/**
 * The document's references (decision: references in full): every reference its text
 * cites, numbered in the order the text first cites them, with where each is cited (a
 * jump to each place), then the document's own references nothing cites yet. A drafter
 * adds a reference here or from the editor's Cite tool, and edits one in place — unless a
 * published edition cites it, in which case the edit is written as a new reference and
 * only the draft moves to it, so the edition keeps exactly what it printed. A reference
 * the core template owns is read-only here: a change to it is suggested on the shared
 * section that cites it.
 */

import { Button, EmptyState, Field, TextArea, TextInput } from '@aicolab/ui-solid'
import { createFileRoute, useRouter } from '@tanstack/solid-router'
import { createSignal, For, Show, useContext } from 'solid-js'
import { numberLabel } from '#/lib/labels.ts'
import { sectionAnchor } from '#/lib/links.ts'
import { atLeast, DocumentContext } from '#/lifecycle/workspace.ts'
import type { ReferenceEntry } from '#/server/references.ts'
import { addReference, deleteReference, editReference, listReferences } from '#/server/references-fns.ts'
import './references.css'

export const Route = createFileRoute('/d/$documentId/references')({
	loader: async ({ params }) => listReferences({ data: { documentId: params.documentId } }),
	component: ReferencesPage,
})

function ReferencesPage() {
	const data = Route.useLoaderData()
	const router = useRouter()
	const workspace = useContext(DocumentContext)
	const canEdit = () => atLeast(workspace.role, 'member')
	const [adding, setAdding] = createSignal(false)
	const cited = () => data().references.filter((r) => !r.unused)
	const unused = () => data().references.filter((r) => r.unused)

	/** The part a section opens in: its top-level section. */
	const partOf = (sectionId: string) => {
		let at = workspace.sections().find((s) => s.id === sectionId)
		while (at?.parentId) {
			const parentId = at.parentId
			at = workspace.sections().find((s) => s.id === parentId)
		}
		return at?.address ?? null
	}

	return (
		<div class="ocp-part ocp-references">
			<header class="ocp-references-head">
				<h1>References</h1>
				<p class="ocp-muted">
					{cited().length} cited in the text, numbered as the text first cites them
					{unused().length > 0 ? `; ${unused().length} not cited yet` : ''}.
				</p>
				<Show when={canEdit()}>
					<Show when={adding()} fallback={<Button variant="outline" onClick={() => setAdding(true)}>Add a reference</Button>}>
						<ReferenceForm
							submit="Add the reference"
							onCancel={() => setAdding(false)}
							onSave={async (citation, url) => {
								await addReference({ data: { documentId: workspace.documentId, citation, url } })
								setAdding(false)
								await router.invalidate()
							}}
						/>
					</Show>
				</Show>
			</header>
			<Show when={data().references.length > 0} fallback={<EmptyState title="Nothing is cited yet" hint="Cite a reference from the editor's Cite tool, or add one here." pad="1.5rem" />}>
				<ol class="ocp-reference-list">
					<For each={cited()}>{(r) => <ReferenceRowView entry={r} canEdit={canEdit()} partOf={partOf} />}</For>
				</ol>
				<Show when={unused().length > 0}>
					<h2 class="ocp-references-sub">Not cited yet</h2>
					<ul class="ocp-reference-list" data-unused="">
						<For each={unused()}>{(r) => <ReferenceRowView entry={r} canEdit={canEdit()} partOf={partOf} />}</For>
					</ul>
				</Show>
			</Show>
		</div>
	)
}

function ReferenceRowView(props: { entry: ReferenceEntry; canEdit: boolean; partOf: (sectionId: string) => string | null }) {
	const workspace = useContext(DocumentContext)
	const router = useRouter()
	const [editing, setEditing] = createSignal(false)
	const [asking, setAsking] = createSignal(false)
	const [said, setSaid] = createSignal<string | null>(null)
	const [error, setError] = createSignal<string | null>(null)
	return (
		<li class="ocp-reference" id={`ref-${props.entry.id}`} data-own={props.entry.own ? '' : undefined} data-missing={props.entry.missing ? '' : undefined}>
			<span class="ocp-reference-number">{props.entry.number ?? '–'}</span>
			<div class="ocp-reference-body">
				<Show
					when={editing()}
					fallback={
						<>
							<p class="ocp-reference-text">
								{props.entry.citation}
								<Show when={props.entry.url}>
									{(url) => (
										<>
											{' '}
											<a href={url()} target="_blank" rel="noreferrer">
												Open the source
											</a>
										</>
									)}
								</Show>
							</p>
							<p class="ocp-reference-meta">
								<Show when={props.entry.citedIn.length > 0} fallback={<span>Not cited in the text</span>}>
									<span>Cited in </span>
									<For each={props.entry.citedIn}>
										{(place, i) => (
											<>
												{i() > 0 ? ', ' : ''}
												<a href={`/d/${workspace.documentId}/${encodeURIComponent(props.partOf(place.sectionId) ?? place.address)}#${sectionAnchor(place.address)}`}>
													{place.printedNumber ? numberLabel(place.printedNumber) : (place.title ?? place.address)}
												</a>
											</>
										)}
									</For>
								</Show>
								<Show when={!props.entry.own}>
									<span> · from the core template</span>
								</Show>
								<Show when={props.entry.inPublished}>
									<span> · in the published edition</span>
								</Show>
							</p>
							<Show when={props.canEdit && props.entry.own && !props.entry.missing && !props.entry.supersededBy}>
								<div class="ocp-reference-actions">
									<button type="button" class="ocp-link-button" onClick={() => setEditing(true)}>
										Edit
									</button>
									<Show when={props.entry.unused}>
										<Show
											when={asking()}
											fallback={
												<button type="button" class="ocp-link-button" onClick={() => setAsking(true)}>
													Delete
												</button>
											}
										>
											<span>Delete this reference?</span>
											<button
												type="button"
												class="ocp-link-button"
												onClick={async () => {
													try {
														await deleteReference({ data: { documentId: workspace.documentId, referenceId: props.entry.id } })
														await router.invalidate()
													} catch (e) {
														setError(e instanceof Error ? e.message : String(e))
														setAsking(false)
													}
												}}
											>
												Delete it
											</button>
											<button type="button" class="ocp-link-button" onClick={() => setAsking(false)}>
												Keep it
											</button>
										</Show>
									</Show>
								</div>
							</Show>
						</>
					}
				>
					<ReferenceForm
						submit="Save"
						initial={{ citation: props.entry.citation, url: props.entry.url ?? '' }}
						note={props.entry.inPublished ? 'The published edition cites this reference as it stands: saving writes a new reference for the draft, and the edition keeps its own.' : null}
						onCancel={() => setEditing(false)}
						onSave={async (citation, url) => {
							const r = await editReference({ data: { documentId: workspace.documentId, referenceId: props.entry.id, citation, url } })
							setEditing(false)
							setSaid(r.copied ? 'Saved as a new reference for the draft; the published edition keeps the old wording.' : 'Saved.')
							await router.invalidate()
						}}
					/>
				</Show>
				<Show when={said()}>{(text) => <p class="ocp-reference-said" role="status">{text()}</p>}</Show>
				<Show when={error()}>{(text) => <p class="ocp-reference-error" role="alert">{text()}</p>}</Show>
			</div>
		</li>
	)
}

function ReferenceForm(props: {
	submit: string
	initial?: { citation: string; url: string }
	note?: string | null
	onSave: (citation: string, url: string | null) => Promise<void>
	onCancel: () => void
}) {
	const [citation, setCitation] = createSignal(props.initial?.citation ?? '')
	const [url, setUrl] = createSignal(props.initial?.url ?? '')
	const [busy, setBusy] = createSignal(false)
	const [error, setError] = createSignal<string | null>(null)
	return (
		<form
			class="ocp-reference-form"
			onSubmit={async (e) => {
				e.preventDefault()
				setBusy(true)
				setError(null)
				try {
					await props.onSave(citation().trim(), url().trim() || null)
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err))
				} finally {
					setBusy(false)
				}
			}}
		>
			<Field label="The reference, as it should print">
				<TextArea rows={3} value={citation()} onInput={(e) => setCitation(e.currentTarget.value)} required />
			</Field>
			<Field label="Link to the source (optional)">
				<TextInput type="url" placeholder="https://" value={url()} onInput={(e) => setUrl(e.currentTarget.value)} />
			</Field>
			<Show when={props.note}>{(note) => <p class="ocp-muted">{note()}</p>}</Show>
			<Show when={error()}>{(text) => <p class="ocp-reference-error" role="alert">{text()}</p>}</Show>
			<div class="ocp-reference-actions">
				<Button type="submit" variant="solid" disabled={busy() || !citation().trim()}>
					{props.submit}
				</Button>
				<Button type="button" variant="text" onClick={props.onCancel}>
					Cancel
				</Button>
			</div>
		</form>
	)
}
