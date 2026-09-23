/**
 * A document's family colour, changed in place by the central team (decisions U21, U25):
 * the swatch and its hex; "Change" opens the colour field — the colour at work on paper
 * and at night, the contrast its text reaches — with "Back to the print colour" when the
 * print gave one. Nothing is saved until "Save the colour"; the page retints when it is.
 */

import { Button } from '@aicolab/ui-solid'
import { createSignal, Show, untrack } from 'solid-js'
import { familyStyle, isHexColour } from '#/lib/family.ts'
import { setDocumentAccent } from '#/server/admin.ts'
import { FamilyColourField } from './FamilyColour.tsx'
import './accent-editor.css'

export function AccentEditor(props: {
	documentId: string
	/** What the specimens are named after. */
	name: string
	accent: string | null
	printAccent: string | null
	onSaved: (accent: string) => void | Promise<void>
}) {
	const [editing, setEditing] = createSignal(false)
	const [value, setValue] = createSignal(
		untrack(() => props.accent ?? props.printAccent ?? '#6b6f7a'),
	)
	const [busy, setBusy] = createSignal(false)
	const [error, setError] = createSignal<string | null>(null)
	const save = async () => {
		setBusy(true)
		setError(null)
		try {
			const result = await setDocumentAccent({
				data: { documentId: props.documentId, accent: value() },
			})
			await props.onSaved(result.accent ?? value())
			setEditing(false)
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}
	return (
		<div class="ocp-accent" style={familyStyle(props.accent)}>
			<div class="ocp-accent-now">
				<span class="ocp-accent-swatch" aria-hidden="true" />
				<code>{props.accent ?? 'none'}</code>
				<Show when={!editing()}>
					<button
						type="button"
						class="ocp-link-button"
						onClick={() => {
							setValue(props.accent ?? props.printAccent ?? '#6b6f7a')
							setEditing(true)
						}}
					>
						Change
					</button>
				</Show>
			</div>
			<Show when={editing()}>
				<div class="ocp-accent-edit">
					<FamilyColourField
						value={value()}
						onChange={setValue}
						print={props.printAccent}
						name={props.name}
					/>
					<Show when={error()}>
						{(text) => (
							<p class="ocp-accent-error" role="alert">
								{text()}
							</p>
						)}
					</Show>
					<div class="ocp-accent-actions">
						<Button
							variant="solid"
							disabled={busy() || !isHexColour(value())}
							onClick={() => void save()}
						>
							Save the colour
						</Button>
						<Button variant="text" disabled={busy()} onClick={() => setEditing(false)}>
							Cancel
						</Button>
					</div>
				</div>
			</Show>
		</div>
	)
}
