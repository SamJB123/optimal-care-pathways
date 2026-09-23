/**
 * /p/{slug}/quick-reference-guide — the derived quick reference guide of a published
 * document (decisions 4, 28, 152, S7): the sections flagged for use at point of care in
 * reading order, arranged by step, then the point-of-care check lists found in the rest
 * of the pathway, each with the section it belongs to. In the reading frame with the
 * pathway's colour: its spine is the steps the guide covers. The same derivation the API
 * serves; Browser Run prints this page to the guide's PDF. Public: published content only.
 */

import { type DocsNavItem, Notice } from '@aicolab/ui-solid'
import { createFileRoute } from '@tanstack/solid-router'
import { createMemo, For, Show } from 'solid-js'
import { publishedGuide } from '#/api/server-fns.ts'
import { Masthead } from '#/components/Masthead.tsx'
import type { DerivedView } from '#/content/derived.ts'
import { ReferenceList } from '#/content/references.tsx'
import { RenderedBody } from '#/content/render.tsx'
import { imprintDate, numberLabel } from '#/lib/labels.ts'
import { guidePdfHref, publishedHref } from '#/lib/links.ts'
import { CopyLink, ReadingFrame } from '#/published/ReadingFrame.tsx'

export const Route = createFileRoute('/p/$slug_/quick-reference-guide')({
	loader: async ({ params }) => {
		try {
			return { guide: await publishedGuide({ data: { slug: params.slug } }), error: null }
		} catch (error) {
			return { guide: null, error: error instanceof Error ? error.message : String(error) }
		}
	},
	component: GuidePage,
})

type Guide = NonNullable<Awaited<ReturnType<typeof publishedGuide>>>

/** A step's chapter id in the guide. */
const stepAnchor = (address: string) => `step-${address}`

function GuidePage() {
	const data = Route.useLoaderData()
	return (
		<>
			<Masthead
				crumbs={[
					{ label: 'Published library', href: '/library' },
					{
						label: data().guide?.document.title ?? 'Not found',
						href: data().guide ? publishedHref(data().guide?.document.slug ?? '') : undefined,
						accent: data().guide?.accent ?? null,
					},
					{ label: 'Quick reference guide' },
				]}
			/>
			<Show
				when={data().guide}
				fallback={
					<main class="ocp-published">
						<Notice colorBase="info" variant="soft">
							{data().error ?? 'This document has no published version.'}
						</Notice>
					</main>
				}
			>
				{(guide) => <GuideReading guide={guide()} />}
			</Show>
		</>
	)
}

function GuideReading(props: { guide: Guide }) {
	const derived = createMemo(
		(): DerivedView => ({
			referenceNumbers: Object.fromEntries(props.guide.references.map((r) => [r.id, r.number])),
			timeframes: [],
			map: null,
		}),
	)
	/** The guide's sections in runs, one per step. */
	const runs = createMemo(() => {
		const out: {
			step: { address: string; title: string | null } | null
			sections: Guide['sections']
		}[] = []
		for (const section of props.guide.sections) {
			const last = out.at(-1)
			if (last && last.step?.address === section.step?.address) last.sections.push(section)
			else out.push({ step: section.step, sections: [section] })
		}
		return out
	})
	const spine = createMemo((): DocsNavItem[] => [
		...runs().flatMap((run) =>
			run.step
				? [
						{
							href: `#${stepAnchor(run.step.address)}`,
							mark: run.step.address,
							label:
								run.step.title?.replace(/^Step\s+\d+\s*:\s*/i, '') ?? `Step ${run.step.address}`,
						},
					]
				: [],
		),
		...(props.guide.items.length > 0
			? [{ href: '#point-of-care-checklists', mark: '✓', label: 'Checklists from the pathway' }]
			: []),
		...(props.guide.references.length > 0
			? [{ href: '#references', mark: '¶', label: 'References' }]
			: []),
	])
	const doc = () => props.guide.document
	return (
		<ReadingFrame
			class="ocp-reading-guide"
			accent={props.guide.accent}
			nav={spine()}
			navLabel="The guide"
			kicker="Quick reference guide"
			title={doc().title}
			editionLine={[
				doc().label ?? `Edition ${doc().version}`,
				doc().publishedAt ? imprintDate(Date.parse(doc().publishedAt ?? '')) : null,
			]
				.filter((part) => part)
				.join(' · ')}
			note="The pathway at the point of care: the sections for use with a patient, step by step, and the check lists from the rest of the pathway."
			links={
				<>
					<a href={publishedHref(doc().slug)}>The full pathway</a>
					<a href={guidePdfHref(doc().slug)}>Guide PDF</a>
					<CopyLink />
				</>
			}
		>
			<For each={runs()}>
				{(run) => (
					<section class="ocp-published-section" data-depth="0">
						<Show when={run.step}>
							{(step) => (
								<h2 class="ocp-published-title" id={stepAnchor(step().address)}>
									{step().title ?? `Step ${step().address}`}
								</h2>
							)}
						</Show>
						<For each={run.sections}>
							{(section) => (
								<section class="ocp-published-section" data-depth="1">
									<h3 class="ocp-published-title" id={section.address}>
										<Show when={section.printedNumber}>
											{(n) => <span class="ocp-published-number">{numberLabel(n())} </span>}
										</Show>
										{section.title ?? section.address}
									</h3>
									<Show when={section.body}>
										{(body) => <RenderedBody body={body()} derived={derived()} />}
									</Show>
								</section>
							)}
						</For>
					</section>
				)}
			</For>
			<Show when={props.guide.items.length > 0}>
				<section class="ocp-published-section" data-depth="0">
					<h2 class="ocp-published-title" id="point-of-care-checklists">
						Checklists from the pathway
					</h2>
					<For each={props.guide.items}>
						{(item) => (
							<section class="ocp-published-section" data-depth="1">
								<h3 class="ocp-published-title" id={`check-${item.address}`}>
									<a href={item.url}>
										<Show when={item.printedNumber}>
											{(n) => <span class="ocp-published-number">{numberLabel(n())} </span>}
										</Show>
										{item.title ?? item.address}
									</a>
								</h3>
								<Show when={item.list}>
									{(list) => (
										<RenderedBody body={{ type: 'doc', content: [list()] }} derived={derived()} />
									)}
								</Show>
							</section>
						)}
					</For>
				</section>
			</Show>
			<Show when={props.guide.references.length > 0}>
				<section class="ocp-published-section ocp-published-references" data-depth="0">
					<h2 class="ocp-published-title" id="references">
						References
					</h2>
					<ReferenceList references={props.guide.references} />
				</section>
			</Show>
		</ReadingFrame>
	)
}
