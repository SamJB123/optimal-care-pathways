/**
 * Asking for review (decision 111, and the template's own rule: report what you removed
 * and added). A sheet, not a browser prompt: it lists what the review will cover — the
 * sections changed since the published edition, the sections hidden and the subheadings
 * added — takes an optional note for the reviewers, and sends. The result is said in
 * place.
 */

import { AdaptiveModalSheet, Button, Field, TextArea } from '@aicolab/ui-solid'
import { createSignal, For, Show, useContext } from 'solid-js'
import { requestReview } from '#/server/lifecycle-fns.ts'
import { DocumentContext, sectionLabel } from './workspace.ts'
import './request-review.css'

export function RequestReviewSheet(props: { open: boolean; onDismiss: () => void }) {
	const workspace = useContext(DocumentContext)
	const [note, setNote] = createSignal('')
	const [busy, setBusy] = createSignal(false)
	const [result, setResult] = createSignal<string | null>(null)
	const [error, setError] = createSignal<string | null>(null)
	const changed = () =>
		workspace.state().changes.map((c) => workspace.sections().find((s) => s.id === c.sectionId)).filter((s) => s !== undefined)
	const structure = () => workspace.state().structure

	const send = async () => {
		setBusy(true)
		setError(null)
		try {
			const r = await requestReview({ data: { documentId: workspace.documentId, note: note().trim() || null } })
			setResult(
				`Review asked for: ${r.sections} changed section${r.sections === 1 ? '' : 's'}${r.hidden ? `, ${r.hidden} hidden` : ''}${r.added ? `, ${r.added} added` : ''}. The reviewers have been emailed.`,
			)
			setNote('')
			await workspace.refreshState()
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}

	return (
		<AdaptiveModalSheet
			open={props.open}
			label="Ask for review"
			title="Ask for review"
			onDismiss={() => {
				setResult(null)
				props.onDismiss()
			}}
		>
			<div class="ocp-request">
				<Show
					when={!result()}
					fallback={
						<>
							<p class="ocp-request-done" role="status">
								{result()}
							</p>
							<Button variant="solid" onClick={props.onDismiss}>
								Close
							</Button>
						</>
					}
				>
					<p>The reviewers decide each changed section in turn. The review covers:</p>
					<section>
						<h3>
							{workspace.state().published ? 'Changed since the published edition' : 'Written for the first edition'} ({changed().length})
						</h3>
						<Show when={changed().length > 0} fallback={<p class="ocp-muted">No section's text has changed.</p>}>
							<ul>
								<For each={changed()}>{(s) => <li>{sectionLabel(s)}</li>}</For>
							</ul>
						</Show>
					</section>
					<Show when={structure().hidden.length > 0}>
						<section>
							<h3>Hidden from this document ({structure().hidden.length})</h3>
							<ul>
								<For each={structure().hidden}>{(s) => <li>{s.title ?? s.address}</li>}</For>
							</ul>
						</section>
					</Show>
					<Show when={structure().added.length > 0}>
						<section>
							<h3>Subheadings added ({structure().added.length})</h3>
							<ul>
								<For each={structure().added}>{(s) => <li>{s.title ?? s.address}</li>}</For>
							</ul>
						</section>
					</Show>
					<Field label="A note for the reviewers (optional)">
						<TextArea rows={3} value={note()} onInput={(e) => setNote(e.currentTarget.value)} />
					</Field>
					<Show when={error()}>
						{(text) => (
							<p class="ocp-request-error" role="alert">
								{text()}
							</p>
						)}
					</Show>
					<div class="ocp-request-actions">
						<Button variant="text" onClick={props.onDismiss}>
							Cancel
						</Button>
						<Button variant="solid" disabled={busy()} onClick={() => void send()}>
							{busy() ? 'Sending…' : 'Ask for review'}
						</Button>
					</div>
				</Show>
			</div>
		</AdaptiveModalSheet>
	)
}
