/**
 * A pathway or template as its readers get it — the published edition (/p/{slug}), an
 * earlier edition (/p/{slug}/v/{n}), or the draft as publishing it now would give it
 * (/d/{id}/preview) — in the reading frame, so a preview is exactly what publishing gives.
 * The spine is the document's own: its front matter's parts, Steps 1–7 by number, its back
 * matter, the References. Each part is a chapter (an h2), each of its sections an h3,
 * deeper ones h4; every heading carries the section's address as its id, so a link to a
 * section lands on it.
 */

import type { DocsNavItem } from '@aicolab/ui-solid'
import type { JSX } from '@solidjs/web'
import { createMemo, For, Show, useContext } from 'solid-js'
import type { NumberedReference } from '#/api/published.ts'
import { CitationInline, DerivedContext } from '#/content/blocks.tsx'
import { type DerivedView, stepNumberOfAddress, timeframeRows } from '#/content/derived.ts'
import { ReferenceList } from '#/content/references.tsx'
import { RenderedBody } from '#/content/render.tsx'
import type { JsonNode } from '#/content/schema.ts'
import { numberLabel } from '#/lib/labels.ts'
import { ReadingFrame } from './ReadingFrame.tsx'

export interface ReadingSection {
	address: string
	parentAddress: string | null
	printedNumber: string | null
	title: string | null
	titleCitations: string[]
	ownership: 'shared' | 'owned'
	body: JsonNode | null
}

export interface ReadingModel {
	title: string
	/** What the document is: "Cancer-specific pathway", "Core template". */
	kicker: string
	/** "Second edition · 1 June 2021", or the draft's line. */
	editionLine: string
	/** What changed in this edition. */
	releaseNotes: string | null
	sections: ReadingSection[]
	references: NumberedReference[]
}

/** How many ancestors a section has, by its parent's address. */
function depthOf(address: string, parentOf: Map<string, string | null>): number {
	let depth = 0
	let parent = parentOf.get(address) ?? null
	while (parent !== null && depth < 6) {
		depth++
		parent = parentOf.get(parent) ?? null
	}
	return depth
}

/** A top-level part's spine entry: its step number, or a quiet rule, and its words. */
function spineEntry(s: ReadingSection): DocsNavItem {
	const step = stepNumberOfAddress(s.address)
	const title = s.title ?? s.address
	// A step part's title repeats its number ("Step 4: Treatment"); the mark carries it.
	return { href: `#${s.address}`, mark: step !== null ? String(step) : '·', label: step !== null ? title.replace(/^Step\s+\d+\s*:\s*/i, '') : title }
}

export function ReadingDocument(props: {
	document: ReadingModel
	accent: string | null
	draft?: boolean
	links?: JSX.Element
	aside?: JSX.Element
}) {
	const parentOf = createMemo(() => new Map(props.document.sections.map((s) => [s.address, s.parentAddress])))
	const derived = createMemo(
		(): DerivedView => ({
			referenceNumbers: Object.fromEntries(props.document.references.map((r) => [r.id, r.number])),
			timeframes: timeframeRows(
				props.document.sections.map((s) => ({
					stepNumber: stepNumberOfAddress(s.address),
					address: s.address,
					printedNumber: s.printedNumber,
					title: s.title,
					body: s.body,
				})),
			),
			map: null,
		}),
	)
	const spine = createMemo((): DocsNavItem[] => [
		...props.document.sections.filter((s) => s.parentAddress === null).map(spineEntry),
		...(props.document.references.length > 0 ? [{ href: '#references', mark: '¶', label: 'References' }] : []),
	])
	return (
		<ReadingFrame
			accent={props.accent}
			nav={spine()}
			navLabel="The pathway"
			kicker={props.document.kicker}
			title={props.document.title}
			editionLine={props.document.editionLine}
			note={props.document.releaseNotes}
			links={props.links}
			aside={props.aside}
			draft={props.draft}
		>
			<DerivedContext value={derived}>
				<For each={props.document.sections}>{(section) => <ReadingSectionView section={section} depth={depthOf(section.address, parentOf())} />}</For>
				<Show when={props.document.references.length > 0}>
					<section class="ocp-published-section ocp-published-references" data-depth="0">
						<h2 class="ocp-published-title" id="references">
							References
						</h2>
						<ReferenceList references={props.document.references} />
					</section>
				</Show>
			</DerivedContext>
		</ReadingFrame>
	)
}

/** One section, its heading at the level its depth gives it. */
function ReadingSectionView(props: { section: ReadingSection; depth: number }) {
	const derived = useContext(DerivedContext)
	const content = () => (
		<>
			<Show when={props.section.printedNumber}>{(n) => <span class="ocp-published-number">{numberLabel(n())} </span>}</Show>
			{props.section.title ?? props.section.address}
			<Show when={props.section.titleCitations.length > 0}>
				<span class="ocp-published-citations">
					<For each={props.section.titleCitations}>{(id) => <CitationInline referenceId={id} />}</For>
				</span>
			</Show>
		</>
	)
	return (
		<section class="ocp-published-section" data-depth={props.depth} data-ownership={props.section.ownership}>
			<Show
				when={props.depth === 0}
				fallback={
					<Show
						when={props.depth === 1}
						fallback={
							<h4 class="ocp-published-title" id={props.section.address}>
								{content()}
							</h4>
						}
					>
						<h3 class="ocp-published-title" id={props.section.address}>
							{content()}
						</h3>
					</Show>
				}
			>
				<h2 class="ocp-published-title" id={props.section.address}>
					{content()}
				</h2>
			</Show>
			<Show when={props.section.body}>{(body) => <RenderedBody body={body()} derived={derived()} />}</Show>
		</section>
	)
}
