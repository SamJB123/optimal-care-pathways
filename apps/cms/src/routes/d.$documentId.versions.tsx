/**
 * The edition imprint (decision 115), set like a printed pathway's imprint page: the
 * draft in work at the head, then every edition newest first with its label, date,
 * publisher, release notes and how many sections it changed, and where to read it.
 *
 * Below it, COMPARE ANY TWO: any two editions, or an edition against the draft. The
 * `from` and `to` search params are the comparison (so a comparison is a link), read by
 * the route's schema; the result lists every section that reads differently, grouped by
 * the spine's bands, each annotated from → to and painted as review mode paints a body,
 * with ONE marks/clean switch for the whole comparison.
 */

import { Chip, EmptyState, Field, Notice, Segmented, SelectControl } from '@aicolab/ui-solid'
import { createFileRoute, useNavigate } from '@tanstack/solid-router'
import { createMemo, createSignal, Errored, For, Loading, Show, useContext } from 'solid-js'
import { z } from 'zod'
import { RenderedBody } from '#/content/render.tsx'
import { changeSize, imprintDate } from '#/lib/labels.ts'
import { compareHref, editionHref, pdfHref, sectionHref } from '#/lib/links.ts'
import { type DiffView, DocumentContext, sectionLabel } from '#/lifecycle/workspace.ts'
import type {
	CompareEntry,
	CompareKind,
	Comparison,
	EditionEntry,
	EditionRef,
} from '#/server/editions.ts'
import { compareEditions, editionsOf } from '#/server/editions-fns.ts'
import './editions.css'

/** An edition by number, or the draft; anything else reads as not chosen. */
const editionRef = z
	.union([z.literal('draft'), z.coerce.number().int().min(1)])
	.optional()
	.catch(undefined)

export const Route = createFileRoute('/d/$documentId/versions')({
	validateSearch: z.object({ from: editionRef, to: editionRef }),
	loader: async ({ params }) => editionsOf({ data: { documentId: params.documentId } }),
	component: EditionsPage,
})

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** An edition as its imprint names it. */
const editionName = (e: Pick<EditionEntry, 'label' | 'versionNo'>): string =>
	e.label ?? `Edition ${e.versionNo}`

/** An edition in a picker: its label, with its number when the label does not say it. */
const optionName = (e: EditionEntry): string =>
	e.status === 'draft'
		? `Draft of edition ${e.versionNo}`
		: e.label
			? `${e.label} (edition ${e.versionNo})`
			: `Edition ${e.versionNo}`

const KIND_WORDS: Record<CompareKind, string> = {
	added: 'Added',
	removed: 'Removed',
	changed: 'Changed',
	hidden: 'Hidden',
	shown: 'Shown',
}
const KIND_ORDER: readonly CompareKind[] = ['changed', 'added', 'removed', 'hidden', 'shown']
const KIND_COLOUR: Record<CompareKind, 'success' | 'error' | 'primary' | 'warning' | 'info'> = {
	added: 'success',
	removed: 'error',
	changed: 'primary',
	hidden: 'warning',
	shown: 'info',
}

/** A refusal as the server worded it. */
const messageOf = (error: unknown): string =>
	error instanceof Error ? error.message : 'The comparison could not be read.'

/** Where the comparison sits, for the links that open one. */
const COMPARE_ID = 'compare'

function EditionsPage() {
	const workspace = useContext(DocumentContext)
	const editions = Route.useLoaderData()
	const navigate = useNavigate()
	const draft = createMemo(() => editions().find((e) => e.status === 'draft') ?? null)
	const published = createMemo(() => editions().find((e) => e.status === 'published') ?? null)
	const issued = createMemo(() => editions().filter((e) => e.status !== 'draft'))
	const firstNo = createMemo(() => issued().at(-1)?.versionNo ?? null)

	/** Open a comparison in place: the page stays, the search params move. */
	const openCompare = (from: EditionRef, to: EditionRef, scroll: boolean) => {
		void navigate({
			href: compareHref(workspace.documentId, from, to),
			replace: !scroll,
			resetScroll: false,
		}).then(() => {
			if (scroll)
				document.getElementById(COMPARE_ID)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
		})
	}
	/** A link to a comparison that also works opened in a new tab. */
	const compareLink = (from: EditionRef, to: EditionRef) => ({
		href: `${compareHref(workspace.documentId, from, to)}#${COMPARE_ID}`,
		onClick: (e: MouseEvent) => {
			if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
			e.preventDefault()
			openCompare(from, to, true)
		},
	})

	return (
		<div class="ocp-part ocp-editions">
			<header class="ocp-editions-head">
				<p class="ocp-editions-kicker">Imprint</p>
				<h1>Editions</h1>
			</header>

			<Show when={draft()}>
				{(d) => (
					<section class="ocp-editions-draft" aria-label="The draft in work">
						<h2>Drafting edition {d().versionNo}</h2>
						<p class="ocp-editions-facts">
							<span>Not published</span>
							<span>
								<Show
									when={published()}
									fallback={`${plural(d().changed, 'section')} written for the first edition`}
								>
									{(p) =>
										`${plural(d().changed, 'section')} changed since edition ${p().versionNo}`
									}
								</Show>
							</span>
						</p>
						<Show when={published()}>
							{(p) => (
								<p class="ocp-editions-links">
									<a {...compareLink(p().versionNo, 'draft')}>Compare with the published edition</a>
								</p>
							)}
						</Show>
					</section>
				)}
			</Show>

			<Show
				when={issued().length > 0}
				fallback={<p class="ocp-muted">Nothing has been published yet.</p>}
			>
				<ol class="ocp-editions-list">
					<For each={issued()}>
						{(edition) => (
							<li class="ocp-edition" data-status={edition.status}>
								<p class="ocp-editions-kicker">
									Edition {edition.versionNo}
									{edition.status === 'published' ? ' · Current' : ' · Archived'}
								</p>
								<h2>
									{editionName(edition)}
									<Show when={edition.publishedAt}>
										{(at) => <span class="ocp-edition-date"> · {imprintDate(at())}</span>}
									</Show>
								</h2>
								<Show when={edition.publisherName}>
									{(name) => <p class="ocp-editions-facts">Published by {name()}</p>}
								</Show>
								<Show when={edition.releaseNotes}>
									{(notes) => <p class="ocp-edition-notes">{notes()}</p>}
								</Show>
								<p class="ocp-editions-facts">
									{edition.versionNo === firstNo()
										? plural(edition.changed, 'section')
										: `${plural(edition.changed, 'section')} changed`}
								</p>
								<p class="ocp-editions-links">
									<a href={editionHref(workspace.document.slug, edition.versionNo)}>Read</a>
									<Show when={edition.status === 'published'}>
										<a href={pdfHref(workspace.document.slug)}>PDF</a>
									</Show>
									<a {...compareLink(edition.versionNo, 'draft')}>Compare with…</a>
								</p>
							</li>
						)}
					</For>
				</ol>
			</Show>

			<Show when={issued().length > 0}>
				<CompareTwo editions={editions()} />
			</Show>
		</div>
	)
}

/** The pickers and the comparison they choose. */
function CompareTwo(props: { editions: EditionEntry[] }) {
	const workspace = useContext(DocumentContext)
	const search = Route.useSearch()
	const navigate = useNavigate()
	const [view, setView] = createSignal<DiffView>('marks')

	const optionValue = (ref: EditionRef | undefined): string =>
		ref === undefined ? '' : String(ref)
	const refOf = (value: string): EditionRef | null =>
		value === 'draft' ? 'draft' : /^\d+$/.test(value) ? Number(value) : null
	/** The side not chosen yet, when the other is: the draft, or against the draft the
	 *  published edition. */
	const otherThan = (ref: EditionRef): EditionRef | null =>
		ref !== 'draft'
			? 'draft'
			: (props.editions.find((e) => e.status === 'published')?.versionNo ?? null)
	const choose = (side: 'from' | 'to', value: string) => {
		const ref = refOf(value)
		if (ref === null) return
		const other = side === 'from' ? search().to : search().from
		const pair = other ?? otherThan(ref)
		if (pair === null) return
		const [from, to] = side === 'from' ? [ref, pair] : [pair, ref]
		void navigate({
			href: compareHref(workspace.documentId, from, to),
			replace: true,
			resetScroll: false,
		})
	}

	const chosen = createMemo(() => {
		const { from, to } = search()
		return from !== undefined && to !== undefined ? { from, to } : null
	})
	const load = async (
		pair: { from: EditionRef; to: EditionRef } | null,
	): Promise<Comparison | null> =>
		pair && pair.from !== pair.to
			? compareEditions({
					data: { documentId: workspace.documentId, from: pair.from, to: pair.to },
				})
			: null
	const comparison = createMemo(() => load(chosen()))
	const key = () => `${chosen()?.from ?? ''}:${chosen()?.to ?? ''}`

	const picker = (side: 'from' | 'to', label: string) => (
		<Field label={label} class="ocp-compare-field">
			<SelectControl
				value={optionValue(search()[side])}
				onChange={(e) => choose(side, e.currentTarget.value)}
			>
				<option value="" disabled>
					Choose an edition
				</option>
				<For each={props.editions}>
					{(e) => (
						<option value={e.status === 'draft' ? 'draft' : String(e.versionNo)}>
							{optionName(e)}
						</option>
					)}
				</For>
			</SelectControl>
		</Field>
	)

	return (
		<section class="ocp-compare" id={COMPARE_ID} aria-labelledby="ocp-compare-title">
			<h2 id="ocp-compare-title">Compare two editions</h2>
			<div class="ocp-compare-pickers">
				{picker('from', 'From')}
				{picker('to', 'To')}
			</div>
			<Show
				when={chosen()}
				fallback={
					<p class="ocp-muted">
						Choose two editions, or an edition and the draft, to see every section that reads
						differently.
					</p>
				}
			>
				{(pair) => (
					<Show
						when={pair().from !== pair().to}
						fallback={
							<EmptyState
								title="The same edition on both sides"
								hint="Choose a different edition for From or To."
								pad="1.25rem"
							/>
						}
					>
						<Errored
							fallback={(error) => (
								<Notice colorBase="warning" class="ocp-compare-refusal">
									{messageOf(error())}
								</Notice>
							)}
						>
							<Loading on={key()} fallback={<p class="ocp-muted">Comparing…</p>}>
								<Show when={comparison()}>
									{(c) => <CompareResult comparison={c()} view={view()} onView={setView} />}
								</Show>
							</Loading>
						</Errored>
					</Show>
				)}
			</Show>
		</section>
	)
}

/** The totals, the switch, then every differing section by band. */
function CompareResult(props: {
	comparison: Comparison
	view: DiffView
	onView: (view: DiffView) => void
}) {
	const total = () => KIND_ORDER.reduce((n, kind) => n + props.comparison.totals[kind], 0)
	const breakdown = () =>
		KIND_ORDER.filter((kind) => props.comparison.totals[kind] > 0)
			.map((kind) => `${props.comparison.totals[kind]} ${KIND_WORDS[kind].toLowerCase()}`)
			.join(', ')
	const sideName = (side: Comparison['from']) =>
		side.publishedAt ? `${side.label} (${imprintDate(side.publishedAt)})` : side.label
	return (
		<Show
			when={total() > 0}
			fallback={
				<EmptyState
					title="No differences"
					hint={`Every section reads the same in ${props.comparison.from.label} and ${props.comparison.to.label}.`}
					pad="1.25rem"
				/>
			}
		>
			<div class="ocp-compare-result">
				<p class="ocp-compare-totals">
					From <strong>{sideName(props.comparison.from)}</strong> to{' '}
					<strong>{sideName(props.comparison.to)}</strong>: {plural(total(), 'section')}{' '}
					{total() === 1 ? 'reads' : 'read'} differently ({breakdown()}).
				</p>
				<Segmented
					label="Show changes"
					class="ocp-diff-switch"
					options={[
						{ id: 'marks', label: 'Changes marked' },
						{ id: 'clean', label: 'As it reads' },
					]}
					value={props.view}
					onChange={(view) => props.onView(view)}
				/>
				<div class={{ 'ocp-body-clean': props.view === 'clean' }}>
					<For each={props.comparison.groups}>
						{(group) => (
							<section class="ocp-compare-group" data-band={String(group.key)}>
								<h3>{group.label}</h3>
								<For each={group.entries}>
									{(entry) => (
										<CompareItem
											entry={entry}
											to={props.comparison.to.label}
											clean={props.view === 'clean'}
										/>
									)}
								</For>
							</section>
						)}
					</For>
				</div>
			</div>
		</Show>
	)
}

/** One section that reads differently: its heading into the workspace, what happened to
 *  it, and its body annotated. */
function CompareItem(props: { entry: CompareEntry; to: string; clean: boolean }) {
	const workspace = useContext(DocumentContext)
	const gone = () => props.entry.kind === 'removed' || props.entry.kind === 'hidden'
	return (
		<article class="ocp-compare-entry" data-kind={props.entry.kind}>
			<header class="ocp-compare-heading">
				<Show
					when={props.entry.part}
					fallback={<span class="ocp-compare-title">{sectionLabel(props.entry)}</span>}
				>
					{(part) => (
						<a
							class="ocp-compare-title"
							href={sectionHref(workspace.documentId, part(), props.entry.address)}
						>
							{sectionLabel(props.entry)}
						</a>
					)}
				</Show>
				<span class="ocp-compare-tags">
					<Chip colorBase={KIND_COLOUR[props.entry.kind]} variant="soft">
						{KIND_WORDS[props.entry.kind]}
					</Chip>
					<Show when={props.entry.kind === 'changed'}>
						<span class="ocp-compare-count">{changeSize(props.entry.annotated)}</span>
					</Show>
				</span>
			</header>
			<Show
				when={!(props.clean && gone())}
				fallback={
					<p class="ocp-muted">
						{props.entry.kind === 'hidden' ? `Hidden in ${props.to}.` : `Not in ${props.to}.`}
					</p>
				}
			>
				<RenderedBody
					body={props.entry.annotated.body}
					derived={workspace.derived}
					guidance={workspace.guidance}
				/>
			</Show>
		</article>
	)
}
