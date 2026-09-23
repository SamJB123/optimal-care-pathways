/**
 * The atlas (decisions U1, U11, U20): every document the reader can see, one row each,
 * against the seven-step spine — front matter, Steps 1–7, back matter — with a tick per
 * section saying where it stands. Grouped (cancer-specific, population, then the core
 * templates as the foundation rows) and A–Z within a group; re-sortable by the most or
 * the most recently changed, the rows moving to their new places (an element-scoped view
 * transition) rather than jumping. A band's hover card lists its sections, when each
 * changed and by whom; a click opens that part of the document.
 *
 * The hover card is ONE popover shared by every band. Where the browser has `interestfor`
 * the bands declare it and the browser opens the card on hover, focus or long-press; where
 * it does not, pointer and focus handlers open the same card, anchored to the band.
 */

import { Button, withScopedViewTransition } from '@aicolab/ui-solid'
import { createMemo, createSignal, For, onSettled, Show } from 'solid-js'
import { familyStyle } from '#/lib/family.ts'
import { ago, monthDate } from '#/lib/labels.ts'
import { guideHref, partHref, pdfHref, publishedHref, sectionHref, workspaceHref } from '#/lib/links.ts'
import { bandFrom, bandLabel, type SpineBand } from '#/lib/outline.ts'
import { type AtlasCellSection, type AtlasRow, type AtlasSnapshot, atlasCell } from '#/server/atlas.ts'
import { TickKey, TickRuns, Ticks, ticksSummary } from './Ticks.tsx'
import './atlas.css'

type Sort = 'name' | 'changed' | 'recent'
type Filter = 'all' | 'review' | 'changed' | 'unpublished' | 'pending'

const GROUPS: { key: string; label: string; test: (row: AtlasRow) => boolean }[] = [
	{ key: 'cancer', label: 'Cancer-specific pathways', test: (r) => r.kind === 'pathway' && r.audience === 'cancer' },
	{ key: 'population', label: 'Population pathways', test: (r) => r.kind === 'pathway' && r.audience === 'population' },
	{ key: 'core', label: 'Core templates', test: (r) => r.kind === 'core' },
]

const FILTERS: { key: Filter; label: string; test: (row: AtlasRow) => boolean }[] = [
	{ key: 'all', label: 'Everything', test: () => true },
	{ key: 'review', label: 'In review', test: (r) => r.review !== null && r.review.decision === null },
	{ key: 'changed', label: 'Changed in the draft', test: (r) => r.draft.changed > 0 },
	{ key: 'unpublished', label: 'Not yet published', test: (r) => r.published === null },
	{ key: 'pending', label: 'Awaiting an organisation', test: (r) => r.pending },
]

const CARD_ID = 'ocp-atlas-card'

/** The document's standing in one line. */
function standing(row: AtlasRow): string {
	if (row.pending) return 'Awaiting its organisation'
	const r = row.review
	if (r && r.decision === null) return `In review, ${r.decided} of ${r.total} decided`
	if (r?.decision === 'approved') return 'Review approved'
	if (r?.decision === 'changes_requested') return 'Changes asked for'
	if (row.draft.changed === 0) return 'Nothing changed since publishing'
	return `${row.draft.changed} of ${row.draft.sections} sections changed`
}

function edition(row: AtlasRow): string {
	const p = row.published
	if (!p) return 'Not yet published'
	return `${p.label ?? `Edition ${p.versionNo}`}${p.publishedAt ? ` · ${monthDate(p.publishedAt)}` : ''}`
}

/** The register's columns: each spine band as wide as its densest run needs (two pixels a
 *  tick), shared out in proportion, so the steps keep the shape the documents have. */
function columnsFor(rows: readonly AtlasRow[]): string {
	const most = (i: number) => Math.max(4, ...rows.map((r) => r.bands[i]?.ticks.length ?? 0))
	const bands = Array.from({ length: 9 }, (_, i) => `minmax(${most(i) * 2 + 6}px, ${most(i)}fr)`)
	return ['[name] minmax(10rem, 150fr)', ...bands, '[state] minmax(10rem, 140fr)', '[last] minmax(6.5rem, 90fr)', '[links] max-content'].join(' ')
}

/** A view-transition name for a row: stable, and a valid identifier. */
const rowName = (id: string) => `ocp-row-${id.replace(/[^a-z0-9-]/gi, '')}`

export function Atlas(props: { snapshot: AtlasSnapshot; onNew?: () => void }) {
	const [sort, setSort] = createSignal<Sort>('name')
	const [filter, setFilter] = createSignal<Filter>('all')
	const [query, setQuery] = createSignal('')
	const [now, setNow] = createSignal(0)
	let grid: HTMLDivElement | undefined
	let card: HTMLDivElement | undefined

	onSettled(() => {
		setNow(Date.now())
		const tick = setInterval(() => setNow(Date.now()), 60_000)
		return () => clearInterval(tick)
	})
	// Relative times read against the server's clock until the page is live.
	const clock = () => now() || props.snapshot.now

	const visible = createMemo(() => {
		const q = query().trim().toLowerCase()
		const test = FILTERS.find((f) => f.key === filter())?.test ?? (() => true)
		return props.snapshot.rows.filter(
			(r) => test(r) && (!q || [r.name, r.title, r.subject, r.slug].some((s) => s.toLowerCase().includes(q))),
		)
	})

	const ordered = (rows: AtlasRow[]): AtlasRow[] =>
		[...rows].sort((a, b) => {
			if (sort() === 'changed') return b.draft.changed - a.draft.changed || a.name.localeCompare(b.name)
			if (sort() === 'recent') return (b.lastChange?.at ?? 0) - (a.lastChange?.at ?? 0) || a.name.localeCompare(b.name)
			return a.name.localeCompare(b.name, 'en-AU')
		})

	const groups = createMemo(() =>
		GROUPS.map((g) => ({ ...g, rows: ordered(visible().filter(g.test)) })).filter((g) => g.rows.length > 0),
	)

	const moving = (update: () => void) => withScopedViewTransition(grid, update)

	// ---- the hover card -------------------------------------------------------------
	const [cardFor, setCardFor] = createSignal<{ row: AtlasRow; band: SpineBand } | null>(null)
	const [cardSections, setCardSections] = createSignal<AtlasCellSection[] | null>(null)
	const cache = new Map<string, AtlasCellSection[]>()
	const declarative = () => typeof HTMLAnchorElement !== 'undefined' && 'interestForElement' in HTMLAnchorElement.prototype
	let pending: ReturnType<typeof setTimeout> | undefined

	/** The card sits against the band it is about: that band carries the anchor name. */
	const anchorTo = (source: HTMLElement) => {
		for (const el of grid?.querySelectorAll<HTMLElement>('[data-anchor]') ?? []) {
			el.style.removeProperty('anchor-name')
			delete el.dataset.anchor
		}
		source.style.setProperty('anchor-name', '--ocp-atlas-band')
		source.dataset.anchor = ''
	}

	const show = (source: HTMLElement) => {
		anchorTo(source)
		const rowId = source.dataset.row
		const bandKey = source.dataset.band
		const row = props.snapshot.rows.find((r) => r.id === rowId)
		const band = bandKey ? bandFrom(bandKey) : null
		if (!row || band === null) return
		setCardFor({ row, band })
		const key = `${row.id}:${bandKey}`
		const known = cache.get(key)
		setCardSections(known ?? null)
		if (!known)
			void atlasCell({ data: { documentId: row.id, band } }).then((sections) => {
				cache.set(key, sections)
				if (cardFor()?.row.id === row.id && cardFor()?.band === band) setCardSections(sections)
			})
	}

	const openFallback = (source: HTMLElement) => {
		if (declarative() || !card) return
		clearTimeout(pending)
		pending = setTimeout(() => {
			if (!card) return
			show(source)
			if (!card.matches(':popover-open')) card.showPopover()
		}, 350)
	}
	const closeFallback = () => {
		if (declarative()) return
		clearTimeout(pending)
		pending = setTimeout(() => card?.hidePopover(), 250)
	}

	return (
		<section class="ocp-atlas" aria-labelledby="ocp-atlas-title">
			<header class="ocp-atlas-head">
				<div class="ocp-atlas-heading">
					<h1 id="ocp-atlas-title">Pathways</h1>
					<p class="ocp-atlas-summary ocp-figure">
						{props.snapshot.rows.filter((r) => r.kind === 'pathway').length} pathways
						{' · '}
						{props.snapshot.rows.filter((r) => r.draft.changed > 0).length} changed in the draft
						{' · '}
						{props.snapshot.rows.filter((r) => r.review && r.review.decision === null).length} in review
					</p>
				</div>
				<div class="ocp-atlas-tools">
					<label class="ocp-atlas-search">
						<span class="ocp-visually-hidden">Find a pathway</span>
						<input
							type="search"
							placeholder="Find a pathway"
							value={query()}
							onInput={(e) => {
								const value = e.currentTarget.value
								moving(() => setQuery(value))
							}}
						/>
					</label>
					<label class="ocp-atlas-select">
						<span>Show</span>
						<select
							onChange={(e) => {
								const value = FILTERS.find((f) => f.key === e.currentTarget.value)?.key ?? 'all'
								moving(() => setFilter(value))
							}}
						>
							<For each={FILTERS}>{(f) => <option value={f.key} selected={filter() === f.key}>{f.label}</option>}</For>
						</select>
					</label>
					<label class="ocp-atlas-select">
						<span>Order</span>
						<select
							onChange={(e) => {
								const value: Sort = e.currentTarget.value === 'changed' ? 'changed' : e.currentTarget.value === 'recent' ? 'recent' : 'name'
								moving(() => setSort(value))
							}}
						>
							<option value="name" selected={sort() === 'name'}>A to Z</option>
							<option value="changed" selected={sort() === 'changed'}>Most changed</option>
							<option value="recent" selected={sort() === 'recent'}>Last changed</option>
						</select>
					</label>
					<Show when={props.onNew}>
						{(onNew) => (
							<Button variant="solid" onClick={() => onNew()()}>
								New pathway
							</Button>
						)}
					</Show>
				</div>
				<TickKey />
			</header>

			<div
				class="ocp-atlas-grid"
				role="table"
				aria-label="Pathways against the seven steps"
				ref={grid}
				style={{ 'grid-template-columns': columnsFor(props.snapshot.rows) }}
			>
				<div class="ocp-atlas-columns" role="row">
					<span role="columnheader" class="ocp-atlas-col-name">
						Document
					</span>
					<For each={['front', 1, 2, 3, 4, 5, 6, 7, 'back'] as const}>
						{(band) => (
							<span role="columnheader" class="ocp-atlas-col-band" data-band={band} title={bandLabel(band)}>
								{band === 'front' ? 'Front' : band === 'back' ? 'Back' : band}
							</span>
						)}
					</For>
					<span role="columnheader" class="ocp-atlas-col-state">
						Where it stands
					</span>
					<span role="columnheader" class="ocp-atlas-col-last">
						Last change
					</span>
					<span role="columnheader" class="ocp-atlas-col-links">
						<span class="ocp-visually-hidden">Published</span>
					</span>
				</div>
				<Show
					when={groups().length > 0}
					fallback={
						<p class="ocp-atlas-empty" role="row">
							<span role="cell">No document matches. Clear the search or choose Everything.</span>
						</p>
					}
				>
					<For each={groups()}>
						{(group) => (
							<div role="rowgroup" class="ocp-atlas-group" data-group={group.key}>
								<h2 class="ocp-atlas-group-title" role="row">
									<span role="rowheader">
										{group.label} <span class="ocp-figure ocp-muted">{group.rows.length}</span>
									</span>
								</h2>
								<For each={group.rows}>
									{(row) => (
										<div
											class="ocp-atlas-row"
											role="row"
											data-pending={row.pending ? '' : undefined}
											style={{
												...familyStyle(row.accent),
												'view-transition-name': rowName(row.id),
												// On a phone the nine bands share one strip, each as wide as its sections.
												'--strip': row.bands.map((b) => `minmax(0, ${Math.max(1, b.ticks.length)}fr)`).join(' '),
											}}
										>
											<span role="rowheader" class="ocp-atlas-name">
												<a href={workspaceHref(row.id)} title={row.title} style={{ 'view-transition-name': `ocp-name-${row.slug}` }}>
													{row.name}
												</a>
											</span>
											<For each={row.bands}>
												{(band) => (
													<span role="cell" class="ocp-atlas-band">
														<Show when={band.ticks.length > 0} fallback={<span class="ocp-atlas-band-none" />}>
															<a
																href={band.part ? partHref(row.id, band.part) : workspaceHref(row.id)}
																data-row={row.id}
																data-band={String(band.band)}
																interestfor={CARD_ID}
																aria-label={`${row.name}, ${bandLabel(band.band)}: ${ticksSummary(band.ticks)}`}
																onPointerEnter={(e) => openFallback(e.currentTarget)}
																onPointerLeave={closeFallback}
																onFocus={(e) => openFallback(e.currentTarget)}
																onBlur={closeFallback}
															>
																<Ticks ticks={band.ticks} />
																<TickRuns ticks={band.ticks} />
															</a>
														</Show>
													</span>
												)}
											</For>
											<span role="cell" class="ocp-atlas-state">
												<span class="ocp-atlas-edition">{edition(row)}</span>
												<span class="ocp-atlas-standing">{standing(row)}</span>
											</span>
											<span role="cell" class="ocp-atlas-last">
												<Show when={row.lastChange} fallback={<span class="ocp-muted">No edits yet</span>}>
													{(last) => (
														<>
															<span class="ocp-figure">{ago(last().at, clock())}</span>
															<Show when={last().by}>{(by) => <span class="ocp-muted"> · {by()}</span>}</Show>
														</>
													)}
												</Show>
											</span>
											<span role="cell" class="ocp-atlas-links">
												<Show when={row.published}>
													<a href={publishedHref(row.slug)}>Read</a>
													<Show when={row.kind === 'pathway'}>
														<a href={guideHref(row.slug)}>Guide</a>
													</Show>
													<a href={pdfHref(row.slug)}>PDF</a>
												</Show>
											</span>
										</div>
									)}
								</For>
							</div>
						)}
					</For>
				</Show>
			</div>

			<div
				id={CARD_ID}
				popover="hint"
				class="ocp-atlas-card"
				ref={(el) => {
					card = el
					el.addEventListener('interest', (event) => {
						const source = 'source' in event && event.source instanceof HTMLElement ? event.source : null
						if (source) show(source)
					})
				}}
				onPointerEnter={() => clearTimeout(pending)}
				onPointerLeave={closeFallback}
				style={familyStyle(cardFor()?.row.accent)}
			>
				<Show when={cardFor()}>
					{(at) => (
						<>
							<p class="ocp-atlas-card-head">
								<strong>{at().row.name}</strong> · {bandLabel(at().band)}
							</p>
							<Show when={cardSections()} fallback={<p class="ocp-muted">Reading the sections…</p>}>
								{(sections) => (
									<ol class="ocp-atlas-card-list">
										<For each={sections()}>
											{(s) => (
												<li data-s={s.state}>
													<Ticks ticks={[s.state]} />
													<a href={sectionHref(at().row.id, s.part, s.address)}>{s.label}</a>
													<span class="ocp-muted ocp-figure">
														{s.updatedAt ? ago(s.updatedAt, clock()) : ''}
														{s.by ? ` · ${s.by}` : ''}
													</span>
												</li>
											)}
										</For>
									</ol>
								)}
							</Show>
						</>
					)}
				</Show>
			</div>
		</section>
	)
}
