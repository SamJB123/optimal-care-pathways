/**
 * The fidelity review page (decisions 39, 55, S17): a core document read against the
 * template PDF it was extracted from. Central members only. Three parts, on ui-solid's
 * WorkspaceShell:
 *
 * - the SPINE: the document's sections in outline order, grouped as the template is
 *   (front matter, Steps 1–7, back matter), the one being read marked; a click takes
 *   the reader there;
 * - the TEXT: every section rendered from its stored body, in reading order;
 * - the SOURCE: the template page(s) of the section at the READING LINE — a third of
 *   the way down the screen, below the masthead — held in view, so text and source sit
 *   side by side as the page scrolls.
 *
 * On a phone: one column, each section followed by its page(s) behind a disclosure, and
 * a jump select in place of the spine. Pages draw as they come into view (or open),
 * never all at once; `?eager` draws each the moment it mounts (for automated
 * screenshots), which with the source following the reading line is the pages it shows.
 */

import {
	AccordionItem,
	Notice,
	SelectControl,
	WorkspaceNavigation,
	WorkspaceNavigationGroup,
	WorkspaceNavigationItem,
	WorkspaceShell,
	WorkspaceStage,
} from '@aicolab/ui-solid'
import { createFileRoute } from '@tanstack/solid-router'
import { createEffect, createMemo, createSignal, For, onSettled, Show } from 'solid-js'
import { CitationInline, DerivedContext } from '#/content/blocks.tsx'
import { RenderedBody } from '#/content/render.tsx'
import { PdfPages, pageRange } from '#/editors/PdfPages.tsx'
import { familyStyle } from '#/lib/family.ts'
import { numberLabel } from '#/lib/labels.ts'
import { bandLabel, spineOf } from '#/lib/outline.ts'
import { Masthead } from '#/components/Masthead.tsx'
import { type ReviewSectionRow, reviewSnapshot } from '#/server/documents.ts'
import './review.css'

export const Route = createFileRoute('/review/$documentId')({
	loader: async ({ params }) => reviewSnapshot({ data: { documentId: params.documentId } }),
	validateSearch: (search: Record<string, unknown>): { eager?: boolean } => ({
		eager:
			search.eager === true || search.eager === 'true' || search.eager === '' || search.eager === 1,
	}),
	component: ReviewPage,
})

/** The resolution a page is drawn at, in CSS pixels across; the stylesheet sizes it. */
const PAGE_WIDTH = 620

const anchorOf = (address: string) => `s-${address.replace(/[^a-z0-9]+/gi, '-')}`

/** A section as the spine and the source column name it: "1.1.2 Risk reduction strategies". */
const sectionLabel = (row: ReviewSectionRow): string =>
	[row.printedNumber ? numberLabel(row.printedNumber) : null, row.title ?? row.address].filter(Boolean).join(' ')

/** "p.13", or "pp.13–14". */
const pagesLabel = (pages: readonly number[]): string =>
	pages.length === 0 ? '' : pages.length === 1 ? `p.${pages[0]}` : `pp.${pages[0]}–${pages.at(-1)}`

const samePages = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((p, i) => p === b[i])

function ReviewPage() {
	const data = Route.useLoaderData()
	const search = Route.useSearch()
	const eager = () => search().eager ?? false
	const pdfUrl = () => `/template-sources/${data().sourceFile}`
	// The contents list is the PDF's own furniture, not a section to check (at the top of
	// a template, or inside its first part).
	const bands = createMemo(() =>
		spineOf(data().sections, (s) => s.address.split('/').at(-1) !== 'contents').filter((band) => band.sections.length > 0),
	)
	const rows = createMemo(() => bands().flatMap((band) => band.sections))
	const depthOf = createMemo(() => {
		const byId = new Map(data().sections.map((s) => [s.id, s]))
		const depth = (s: ReviewSectionRow): number => {
			let n = 0
			for (let at = s.parentId ? byId.get(s.parentId) : undefined; at; at = at.parentId ? byId.get(at.parentId) : undefined) n++
			return n
		}
		return new Map(data().sections.map((s) => [s.id, depth(s)]))
	})

	/** The section at the reading line; before the first heading reaches it, the first. */
	const [reading, setReading] = createSignal<string | null>(null)
	const current = createMemo(() => rows().find((r) => r.id === reading()) ?? rows()[0] ?? null)
	const pages = createMemo(() => pageRange(current()?.sourcePages ?? null), { equals: samePages })

	let shell: HTMLDivElement | undefined
	let source: HTMLElement | undefined
	/** After a jump the section chosen stays the one being read — a short one would
	 *  otherwise hand the line to the next — until the reader moves the page themselves
	 *  (the page's own settling as sections draw in is not the reader). */
	let held = false
	/** What the page holds in place while the sections around it draw in at their real
	 *  height (content-visibility): a jump's heading, or what the keyboard moved to. Held
	 *  until the reader moves the page themselves, as `held` is. */
	let kept: { element: HTMLElement; top: number } | null = null
	const keep = (element: HTMLElement) => {
		kept = { element, top: element.getBoundingClientRect().top }
	}

	const go = (row: ReviewSectionRow) => {
		const heading = document.getElementById(anchorOf(row.address))
		if (heading) {
			heading.scrollIntoView({ block: 'start' })
			keep(heading)
		}
		held = true
		setReading(row.id)
	}

	onSettled(() => {
		// The reading line: whichever section's top most recently passed it, read once a
		// frame while the page scrolls.
		let frame = 0
		const pick = () => {
			frame = 0
			if (!shell) return
			if (held) return
			const mast = document.querySelector('.ocp-mast')?.getBoundingClientRect().bottom ?? 0
			const line = mast + (window.innerHeight - mast) / 3
			let at: string | null = null
			for (const el of shell.querySelectorAll<HTMLElement>('.ocp-review-section')) {
				if (el.getBoundingClientRect().top <= line) at = el.dataset.sectionId ?? null
				else break
			}
			setReading(at)
		}
		const schedule = () => {
			if (!frame) frame = requestAnimationFrame(pick)
		}
		const release = () => {
			held = false
			kept = null
		}
		// Tab moves focus after its keydown has released the page: what it lands on is kept.
		const keepFocus = (event: FocusEvent) => {
			if (event.target instanceof HTMLElement && event.target.matches(':focus-visible')) keep(event.target)
		}
		const text = shell?.querySelector('.ocp-review-text')
		const settling = new ResizeObserver(() => {
			if (!kept?.element.isConnected) return
			const moved = kept.element.getBoundingClientRect().top - kept.top
			if (Math.abs(moved) >= 1) window.scrollBy(0, moved)
		})
		if (text) settling.observe(text)
		// Arriving at #section from a link: take the reader there.
		const arriving = location.hash ? document.getElementById(location.hash.slice(1)) : null
		if (arriving) {
			arriving.scrollIntoView({ block: 'start' })
			keep(arriving)
		}
		pick()
		window.addEventListener('scroll', schedule, { passive: true })
		window.addEventListener('resize', schedule)
		shell?.addEventListener('focusin', keepFocus)
		const moves = ['wheel', 'touchstart', 'keydown', 'mousedown']
		for (const type of moves) window.addEventListener(type, release, { passive: true, capture: true })
		return () => {
			cancelAnimationFrame(frame)
			settling.disconnect()
			window.removeEventListener('scroll', schedule)
			window.removeEventListener('resize', schedule)
			shell?.removeEventListener('focusin', keepFocus)
			for (const type of moves) window.removeEventListener(type, release, { capture: true })
		}
	})

	// The spine keeps the section being read in view; the source starts each new page at
	// its top.
	createEffect(
		() => current()?.id ?? null,
		() => {
			const nav = shell?.querySelector<HTMLElement>('.ocp-review-spine')
			const item = nav?.querySelector<HTMLElement>('.ui-rich-list-item[data-selected]')
			if (!nav || !item) return
			const top = item.getBoundingClientRect().top - nav.getBoundingClientRect().top
			if (top < 0 || top + item.offsetHeight > nav.clientHeight) nav.scrollTop += top - nav.clientHeight / 3
		},
	)
	createEffect(pages, () => {
		if (source) source.scrollTop = 0
	})

	return (
		<>
			<Masthead crumbs={[{ label: 'Pathways', href: '/' }, { label: data().document.title, href: `/d/${data().document.id}` }, { label: 'Against the template' }]} central />
			<div class="ocp-review-page" style={familyStyle(data().document.accent)} ref={shell}>
				<WorkspaceShell
					class="ocp-review"
					navigation={
						<WorkspaceNavigation label="Sections" class="ocp-review-spine">
							<For each={bands()}>
								{(band) => (
									<WorkspaceNavigationGroup id={`ocp-review-band-${band.band}`} label={bandLabel(band.band)}>
										<For each={band.sections}>
											{(row) => (
												<WorkspaceNavigationItem
													label={sectionLabel(row)}
													current={current()?.id === row.id}
													class={`ocp-review-spine-depth-${Math.min(depthOf().get(row.id) ?? 0, 3)}`}
													onSelect={() => go(row)}
												/>
											)}
										</For>
									</WorkspaceNavigationGroup>
								)}
							</For>
						</WorkspaceNavigation>
					}
					stage={
						<WorkspaceStage label={data().document.title} class="ocp-review-stage">
							<div class="ocp-review-text">
								<header class="ocp-review-header">
									<h1>{data().document.title}</h1>
									<p>
										Each section as the CMS holds it, beside the page it was extracted from in{' '}
										<code>{data().sourceFile}</code>
										{data().pageCount ? ` (${data().pageCount} pages)` : ''}.
									</p>
								</header>
								<SelectControl
									class="ocp-review-jump"
									aria-label="Go to a section"
									value={current()?.id ?? ''}
									onChange={(e) => {
										const row = rows().find((r) => r.id === e.currentTarget.value)
										if (row) go(row)
									}}
								>
									<For each={bands()}>
										{(band) => (
											<optgroup label={bandLabel(band.band)}>
												<For each={band.sections}>
													{(row) => <option value={row.id}>{sectionLabel(row)}</option>}
												</For>
											</optgroup>
										)}
									</For>
								</SelectControl>
								<Show when={rows().length > 0} fallback={<Notice colorBase="info">No sections.</Notice>}>
									<For each={rows()}>
										{(row) => (
											<ReviewSection
												row={row}
												depth={depthOf().get(row.id) ?? 0}
												reading={current()?.id === row.id}
												pdfUrl={pdfUrl()}
												eager={eager()}
											/>
										)}
									</For>
								</Show>
							</div>
						</WorkspaceStage>
					}
					inspector={
						<aside class="ocp-review-source" aria-label="Template pages" ref={source}>
							<p class="ocp-review-source-caption">
								<Show when={current()}>{(row) => <span class="ocp-review-source-of">{sectionLabel(row())}</span>}</Show>
								<span class="ocp-review-source-pages">{pagesLabel(pages())}</span>
							</p>
							<Show when={pages().length > 0} fallback={<p class="ocp-muted">No template page is recorded for this section.</p>}>
								<PdfPages url={pdfUrl()} pages={pages()} width={PAGE_WIDTH} eager={eager()} />
							</Show>
						</aside>
					}
				/>
			</div>
		</>
	)
}

/** One section as the CMS holds it: its heading (carrying the anchor), its rendered body,
 *  and — on a phone — its template page(s) behind a disclosure. */
function ReviewSection(props: { row: ReviewSectionRow; depth: number; reading: boolean; pdfUrl: string; eager: boolean }) {
	const data = Route.useLoaderData()
	const pages = () => pageRange(props.row.sourcePages)
	const meta = () =>
		[props.row.pathwayOwnership, props.row.apparatus ? 'apparatus' : null, pagesLabel(pages())].filter(Boolean).join(' · ')
	return (
		<article
			class="ocp-review-section"
			data-section-id={props.row.id}
			data-address={props.row.address}
			data-pages={props.row.sourcePages ?? ''}
			data-depth={Math.min(props.depth, 3)}
			data-reading={props.reading ? '' : undefined}
		>
			<header class="ocp-review-section-heading">
				<h2 id={anchorOf(props.row.address)}>
					<Show when={props.row.printedNumber}>{(n) => <span class="ocp-review-number">{numberLabel(n())} </span>}</Show>
					{props.row.title ?? ''}
					<Show when={props.row.titleCitations.length > 0}>
						<DerivedContext value={() => data().derived}>
							<For each={props.row.titleCitations}>{(id) => <CitationInline referenceId={id} />}</For>
						</DerivedContext>
					</Show>
				</h2>
				<span class="ocp-review-meta">
					<span class="ocp-review-address">{props.row.address}</span>
					<Show when={meta()}>
						<span>{meta()}</span>
					</Show>
				</span>
			</header>
			<Show when={props.row.body} fallback={<p class="ocp-section-empty">No body.</p>}>
				{(body) => <RenderedBody body={body()} derived={data().derived} />}
			</Show>
			<Show when={pages().length > 0}>
				<SourceDisclosure url={props.pdfUrl} pages={pages()} eager={props.eager} />
			</Show>
		</article>
	)
}

/** A section's template page(s) behind a disclosure (the phone's one column). The pages
 *  mount only once it is opened, so a closed disclosure draws nothing. */
function SourceDisclosure(props: { url: string; pages: number[]; eager: boolean }) {
	const [open, setOpen] = createSignal(false)
	return (
		<AccordionItem
			class="ocp-review-disclosure"
			summary={`Show the template page${props.pages.length > 1 ? 's' : ''} (${pagesLabel(props.pages)})`}
			onToggle={(e) => setOpen(e.currentTarget.open)}
		>
			<Show when={open()}>
				<PdfPages url={props.url} pages={props.pages} width={PAGE_WIDTH} eager={props.eager} />
			</Show>
		</AccordionItem>
	)
}
