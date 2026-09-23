/**
 * /p/{slug}/quick-reference-guide — the derived quick reference guide of a published
 * document (decisions 4, 28, 152): the sections flagged for use at point of care in
 * reading order, then the point-of-care check lists found in the rest of the pathway,
 * each with the section it belongs to. The same derivation the API serves; Browser Run
 * prints this page to the guide's PDF. Public: published content only.
 */

import { Eyebrow, Notice } from '@aicolab/ui-solid'
import { createFileRoute } from '@tanstack/solid-router'
import { For, Show } from 'solid-js'
import { publishedGuide } from '#/api/server-fns.ts'
import type { DerivedView } from '#/content/derived.ts'
import { RenderedBody } from '#/content/render.tsx'
import { numberLabel } from '#/lib/labels.ts'
import './print.css'

export const Route = createFileRoute('/p/$slug/quick-reference-guide')({
	loader: async ({ params }) => {
		try {
			return { guide: await publishedGuide({ data: { slug: params.slug } }), error: null }
		} catch (error) {
			return { guide: null, error: error instanceof Error ? error.message : String(error) }
		}
	},
	component: GuidePage,
})

const when = (iso: string | null) =>
	iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }) : ''

function GuidePage() {
	const data = Route.useLoaderData()
	return (
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
			{(guide) => {
				const derived = (): DerivedView => ({
					referenceNumbers: Object.fromEntries(guide().references.map((r) => [r.id, r.number])),
					timeframes: [],
					map: null,
				})
				return (
					<main class="ocp-published" data-guide="true">
						<header class="ocp-published-head">
							<Eyebrow>Optimal Care Pathways · quick reference guide</Eyebrow>
							<h1>{guide().document.title}</h1>
							<p class="ocp-published-meta">
								Summary of the full pathway for use at point of care · version {guide().document.version}
								{guide().document.label ? ` · ${guide().document.label}` : ''}
								{guide().document.publishedAt ? ` · ${when(guide().document.publishedAt)}` : ''}
								{' · '}
								<a href={guide().document.url}>the full pathway</a>
							</p>
						</header>
						<For each={guide().sections}>
							{(section) => (
								<section class="ocp-published-section" id={section.address} data-depth={section.address.split('/').length - 1}>
									<h2 class="ocp-published-title">
										<Show when={section.printedNumber}>
											{(n) => <span class="ocp-published-number">{numberLabel(n())} </span>}
										</Show>
										{section.title ?? section.address}
									</h2>
									<Show when={section.body}>{(body) => <RenderedBody body={body()} derived={derived()} />}</Show>
								</section>
							)}
						</For>
						<Show when={guide().items.length > 0}>
							<section class="ocp-published-section" id="point-of-care-checklists">
								<h2 class="ocp-published-title">Checklists from the pathway</h2>
								<For each={guide().items}>
									{(item) => (
										<section class="ocp-published-section" data-depth="1">
											<h3 class="ocp-published-title">
												<a href={item.url}>
													<Show when={item.printedNumber}>{(n) => <span class="ocp-published-number">{numberLabel(n())} </span>}</Show>
													{item.title ?? item.address}
												</a>
											</h3>
											<Show when={item.list}>{(list) => <RenderedBody body={{ type: 'doc', content: [list()] }} derived={derived()} />}</Show>
										</section>
									)}
								</For>
							</section>
						</Show>
						<Show when={guide().references.length > 0}>
							<section class="ocp-published-section ocp-published-references" id="references">
								<h2 class="ocp-published-title">References</h2>
								<ol>
									<For each={guide().references}>
										{(reference) => (
											<li value={reference.number}>
												{reference.citation}
												<Show when={reference.url}>
													{(url) => (
														<>
															{' '}
															<a href={url()}>{url()}</a>
														</>
													)}
												</Show>
											</li>
										)}
									</For>
								</ol>
							</section>
						</Show>
					</main>
				)
			}}
		</Show>
	)
}
