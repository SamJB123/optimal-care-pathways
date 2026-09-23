/**
 * A document as its readers get it: the published edition (/p/{slug}), or the draft as
 * publishing it now would give it (/d/{id}/preview). One frame for both, so the preview
 * is exactly what publishing gives: each section in reading order with its body rendered
 * by the site's own renderer, then the References numbered as the text cites them. A
 * draft is marked as one, on screen and on every printed page.
 */

import { Eyebrow } from '@aicolab/ui-solid'
import type { JSX } from '@solidjs/web'
import { children, For, Show } from 'solid-js'
import type { NumberedReference } from '#/api/published.ts'
import { type DerivedView, stepNumberOfAddress, timeframeRows } from '#/content/derived.ts'
import { ReferenceList } from '#/content/references.tsx'
import { RenderedBody } from '#/content/render.tsx'
import type { JsonNode } from '#/content/schema.ts'
import { numberLabel } from '#/lib/labels.ts'
import '#/routes/print.css'

export interface ReadingSection {
	address: string
	parentAddress: string | null
	printedNumber: string | null
	title: string | null
	ownership: 'shared' | 'owned'
	body: JsonNode | null
}

export interface ReadingModel {
	title: string
	/** "Version 2 · Second edition · 1 June 2021", or the draft's line. */
	editionLine: string
	releaseNotes: string | null
	sections: ReadingSection[]
	references: NumberedReference[]
}

/** Sections carry parent addresses; depth is how many ancestors a section has. */
function depthOf(address: string, parentOf: Map<string, string | null>): number {
	let depth = 0
	let parent = parentOf.get(address) ?? null
	while (parent !== null && depth < 6) {
		depth++
		parent = parentOf.get(parent) ?? null
	}
	return depth
}

export function ReadingDocument(props: {
	document: ReadingModel
	/** What stands above the title: "published", "draft preview". */
	eyebrow: string
	/** A draft: watermarked on screen and on every printed page. */
	draft?: boolean
	/** Under the head: the draft's banner. */
	banner?: JSX.Element
}) {
	// An element prop is a getter: resolved once, or hydration claims its nodes twice.
	const banner = children(() => props.banner)
	const parentOf = () => new Map(props.document.sections.map((s) => [s.address, s.parentAddress]))
	const derived = (): DerivedView => ({
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
	})
	return (
		<main class="ocp-published" data-draft={props.draft ? '' : undefined}>
			<Show when={props.draft}>
				<div class="ocp-watermark" aria-hidden="true">
					<span>Draft</span>
				</div>
			</Show>
			<header class="ocp-published-head">
				<Eyebrow>Optimal Care Pathways · {props.eyebrow}</Eyebrow>
				<h1>{props.document.title}</h1>
				<p class="ocp-published-meta">{props.document.editionLine}</p>
				<Show when={props.document.releaseNotes}>{(notes) => <p class="ocp-published-notes">{notes()}</p>}</Show>
				{banner()}
			</header>
			<For each={props.document.sections}>
				{(section) => (
					<section class="ocp-published-section" id={section.address} data-depth={depthOf(section.address, parentOf())} data-ownership={section.ownership}>
						<h2 class="ocp-published-title">
							<Show when={section.printedNumber}>{(n) => <span class="ocp-published-number">{numberLabel(n())} </span>}</Show>
							{section.title ?? section.address}
						</h2>
						<Show when={section.body}>{(body) => <RenderedBody body={body()} derived={derived()} />}</Show>
					</section>
				)}
			</For>
			<Show when={props.document.references.length > 0}>
				<section class="ocp-published-section ocp-published-references" id="references">
					<h2 class="ocp-published-title">References</h2>
					<ReferenceList references={props.document.references} />
				</section>
			</Show>
		</main>
	)
}
