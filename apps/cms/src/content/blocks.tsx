/**
 * The template's blocks as Solid components (decisions 62, 77): ONE set of components
 * paints a body in the editor (as ProseKit node views, `editors/node-views.tsx`) and in
 * every read-only view (the Solid renderer, `render.tsx`). Each block takes its node's
 * attributes and renders its children where the node's content goes; in the editor the
 * children are ProseMirror's content element, in the renderer the recursively rendered
 * child nodes. `edit` is present only in the editor and carries the attribute setter.
 *
 * Paint comes from ui-solid: a box is a Callout in its colour family (the banner child
 * is its band, an editable node, so it renders inside the body flush to the edges),
 * a callout-kind box a Notice, guidance an AccordionItem whose open state is the done
 * tick, a timeframe a Callout in the error family, resources a RichList of items, and
 * the layout blocks plain grid containers. Every element keeps its `data-ocp` name so
 * the derived views and the CSS in blocks.css address both paths alike.
 */

import {
	AccordionItem,
	Button,
	Callout,
	colorTreatmentData,
	Field,
	FlowMap,
	type FlowMapFooter,
	type FlowMapNode,
	type FlowMapRail,
	Notice,
	RichList,
	RichListItem,
	TextInput,
} from '@aicolab/ui-solid'
import { type JSX, Portal } from '@solidjs/web'
import { createContext, createSignal, createUniqueId, For, Show, useContext } from 'solid-js'
import './blocks.css'
import {
	type DerivedView,
	emptyDerived,
	type PathwayMapView,
	type TimeframeRow,
} from './derived.ts'
import {
	type BannerAttrs,
	type BoxAttrs,
	boxFamily,
	type GuidanceAttrs,
	type ResourceAttrs,
} from './schema.ts'

/** What a rendered body needs beyond its own JSON (decisions 15, 50); the page provides
 *  it, the blocks read it. An accessor, so a page whose derived view moves (a fold that
 *  adds a timeframe) re-renders the blocks that read it; a context value itself is read
 *  once. The default is the empty view, so a body renders anywhere. */
export const DerivedContext = createContext<() => DerivedView>(() => emptyDerived())

/** ProseKit's TextAlign values, as CSS names them. */
const TEXT_ALIGNS = ['left', 'center', 'right', 'justify'] as const
export type TextAlign = (typeof TEXT_ALIGNS)[number]
export const textAlignOf = (value: unknown): TextAlign | null =>
	TEXT_ALIGNS.find((align) => align === value) ?? null

/** The editor's hooks into a block; absent in read-only rendering. */
export interface BlockEdit<Attrs> {
	setAttrs(patch: Partial<Attrs>): void
	/** For one alternative of a `variants` group: keep it, in place of the whole group. */
	keep?(): void
}

export interface BlockProps<Attrs> {
	attrs: Attrs
	edit?: BlockEdit<Attrs>
	children?: JSX.Element
}

const BOX_ICONS: Record<string, string> = {
	pen: '✎',
	info: 'ⓘ',
	hand: '☞',
	clipboard: '☑',
	speech: '❝',
	care: '♡',
	stopwatch: '⏱',
}

export function BoxBlock(props: BlockProps<BoxAttrs>) {
	const mode = useContext(GuidanceModeContext)
	// A developer box (the template's green pen box) is, in a pathway, the box the team is
	// writing: painted as it will publish — a plain banded box, no green, no pen. In the
	// template itself it is the template's own green box, as printed.
	const paint = () =>
		mode === 'margin' && props.attrs.kind === 'developer'
			? { family: boxFamily({ kind: 'plain', family: props.attrs.family }), glyph: '' }
			: { family: boxFamily(props.attrs), glyph: BOX_ICONS[props.attrs.icon] ?? '' }
	return (
		<Show
			when={props.attrs.kind === 'callout'}
			fallback={
				<Callout
					as="section"
					colorBase={paint().family}
					variant="outline"
					class="ocp-box"
					data-ocp="box"
					data-kind={props.attrs.kind}
					data-icon={props.attrs.icon}
					data-glyph={paint().glyph}
					style={{ '--ocp-glyph': JSON.stringify(paint().glyph) }}
				>
					{props.children}
				</Callout>
			}
		>
			<Notice
				colorBase={boxFamily(props.attrs)}
				variant={props.attrs.variant}
				role="note"
				class="ocp-box ocp-box-callout"
				data-ocp="box"
				data-kind="callout"
			>
				{props.children}
			</Notice>
		</Show>
	)
}

export function BannerBlock(props: BlockProps<BannerAttrs>) {
	const tone = () => (props.attrs.tone === 'sub' ? 'sub' : 'band')
	return (
		<p
			data-ocp="banner"
			data-tone={tone()}
			{...colorTreatmentData({
				colorBase: 'secondary',
				variant: tone() === 'sub' ? 'soft' : 'solid',
			})}
		>
			{props.children}
		</p>
	)
}

/** Where drafting guidance shows (decision: guidance in a pathway lives in the margin).
 *  In a core template the guidance IS the template's text, written and read in place;
 *  in a pathway it is the template talking to the drafter: the text shows nothing where
 *  the note stands (the anchor keeps its place, sized to nothing) and the margin carries
 *  the note. A note under the reader's eye in the margin lights the block it stands
 *  beside (blocks.css), so the link from note to place survives without a mark. */
export type GuidanceMode = 'inline' | 'margin'
export const GuidanceModeContext = createContext<GuidanceMode>('inline')

export function GuidanceBlock(props: BlockProps<GuidanceAttrs>) {
	const mode = useContext(GuidanceModeContext)
	return (
		<Show when={mode === 'margin'} fallback={<GuidanceInline {...props} />}>
			<aside
				class="ocp-guidance-anchor"
				data-ocp="guidance"
				data-done={props.attrs.done ? 'true' : 'false'}
				contenteditable="false"
				aria-hidden="true"
			>
				<div class="ocp-guidance-hidden">{props.children}</div>
			</aside>
		</Show>
	)
}

function GuidanceInline(props: BlockProps<GuidanceAttrs>) {
	const toggle = (event: Event) => {
		event.preventDefault()
		event.stopPropagation()
		props.edit?.setAttrs({ done: !props.attrs.done })
	}
	return (
		<AccordionItem
			colorBase="success"
			variant="soft"
			class="ocp-guidance"
			data-ocp="guidance"
			data-done={props.attrs.done ? 'true' : 'false'}
			open={!props.attrs.done}
			radius="0.4rem"
			padInline="0.9rem"
			bodySurface="transparent"
			summary={() => (
				<span class="ocp-guidance-summary">
					<span class="ocp-guidance-label">Drafting guidance</span>
					<Show when={props.attrs.done}>
						<span class="ocp-guidance-done">done</span>
					</Show>
				</span>
			)}
		>
			{/* The Done control opens the body, not the summary: a control inside the
			    summary would be a control inside a control. */}
			<Show when={props.edit}>
				<button
					type="button"
					class="ocp-guidance-tick"
					contenteditable="false"
					aria-pressed={props.attrs.done ? 'true' : 'false'}
					title={props.attrs.done ? 'Reopen this guidance' : 'Mark this guidance done'}
					onClick={toggle}
				>
					<span aria-hidden="true">{props.attrs.done ? '☑' : '☐'}</span>
					<span>Done</span>
				</button>
			</Show>
			{props.children}
		</AccordionItem>
	)
}

export function TimeframeBlock(props: BlockProps<Record<string, never>>) {
	return (
		<Callout
			as="aside"
			colorBase="error"
			variant="outline"
			class="ocp-timeframe"
			data-ocp="timeframe"
		>
			{props.children}
		</Callout>
	)
}

export function CarePointBlock(props: BlockProps<{ textAlign: TextAlign | null }>) {
	return (
		<p
			data-ocp="carePoint"
			style={props.attrs.textAlign ? { 'text-align': props.attrs.textAlign } : undefined}
		>
			{props.children}
		</p>
	)
}

/** The template's "Or" rows: alternatives of which an author keeps one. In a pathway's
 *  editor each alternative offers "Keep this", which puts its blocks in the group's place
 *  (one undoable edit); the box's band carries "Choose one" while the group stands
 *  (blocks.css). In the template itself the rows are the template's own, kept as printed. */
export function VariantsBlock(props: BlockProps<Record<string, never>>) {
	return <div data-ocp="variants">{props.children}</div>
}

export function VariantBlock(props: BlockProps<Record<string, never>>) {
	const mode = useContext(GuidanceModeContext)
	return (
		<div data-ocp="variant">
			{props.children}
			<Show when={mode === 'margin' ? props.edit?.keep : undefined}>
				{(keep) => (
					<div class="ocp-variant-keep" contenteditable="false">
						<Button
							type="button"
							variant="outline"
							title="Keep this alternative; the others are removed from the draft"
							onClick={(event) => {
								event.preventDefault()
								keep()()
							}}
						>
							Keep this
						</Button>
					</div>
				)}
			</Show>
		</div>
	)
}

export function ColumnsBlock(props: BlockProps<Record<string, never>>) {
	return <div data-ocp="columns">{props.children}</div>
}

export function ColumnBlock(props: BlockProps<Record<string, never>>) {
	return <div data-ocp="column">{props.children}</div>
}

export function ResourceListBlock(props: BlockProps<Record<string, never>>) {
	// In the editor the node views' own elements stand between the list and its rows, which
	// a `ul` may not hold: there the list is a `div` with the list role.
	return (
		<RichList
			as={props.edit ? 'div' : 'ul'}
			colorBase="primary"
			class="ocp-resources"
			label="Resources"
		>
			{props.children}
		</RichList>
	)
}

export function ResourceBlock(props: BlockProps<ResourceAttrs>) {
	// Editing in place: an anchored form (title and link) against the entry's "edit"
	// button. It is portalled out of the editor's DOM, so ProseMirror never reads its
	// fields as part of the document, and exists only in the editor (`edit` present), so
	// the server's renderer never meets a Portal.
	const popoverId = `ocp-resource-${createUniqueId()}`
	const anchorName = `--ocp-resource-${createUniqueId()}`
	const [draftTitle, setDraftTitle] = createSignal('')
	const [draftUrl, setDraftUrl] = createSignal('')
	const [urlError, setUrlError] = createSignal<string | null>(null)
	let panel: HTMLElement | undefined
	/** Why a link cannot be stored, in words; null when it can. Blank is allowed (the
	 *  source printed a placeholder), as is `#address` for a section of the document. */
	const urlProblem = (url: string): string | null => {
		const text = url.trim()
		if (text === '') return null
		if (text.startsWith('#'))
			return /^#[\w.-]+$/.test(text)
				? null
				: 'A section is written as # and its number, such as #4.2.'
		const parsed = URL.canParse(text) ? new URL(text) : null
		return parsed && (parsed.protocol === 'https:' || parsed.protocol === 'http:')
			? null
			: 'Write the whole web address, starting with https://, or # and a section number.'
	}
	const attachPanel = (el: HTMLElement) => {
		panel = el
		// Each opening starts from the entry as it stands.
		el.addEventListener('beforetoggle', (event) => {
			if (!('newState' in event) || event.newState !== 'open') return
			setDraftTitle(props.attrs.title)
			setDraftUrl(props.attrs.url)
			setUrlError(null)
		})
		el.addEventListener('toggle', (event) => {
			if ('newState' in event && event.newState === 'open')
				el.querySelector<HTMLInputElement>('input')?.focus()
		})
	}
	const save = (event: SubmitEvent) => {
		event.preventDefault()
		const problem = urlProblem(draftUrl())
		setUrlError(problem)
		if (problem) return
		props.edit?.setAttrs({ title: draftTitle().trim(), url: draftUrl().trim() })
		panel?.hidePopover()
	}
	return (
		<RichListItem
			class="ocp-resource"
			title={
				<Show
					when={props.attrs.url !== ''}
					fallback={
						<span
							class="ocp-resource-title"
							data-ocp="resource"
							data-title={props.attrs.title}
							data-url=""
						>
							{props.attrs.title}
						</span>
					}
				>
					<a
						class="ocp-resource-title"
						data-ocp="resource"
						data-title={props.attrs.title}
						data-url={props.attrs.url}
						href={props.attrs.url}
						target={props.attrs.url.startsWith('#') ? undefined : '_blank'}
						rel={props.attrs.url.startsWith('#') ? undefined : 'noreferrer'}
					>
						{props.attrs.title}
					</a>
				</Show>
			}
			description={<span class="ocp-resource-body">{props.children}</span>}
			trailing={
				<Show when={props.edit}>
					<button
						type="button"
						class="ocp-resource-edit"
						popovertarget={popoverId}
						style={{ 'anchor-name': anchorName }}
						title="Edit the title and link"
					>
						edit
					</button>
					<Portal>
						<div
							id={popoverId}
							popover="auto"
							role="dialog"
							aria-label="Edit this resource"
							class={['ui-anchored', 'ocp-resource-popover']}
							style={{ 'position-anchor': anchorName, '--ui-anchored-width': '22rem' }}
							ref={attachPanel}
						>
							<form class="ocp-resource-form" onSubmit={save}>
								<Field label="Title">
									<TextInput
										value={draftTitle()}
										maxlength={500}
										onInput={(event) => setDraftTitle(event.currentTarget.value)}
									/>
								</Field>
								<Field
									label="Link"
									hint="A web address (https://…), or # and a section number (#4.2) for a section of this document. Leave it empty for none."
								>
									<TextInput
										value={draftUrl()}
										maxlength={2000}
										placeholder="https://"
										aria-invalid={urlError() ? 'true' : undefined}
										onInput={(event) => setDraftUrl(event.currentTarget.value)}
									/>
								</Field>
								<Show when={urlError()}>
									{(message) => <p class="ocp-resource-error">{message()}</p>}
								</Show>
								<div class="ocp-resource-actions">
									<Button
										type="button"
										variant="ghost"
										colorBase="neutral"
										onClick={() => panel?.hidePopover()}
									>
										Cancel
									</Button>
									<Button type="submit">Save</Button>
								</div>
							</form>
						</div>
					</Portal>
				</Show>
			}
		/>
	)
}

/** The snapshot of optimal timeframes, read off the document's timeframe boxes at
 *  render (decision 50). */
export function TimeframeSnapshotBlock() {
	const derived = useContext(DerivedContext)
	const rows = () => derived().timeframes
	const stepLabel = (row: TimeframeRow) =>
		row.stepNumber !== null ? `Step ${row.stepNumber}` : row.section
	return (
		<div
			data-ocp="timeframeSnapshot"
			{...colorTreatmentData({ colorBase: 'error', variant: 'outline' })}
		>
			<table class="ocp-snapshot">
				<caption>
					{rows().length > 0
						? 'Snapshot of optimal timeframes — generated from the timeframe boxes of this document.'
						: 'Snapshot of optimal timeframes — no timeframe boxes yet.'}
				</caption>
				<thead>
					<tr>
						<th>Pathway step</th>
						<th>Care point</th>
						<th>Timeframe</th>
					</tr>
				</thead>
				<tbody>
					<For each={rows()}>
						{(row, i) => (
							<tr>
								<td>
									{i() > 0 && stepLabel(rows()[i() - 1] ?? row) === stepLabel(row)
										? ''
										: stepLabel(row)}
								</td>
								<td>{row.carePoint}</td>
								<td>
									{/* Each statement on a line of its own; "or" only between a
									    statement's alternatives. */}
									<For each={row.statements}>
										{(alternatives) => (
											<p>
												<For each={alternatives}>
													{(alternative, j) => (
														<>
															<Show when={j() > 0}>
																<em> or </em>
															</Show>
															{alternative}
														</>
													)}
												</For>
											</p>
										)}
									</For>
								</td>
							</tr>
						)}
					</For>
				</tbody>
			</table>
		</div>
	)
}

/** Where the reader is, for the map's ring (decision 68): the step page provides it. */
export const MapContext = createContext<() => { currentStep: number | null }>(() => ({
	currentStep: null,
}))

const dateLabel = (ms: number | null) =>
	ms === null
		? null
		: new Date(ms).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * The pathway map (decisions 63, 67–74): the FlowMap organism over the document's
 * derived map view. Step nodes link to their step page; a note is quiet. When
 * interactive (members' views), each node carries its attention chip and a preview of
 * its care points, open items and last change; the rail previews each step's
 * supportive care section; the footer's cards link to the Principles document.
 */
export function PathwayMap(props: {
	map: PathwayMapView
	currentStep?: number | null
	interactive?: boolean
	class?: string
}) {
	const nodes = (): FlowMapNode[] =>
		props.map.nodes.map((node) => ({
			id: node.id,
			label: node.label,
			badge: node.badge ?? undefined,
			column: node.column,
			row: node.row,
			rowSpan: node.rowSpan,
			kind: node.kind,
			href: node.address ? `/d/${props.map.documentId}/${node.address}` : undefined,
			signal:
				node.kind === 'step'
					? node.openItems > 0
						? {
								level: 'warning',
								count: node.openItems,
								label: `${node.openItems} open ${node.openItems === 1 ? 'item' : 'items'}`,
							}
						: { level: 'success', label: 'Nothing open' }
					: undefined,
			preview:
				node.kind === 'step'
					? () => (
							<div class="ocp-map-preview">
								<strong>
									{node.badge ? `Step ${node.badge}: ` : ''}
									{node.label}
								</strong>
								<Show when={node.carePoints.length > 0}>
									<p class="ocp-map-preview-kicker">Care points</p>
									<ul>
										<For each={node.carePoints}>{(point) => <li>{point}</li>}</For>
									</ul>
								</Show>
								<p class="ocp-map-preview-line">
									{node.openItems === 0
										? 'No open items.'
										: `${node.openItems} open ${node.openItems === 1 ? 'item' : 'items'} (guidance and placeholders).`}
								</p>
								<Show when={dateLabel(node.updatedAt)}>
									{(when) => <p class="ocp-map-preview-line">Last updated {when()}.</p>}
								</Show>
							</div>
						)
					: undefined,
		}))
	const rail = (): FlowMapRail => ({
		label: props.map.rail.label,
		href: props.map.rail.items[0]
			? `/d/${props.map.documentId}/${props.map.rail.items[0].partAddress}`
			: undefined,
		preview:
			props.map.rail.items.length > 0
				? () => (
						<div class="ocp-map-preview">
							<strong>{props.map.rail.label}</strong>
							<p class="ocp-map-preview-line">A pathway-spanning step; each step has its own.</p>
							<ul>
								<For each={props.map.rail.items}>
									{(item) => (
										<li>
											<a href={`/d/${props.map.documentId}/${item.partAddress}`}>{item.label}</a>
										</li>
									)}
								</For>
							</ul>
						</div>
					)
				: undefined,
	})
	const footer = (): FlowMapFooter => ({
		label: props.map.footer.label,
		items: props.map.footer.items.map((item) => ({
			id: item.address,
			label: item.label,
			href: props.map.footer.documentId
				? `/d/${props.map.footer.documentId}/${item.address}`
				: undefined,
			icon: item.icon ? () => <img src={item.icon ?? ''} alt="" /> : undefined,
		})),
	})
	return (
		<FlowMap
			class={props.class}
			label="Steps of the Optimal Care Pathway"
			nodes={nodes()}
			edges={props.map.edges}
			rail={rail()}
			footer={footer()}
			caption={props.map.caption}
			currentId={props.currentStep ? `step-${props.currentStep}` : undefined}
			interactive={props.interactive ?? true}
		/>
	)
}

/** The pathway map's place in a body (the Steps section): the document's map, or a
 *  note when the template declares none. */
export function PathwayMapBlock() {
	const derived = useContext(DerivedContext)
	const at = useContext(MapContext)
	return (
		<div data-ocp="pathwayMap" class="ocp-pathway-map">
			<Show
				when={derived().map}
				fallback={
					<Notice colorBase="secondary" variant="outline" role="note">
						This document's template declares no steps map.
					</Notice>
				}
			>
				{(map) => <PathwayMap map={map()} currentStep={at().currentStep} />}
			</Show>
		</div>
	)
}

/** A citation's number; `joined` when the node before it is a citation too, so the two
 *  read "26,27" (a comma CSS cannot place: its sibling rules skip the text between). */
export function CitationInline(props: { referenceId: string; joined?: boolean }) {
	const derived = useContext(DerivedContext)
	const number = () => derived().referenceNumbers[props.referenceId]
	return (
		<sup
			data-ocp="citation"
			data-joined={props.joined ? 'true' : undefined}
			data-reference-id={props.referenceId}
			data-number={number() ? String(number()) : '?'}
			title={number() ? `Reference ${number()}` : 'Reference not in this document'}
		/>
	)
}

export function FootnoteInline(props: { text: string }) {
	return <sup data-ocp="footnote" data-text={props.text} title={props.text} />
}
