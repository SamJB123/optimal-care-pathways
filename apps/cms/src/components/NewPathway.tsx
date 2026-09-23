/**
 * Starting a pathway (decision S10): a sheet from the atlas for the central team. The
 * subject is written once and the rest follows from it — the title in the template's own
 * words, the address — each still editable; the family colour is chosen with its specimens
 * on both grounds. The new pathway's workspace opens when it exists.
 */

import { AdaptiveModalSheet, Button, Field, TextInput } from '@aicolab/ui-solid'
import { useNavigate } from '@tanstack/solid-router'
import { createSignal, Show } from 'solid-js'
import { documentName } from '#/lib/labels.ts'
import { createPathway } from '#/server/documents.ts'
import { FamilyColourField } from './FamilyColour.tsx'
import './new-pathway.css'

type Kind = 'cancer' | 'population'

const titleFor = (kind: Kind, subject: string) =>
	kind === 'cancer'
		? `Optimal care pathway for people with ${subject || '…'}`
		: `Optimal care pathway for ${subject || '…'} with cancer`

const slugFor = (subject: string) =>
	subject
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64)

export function NewPathwaySheet(props: { open: boolean; onDismiss: () => void }) {
	const navigate = useNavigate()
	const [kind, setKind] = createSignal<Kind>('cancer')
	const [subject, setSubject] = createSignal('')
	const [title, setTitle] = createSignal<string | null>(null)
	const [slug, setSlug] = createSignal<string | null>(null)
	const [accent, setAccent] = createSignal('#3c79b0')
	const [busy, setBusy] = createSignal(false)
	const [error, setError] = createSignal<string | null>(null)

	const shownTitle = () => title() ?? titleFor(kind(), subject().trim())
	const shownSlug = () => slug() ?? slugFor(subject())

	const create = async (event: Event) => {
		event.preventDefault()
		setBusy(true)
		setError(null)
		try {
			const result = await createPathway({
				data: { kind: kind(), subject: subject().trim(), title: shownTitle(), slug: shownSlug(), accent: accent() },
			})
			props.onDismiss()
			await navigate({ to: '/d/$documentId', params: { documentId: result.documentId } })
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}

	return (
		<AdaptiveModalSheet open={props.open} label="New pathway" title="New pathway" onDismiss={props.onDismiss}>
			<form class="ocp-new-pathway" onSubmit={(e) => void create(e)}>
				<fieldset class="ocp-new-kind">
					<legend>What it is for</legend>
					<label>
						<input type="radio" name="kind" value="cancer" checked={kind() === 'cancer'} onChange={() => setKind('cancer')} />
						A cancer type
						<span>from the cancer-specific template</span>
					</label>
					<label>
						<input type="radio" name="kind" value="population" checked={kind() === 'population'} onChange={() => setKind('population')} />
						A population group
						<span>from the population template</span>
					</label>
				</fieldset>
				<Field
					label={kind() === 'cancer' ? 'The cancer type' : 'The population group'}
					hint={kind() === 'cancer' ? 'As the text reads it: "breast cancer", "multiple myeloma"' : 'As the text reads it: "older people"'}
				>
					<TextInput value={subject()} required onInput={(e) => setSubject(e.currentTarget.value)} />
				</Field>
				<Field label="Title">
					<TextInput value={shownTitle()} required onInput={(e) => setTitle(e.currentTarget.value)} />
				</Field>
				<Field label="Address" hint={`Published at /p/${shownSlug() || '…'}`}>
					<TextInput
						value={shownSlug()}
						required
						pattern="[a-z0-9]+(-[a-z0-9]+)*"
						onInput={(e) => setSlug(e.currentTarget.value)}
					/>
				</Field>
				<FamilyColourField
					value={accent()}
					onChange={setAccent}
					name={subject().trim() ? documentName({ kind: 'pathway', audience: kind(), subject: subject() }) : 'The new pathway'}
				/>
				<Show when={error()}>
					{(text) => (
						<p class="ocp-new-error" role="alert">
							{text()}
						</p>
					)}
				</Show>
				<div class="ocp-new-actions">
					<Button type="button" variant="text" onClick={props.onDismiss}>
						Cancel
					</Button>
					<Button type="submit" variant="solid" disabled={busy() || !subject().trim()}>
						{busy() ? 'Creating…' : 'Create the pathway'}
					</Button>
				</div>
			</form>
		</AdaptiveModalSheet>
	)
}
