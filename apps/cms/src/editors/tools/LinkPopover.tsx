/**
 * The Link tool: make the selected words a link — to a web address, to another section
 * of this document (a typed cross-reference that follows the section wherever it is
 * numbered), to a section of the Principles for Optimal Cancer Care, or to another
 * published pathway. The selection is the link's text. With nothing selected, a
 * cross-reference to a section of this document writes the section's own heading as
 * its words (what "Cross-reference" in the Insert menu relies on); every other kind asks
 * for the words to be selected first.
 */

import { Button, Field, Notice, Segmented, TextInput } from '@aicolab/ui-solid'
import { createMemo, createSignal, For, onSettled, Show, untrack, useContext } from 'solid-js'
import { numberLabel } from '#/lib/labels.ts'
import { publishedHref } from '#/lib/links.ts'
import { outlineOrder } from '#/lib/outline.ts'
import { DocumentContext, type EditorControl, sectionLabel } from '#/lifecycle/workspace.ts'
import { type LinkTargets, linkTargets } from '#/server/link-targets.ts'
import { crossReference } from './insert.ts'

export type LinkTab = 'web' | 'document' | 'principles' | 'pathway'

const TABS: { id: LinkTab; label: string }[] = [
	{ id: 'web', label: 'Web address' },
	{ id: 'document', label: 'This document' },
	{ id: 'principles', label: 'Principles' },
	{ id: 'pathway', label: 'Another pathway' },
]

/** The link targets, read once a page: they change only when something is published. */
let targets: Promise<LinkTargets> | null = null
const loadTargets = (): Promise<LinkTargets> => {
	if (!targets) {
		targets = linkTargets()
		targets.catch(() => {
			targets = null
		})
	}
	return targets
}

/** The link the selection already sits in, read off the editor's DOM as the tool opens
 *  (the caret is still in the text then). */
type ExistingLink = { tab: LinkTab; href: string; address: string }
function existingLink(): ExistingLink | null {
	const node = typeof document === 'undefined' ? null : document.getSelection()?.anchorNode
	const element = node instanceof Element ? node : (node?.parentElement ?? null)
	const anchor = element?.closest('.ProseMirror a')
	if (!(anchor instanceof HTMLAnchorElement)) return null
	const address = anchor.dataset.address
	if (anchor.dataset.ocp === 'section' && address) return { tab: 'document', href: '', address }
	const href = anchor.getAttribute('href') ?? ''
	if (href.startsWith('/p/')) return { tab: href.includes('#') ? 'principles' : 'pathway', href, address: '' }
	return { tab: 'web', href, address: '' }
}

/** A web address a link may carry: http(s), or mailto. */
const webProblem = (href: string): string | null => {
	const text = href.trim()
	if (text === '') return 'Write the web address.'
	const parsed = URL.canParse(text) ? new URL(text) : null
	if (!parsed) return 'Write the whole address, starting with https://.'
	if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:') return null
	return 'A link must start with https://, http:// or mailto:.'
}

const NEED_WORDS = 'Select the words to link first'

export function LinkPopover(props: { control: EditorControl | null; tab: LinkTab | null; close: () => void }) {
	const workspace = useContext(DocumentContext)
	// Read once as the tool opens: the selection and the link it already carries.
	const selected = untrack(() => props.control?.selectedText().trim() ?? '')
	const existing = existingLink()
	const [tab, setTab] = createSignal<LinkTab>(untrack(() => props.tab) ?? existing?.tab ?? 'web')
	const [href, setHref] = createSignal(existing?.tab === 'web' ? existing.href : 'https://')
	const [tried, setTried] = createSignal(false)
	const [filter, setFilter] = createSignal('')
	const [remote, setRemote] = createSignal<LinkTargets | null>(null)
	const [remoteError, setRemoteError] = createSignal<string | null>(null)

	onSettled(() => {
		loadTargets()
			.then(setRemote)
			.catch((e: unknown) => setRemoteError(e instanceof Error ? e.message : 'The Principles and pathways could not be read.'))
	})

	const apply = (target: { href: string } | { address: string }) => {
		const control = props.control
		props.close()
		control?.link(target)
	}

	const remove = () => {
		const control = props.control
		props.close()
		control?.link(null)
	}

	const words = (text: string) => text.toLowerCase().split(/\s+/).filter(Boolean)
	const matches = (text: string) => {
		const want = words(filter())
		const hay = text.toLowerCase()
		return want.every((w) => hay.includes(w))
	}

	const ownSections = createMemo(() => {
		const rows = outlineOrder(workspace.sections())
		const left = new Set<string>()
		return rows.filter((s) => {
			const out = s.hidden || s.apparatus || (s.parentId !== null && left.has(s.parentId))
			if (out) left.add(s.id)
			return !out && matches(sectionLabel(s))
		})
	})

	const principleSections = createMemo(() => {
		const p = remote()?.principles
		return p ? p.sections.filter((s) => matches(sectionLabel(s))) : []
	})

	const pathways = createMemo(() => (remote()?.pathways ?? []).filter((p) => matches(p.name)))

	const pickSection = (s: { address: string; printedNumber: string | null; title: string | null }) => {
		if (selected !== '') {
			apply({ address: s.address })
			return
		}
		const control = props.control
		props.close()
		control?.insert(crossReference(sectionLabel(s), s.address))
	}

	const webError = createMemo(() => (tried() ? webProblem(href()) : null))
	const submitWeb = (event: SubmitEvent) => {
		event.preventDefault()
		setTried(true)
		if (selected === '' || webProblem(href())) return
		apply({ href: href().trim() })
	}

	const focusSoon = (el: HTMLElement) => requestAnimationFrame(() => el.focus())

	return (
		<div class="ocp-link">
			<Segmented label="Link to" class="ocp-link-tabs" options={TABS} value={tab()} onChange={(next) => {
				setTab(next)
				setFilter('')
			}} />
			<p class="ocp-tool-caption">
				{selected === '' ? (tab() === 'document' ? 'Nothing selected: the section’s heading goes in as the link.' : NEED_WORDS) : `Linking “${selected.length > 60 ? `${selected.slice(0, 60)}…` : selected}”`}
			</p>
			<Show when={tab() === 'web'}>
				<form class="ocp-tool-form" onSubmit={submitWeb}>
					<Field label="Web address" hint="A page on the web (https://…) or an email address (mailto:…).">
						<TextInput
							type="url"
							value={href()}
							maxlength={2000}
							ref={focusSoon}
							aria-invalid={webError() ? 'true' : undefined}
							onInput={(event) => setHref(event.currentTarget.value)}
						/>
					</Field>
					<Show when={webError()}>{(message) => <p class="ocp-tool-error">{message()}</p>}</Show>
					<div class="ocp-tool-actions">
						<Show when={existing}>
							<Button type="button" variant="ghost" colorBase="error" onClick={remove}>
								Remove link
							</Button>
						</Show>
						<Button type="submit" disabled={selected === ''} title={selected === '' ? NEED_WORDS : undefined}>
							{selected === '' ? NEED_WORDS : 'Apply'}
						</Button>
					</div>
				</form>
			</Show>
			<Show when={tab() !== 'web'}>
				<input
					class="ocp-tool-filter"
					type="search"
					aria-label={tab() === 'pathway' ? 'Find a pathway' : 'Find a section'}
					placeholder={tab() === 'pathway' ? 'A pathway’s name…' : 'A section number or words from its title…'}
					autocomplete="off"
					value={filter()}
					ref={focusSoon}
					onInput={(event) => setFilter(event.currentTarget.value)}
				/>
				<Show when={tab() !== 'document' && remoteError()}>
					{(message) => (
						<Notice colorBase="error" variant="soft" role="alert">
							{message()}
						</Notice>
					)}
				</Show>
				<ul class="ocp-link-list" aria-label={TABS.find((t) => t.id === tab())?.label}>
					<Show when={tab() === 'document'}>
						<For each={ownSections()} fallback={<li class="ocp-tool-empty">No section of this document matches.</li>}>
							{(s) => (
								<li>
									<TargetButton
										number={s.printedNumber}
										title={s.title ?? s.address}
										current={existing?.address === s.address}
										onPick={() => pickSection(s)}
									/>
								</li>
							)}
						</For>
					</Show>
					<Show when={tab() === 'principles'}>
						<Show when={remote()} fallback={<li class="ocp-tool-status">Reading the Principles…</li>}>
							{(r) => (
								<Show when={r().principles} fallback={<li class="ocp-tool-empty">The Principles are not in this system yet.</li>}>
									{(p) => (
										<For each={principleSections()} fallback={<li class="ocp-tool-empty">No section of the Principles matches.</li>}>
											{(s) => (
												<li>
													<TargetButton
														number={s.printedNumber}
														title={s.title ?? s.address}
														disabled={selected === ''}
														current={existing?.href === `${publishedHref(p().slug)}#${s.address}`}
														onPick={() => apply({ href: `${publishedHref(p().slug)}#${s.address}` })}
													/>
												</li>
											)}
										</For>
									)}
								</Show>
							)}
						</Show>
					</Show>
					<Show when={tab() === 'pathway'}>
						<Show when={remote()} fallback={<li class="ocp-tool-status">Reading the published pathways…</li>}>
							<For each={pathways()} fallback={<li class="ocp-tool-empty">No published pathway matches.</li>}>
								{(p) => (
									<li>
										<TargetButton
											number={null}
											title={p.name}
											disabled={selected === ''}
											current={existing?.href === publishedHref(p.slug)}
											onPick={() => apply({ href: publishedHref(p.slug) })}
										/>
									</li>
								)}
							</For>
						</Show>
					</Show>
				</ul>
				<Show when={existing}>
					<div class="ocp-tool-actions">
						<Button type="button" variant="ghost" colorBase="error" onClick={remove}>
							Remove link
						</Button>
					</div>
				</Show>
			</Show>
		</div>
	)
}

function TargetButton(props: {
	number: string | null
	title: string
	disabled?: boolean
	current?: boolean
	onPick: () => void
}) {
	return (
		<button
			type="button"
			class="ocp-link-target"
			disabled={props.disabled}
			title={props.disabled ? NEED_WORDS : undefined}
			aria-current={props.current ? 'true' : undefined}
			onMouseDown={(event) => event.preventDefault()}
			onClick={() => props.onPick()}
		>
			<span class="ocp-link-number">{props.number ? numberLabel(props.number) : ''}</span>
			<span class="ocp-link-title">{props.title}</span>
			<Show when={props.current}>
				<span class="ocp-link-current">linked now</span>
			</Show>
		</button>
	)
}
