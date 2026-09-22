/**
 * The publish wizard (decision 109): four steps on a rail — readiness, review status,
 * label and release notes, confirm. The gate (server, decision 99) is read when the
 * sheet opens and enforced again at publish; the wizard only shows it. Central members
 * reach this.
 *
 * The readiness read is an async memo under `<Loading>` (Solid 2's async model: a
 * computation that returns a promise, read where it is shown).
 */

import { Button, Field, Steps, TextArea, TextInput } from '@aicolab/ui-solid'
import { useNavigate } from '@tanstack/solid-router'
import { createMemo, createSignal, For, Loading, Show, useContext } from 'solid-js'
import { DocumentContext } from '#/lifecycle/workspace.ts'
import { publishDocument, publishReadiness } from '#/server/lifecycle-fns.ts'
import type { GateItem } from '#/server/lifecycle.ts'

const LEVEL_GLYPH: Record<GateItem['level'], string> = { block: '✕', warn: '!', ok: '✓' }

/** The first few section addresses an item points at; the rest as a count. */
const someSections = (sections: string[] | undefined): string | null => {
	if (!sections || sections.length === 0) return null
	const shown = sections.slice(0, 8)
	const more = sections.length - shown.length
	return `${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}`
}

export function PublishWizard(props: { onDone: () => void }) {
	const workspace = useContext(DocumentContext)
	const navigate = useNavigate()
	const readiness = createMemo(() =>
		publishReadiness({ data: { documentId: workspace.documentId } }),
	)
	const [step, setStep] = createSignal(0)
	const [label, setLabel] = createSignal('')
	const [notes, setNotes] = createSignal('')
	const [busy, setBusy] = createSignal(false)
	const [error, setError] = createSignal<string | null>(null)
	const review = () => workspace.state().review

	const publish = async () => {
		setBusy(true)
		setError(null)
		try {
			const result = await publishDocument({
				data: {
					documentId: workspace.documentId,
					label: label().trim() || null,
					releaseNotes: notes().trim() || null,
				},
			})
			await workspace.refreshState()
			props.onDone()
			void navigate({ to: '/d/$documentId', params: { documentId: workspace.documentId } })
			window.alert(`Version ${result.versionNo} is published.`)
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}

	const gate = () => (
		<ul class="ocp-gate">
			<For each={readiness().items}>
				{(item) => (
					<li data-level={item.level}>
						<span class="ocp-gate-glyph" aria-hidden="true">
							{LEVEL_GLYPH[item.level]}
						</span>
						<span>
							{item.message}
							<Show when={someSections(item.sections)}>
								{(list) => <span class="ocp-muted"> ({list()})</span>}
							</Show>
						</span>
					</li>
				)}
			</For>
		</ul>
	)

	const steps = () => [
		{
			title: 'Readiness',
			body: (
				<Show
					when={step() === 0}
					fallback={<span class="ocp-muted">{readiness().blocked ? 'Blocked' : 'Ready'}</span>}
				>
					{gate()}
				</Show>
			),
		},
		{
			title: 'Review',
			body: (
				<Show
					when={step() === 1}
					fallback={
						<span class="ocp-muted">
							{review()?.decision === 'approved' ? 'Approved in full' : 'Not approved'}
						</span>
					}
				>
					<Show when={review()} fallback={<p>No review has been requested for this draft.</p>}>
						{(r) => (
							<p>
								{r().decision === 'approved'
									? `Approved in full: ${r().approved} of ${r().total} sections.`
									: r().decision === 'changes_requested'
										? `Changes requested on ${r().changesRequested} of ${r().total} sections.`
										: `Open: ${r().decided} of ${r().total} sections decided.`}
							</p>
						)}
					</Show>
				</Show>
			),
		},
		{
			title: 'Label and release notes',
			body: (
				<Show
					when={step() === 2}
					fallback={<span class="ocp-muted">{label().trim() || 'No label'}</span>}
				>
					<div class="ocp-wizard-fields">
						<Field
							label="Edition label (optional)"
							hint="Shown with the version, e.g. 'Second edition'"
						>
							<TextInput value={label()} onInput={(e) => setLabel(e.currentTarget.value)} />
						</Field>
						<Field
							label="Release notes"
							hint="What changed in this version, written for readers of the published document"
						>
							<TextArea rows={5} value={notes()} onInput={(e) => setNotes(e.currentTarget.value)} />
						</Field>
					</div>
				</Show>
			),
		},
		{
			title: 'Confirm',
			body: (
				<Show
					when={step() === 3}
					fallback={
						<span class="ocp-muted">Publish version {workspace.state().draft.versionNo}</span>
					}
				>
					<p>
						Publish <strong>version {workspace.state().draft.versionNo}</strong> of{' '}
						<strong>{workspace.document.title}</strong>
						{label().trim() ? ` as “${label().trim()}”` : ''}. The current published version
						{workspace.state().published
							? ` (v${workspace.state().published?.versionNo}) is archived`
							: ' — there is none yet'}
						, and a new draft opens from this one.
					</p>
					<Show when={error()}>
						{(text) => (
							<p class="ocp-inspector-error" role="alert">
								{text()}
							</p>
						)}
					</Show>
				</Show>
			),
		},
	]

	return (
		<div class="ocp-wizard">
			<Loading fallback={<p class="ocp-muted">Checking readiness…</p>}>
				<Steps steps={steps()} variant="rail" node="sm" colorBase="primary" />
				<div class="ocp-wizard-actions">
					<Button
						variant="text"
						disabled={step() === 0 || busy()}
						onClick={() => setStep((s) => s - 1)}
					>
						Back
					</Button>
					<Show
						when={step() < 3}
						fallback={
							<Button
								variant="solid"
								colorBase="primary"
								disabled={readiness().blocked || busy()}
								onClick={() => void publish()}
							>
								Publish
							</Button>
						}
					>
						<Button
							variant="solid"
							disabled={busy() || (step() === 0 && readiness().blocked)}
							onClick={() => setStep((s) => s + 1)}
						>
							Next
						</Button>
					</Show>
				</div>
			</Loading>
		</div>
	)
}
