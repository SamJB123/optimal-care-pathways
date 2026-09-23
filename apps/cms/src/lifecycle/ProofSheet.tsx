/**
 * Publishing, as a proof sheet (decisions U16, S15; it replaces the step-by-step wizard):
 * the edition's imprint as the published page will set it, live as the label and the
 * release notes are written; the readiness checklist, each item naming the sections it
 * is about as links into them; every change the edition carries, grouped by step, with
 * its marks; then the sign-off. The result is said in place, with the published pages
 * to open. The gate is the server's (decision 99): read when the sheet opens, enforced
 * again at publish. Central members reach this.
 */

import { Button, Checkbox, Field, TextArea, TextInput } from '@aicolab/ui-solid'
import { createMemo, createSignal, For, Loading, Show, useContext } from 'solid-js'
import { RenderedBody } from '#/content/render.tsx'
import { imprintDate } from '#/lib/labels.ts'
import { draftDocxHref, draftPdfHref, guideHref, partHref, pdfHref, previewHref, publishedHref, sectionAnchor } from '#/lib/links.ts'
import { bandLabel, type SpineBand, spineOf } from '#/lib/outline.ts'
import { publishDocument, publishReadiness } from '#/server/lifecycle-fns.ts'
import type { GateItem } from '#/server/lifecycle.ts'
import { type ChangeEntry, DocumentContext, sectionLabel } from './workspace.ts'
import './proof.css'

const LEVEL_GLYPH: Record<GateItem['level'], string> = { block: '✕', warn: '!', ok: '✓' }

/** How a change reads in the proof: what kind, and where the review left it. */
function changeTag(e: ChangeEntry, published: boolean): string {
	const kind =
		e.change.change === 'removal'
			? 'Removed'
			: e.section.added || !published
				? 'New'
				: `Changed +${e.change.annotated.inserted} −${e.change.annotated.deleted}`
	const decided = e.change.decision?.decision
	return decided === 'approved' ? `${kind} · approved` : decided === 'changes_requested' ? `${kind} · sent back` : kind
}

export function ProofSheet(props: { onClose: () => void }) {
	const workspace = useContext(DocumentContext)
	const readiness = createMemo(() => publishReadiness({ data: { documentId: workspace.documentId } }))
	const [label, setLabel] = createSignal('')
	const [notes, setNotes] = createSignal('')
	const [signed, setSigned] = createSignal(false)
	const [busy, setBusy] = createSignal(false)
	const [error, setError] = createSignal<string | null>(null)
	const [done, setDone] = createSignal<{ versionNo: number; at: number } | null>(null)
	const now = Date.now()
	const state = () => workspace.state()
	const editionNo = () => state().draft.versionNo

	/** The changes grouped by the step they sit in, in reading order. */
	const groups = createMemo(() => {
		const bands = spineOf(workspace.sections())
		const bandOf = new Map<string, SpineBand>()
		for (const band of bands) for (const s of band.sections) bandOf.set(s.id, band.band)
		const out: { band: SpineBand; entries: ChangeEntry[] }[] = []
		for (const entry of workspace.changeOrder()) {
			const band = bandOf.get(entry.section.id) ?? 'back'
			const last = out.at(-1)
			if (last?.band === band) last.entries.push(entry)
			else out.push({ band, entries: [entry] })
		}
		return out
	})

	const publish = async () => {
		setBusy(true)
		setError(null)
		try {
			const result = await publishDocument({
				data: { documentId: workspace.documentId, label: label().trim() || null, releaseNotes: notes().trim() || null },
			})
			setDone({ versionNo: result.versionNo, at: Date.now() })
			await workspace.refreshState()
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}

	return (
		<div class="ocp-proof">
			<Show
				when={done()}
				fallback={
					<>
						<p class="ocp-proof-lead">
							The proof of edition {editionNo()}: what readers will get when you publish. Read it through, then sign it off.
						</p>
						<p class="ocp-proof-links">
							<a href={previewHref(workspace.documentId)}>Open the preview</a>
							<a href={draftPdfHref(workspace.documentId)}>Download as PDF</a>
							<a href={draftDocxHref(workspace.documentId)}>Download as Word</a>
						</p>

						<section class="ocp-proof-imprint" aria-labelledby="ocp-proof-imprint">
							<h3 id="ocp-proof-imprint">The imprint, as it will read</h3>
							<div class="ocp-proof-imprint-grid">
								<div class="ocp-proof-specimen" aria-live="polite">
									<p class="ocp-proof-specimen-kicker">Optimal Care Pathways · published</p>
									<p class="ocp-proof-specimen-title">{workspace.document.title}</p>
									<p class="ocp-proof-specimen-meta">
										{[`Version ${editionNo()}`, label().trim() || null, imprintDate(now)].filter((part) => part).join(' · ')}
									</p>
									<Show when={notes().trim()}>{(text) => <p class="ocp-proof-specimen-notes">{text()}</p>}</Show>
								</div>
								<div class="ocp-proof-fields">
									<Field label="Edition label (optional)" hint="How the edition is named, as the print names it: “Third edition”.">
										<TextInput value={label()} onInput={(e) => setLabel(e.currentTarget.value)} />
									</Field>
									<Field label="Release notes" hint="What changed, for the people who read the pathway.">
										<TextArea rows={4} value={notes()} onInput={(e) => setNotes(e.currentTarget.value)} />
									</Field>
								</div>
							</div>
						</section>

						<Loading fallback={<p class="ocp-muted">Checking the draft against the gate…</p>}>
							<section aria-labelledby="ocp-proof-ready">
								<h3 id="ocp-proof-ready">Ready to publish?</h3>
								<ul class="ocp-gate">
									<For each={readiness().items}>
										{(item) => (
											<li data-level={item.level}>
												<span class="ocp-gate-glyph" aria-hidden="true">
													{LEVEL_GLYPH[item.level]}
												</span>
												<span>
													{item.message}
													<Show when={item.level !== 'ok' && (item.sections?.length ?? 0) > 0}>
														<span class="ocp-proof-where">
															<For each={(item.sections ?? []).slice(0, 12)}>
																{(address) => <SectionLink address={address} onFollow={props.onClose} />}
															</For>
															<Show when={(item.sections?.length ?? 0) > 12}>
																<span class="ocp-muted">and {(item.sections?.length ?? 0) - 12} more</span>
															</Show>
														</span>
													</Show>
												</span>
											</li>
										)}
									</For>
								</ul>
							</section>
						</Loading>

						<section aria-labelledby="ocp-proof-changes">
							<h3 id="ocp-proof-changes">
								What changes: {workspace.changeOrder().length} {workspace.changeOrder().length === 1 ? 'section' : 'sections'}
							</h3>
							<For each={groups()}>
								{(group) => (
									<div class="ocp-proof-group">
										<h4>
											{bandLabel(group.band)} <span class="ocp-muted">{group.entries.length}</span>
										</h4>
										<For each={group.entries}>{(entry) => <ProofChange entry={entry} published={state().published !== null} />}</For>
									</div>
								)}
							</For>
						</section>

						<section class="ocp-proof-sign" aria-labelledby="ocp-proof-sign">
							<h3 id="ocp-proof-sign">Sign off</h3>
							<Checkbox checked={signed()} onChange={(e) => setSigned(e.currentTarget.checked)}>
								I have read this proof of edition {editionNo()}.
							</Checkbox>
							<Show when={error()}>
								{(text) => (
									<p class="ocp-proof-error" role="alert">
										{text()}
									</p>
								)}
							</Show>
							<Loading fallback={null}>
								<div class="ocp-proof-actions">
									<Button variant="solid" disabled={!signed() || readiness().blocked || busy()} onClick={() => void publish()}>
										{busy() ? 'Publishing…' : `Publish edition ${editionNo()}`}
									</Button>
									<Show when={readiness().blocked}>
										<span class="ocp-muted">The gate above says what is left before this can publish.</span>
									</Show>
								</div>
							</Loading>
						</section>
					</>
				}
			>
				{(result) => (
					<section class="ocp-proof-done" role="status">
						<p class="ocp-proof-done-title">
							Edition {result().versionNo}
							{label().trim() ? `, ${label().trim()},` : ''} is published, {imprintDate(result().at)}.
						</p>
						<p>Readers now get it at its address. The draft of edition {result().versionNo + 1} is open for the next changes.</p>
						<p class="ocp-proof-links">
							<a href={publishedHref(workspace.document.slug)}>The published page</a>
							<Show when={workspace.document.kind === 'pathway'}>
								<a href={guideHref(workspace.document.slug)}>The quick reference guide</a>
							</Show>
							<a href={pdfHref(workspace.document.slug)}>The PDF</a>
						</p>
						<Button variant="outline" onClick={props.onClose}>
							Back to the draft
						</Button>
					</section>
				)}
			</Show>
		</div>
	)
}

/** A section a gate item names, as a link into the workspace (following it closes the
 *  sheet); plain text when the section is not on the page. */
function SectionLink(props: { address: string; onFollow: () => void }) {
	const workspace = useContext(DocumentContext)
	const found = createMemo(() => {
		const s = workspace.sections().find((row) => row.address === props.address)
		if (!s) return null
		let root = s
		for (let parent = root.parentId ? workspace.sections().find((r) => r.id === root.parentId) : undefined; parent; parent = root.parentId ? workspace.sections().find((r) => r.id === root.parentId) : undefined) root = parent
		return { label: sectionLabel(s), href: `${partHref(workspace.documentId, root.address)}#${sectionAnchor(s.address)}` }
	})
	return (
		<Show when={found()} fallback={<span>{props.address}</span>}>
			{(link) => (
				<a href={link().href} onClick={() => props.onFollow()}>
					{link().label}
				</a>
			)}
		</Show>
	)
}

/** One change in the proof: its heading and tag, and — once opened — its marked text. */
function ProofChange(props: { entry: ChangeEntry; published: boolean }) {
	const workspace = useContext(DocumentContext)
	const [open, setOpen] = createSignal(false)
	return (
		<details class="ocp-proof-change" data-change={props.entry.change.change} onToggle={(e) => setOpen(e.currentTarget.open)}>
			<summary>
				<span class="ocp-proof-change-label">{sectionLabel(props.entry.section)}</span>
				<span class="ocp-proof-change-tag">{changeTag(props.entry, props.published)}</span>
			</summary>
			<Show when={open()}>
				<RenderedBody body={props.entry.change.annotated.body} derived={workspace.derived} guidance={workspace.guidance} />
			</Show>
		</details>
	)
}
