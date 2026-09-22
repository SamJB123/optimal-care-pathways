/**
 * /p/{slug} — the public read page of a published document (decisions 125, 126): every
 * section in order with its body rendered by the site's own renderer, the References
 * list numbered as the API numbers them, and section ids for fragment links. This is
 * the page Browser Run prints to PDF, and the canonical url the API and MCP results
 * cite. Public: no sign-in, published content only.
 */

import { Eyebrow, Notice } from '@aicolab/ui-solid'
import { createFileRoute } from '@tanstack/solid-router'
import { For, Show } from 'solid-js'
import { publishedDocumentFull } from '#/api/server-fns.ts'
import type { DerivedView } from '#/content/derived.ts'
import { RenderedBody } from '#/content/render.tsx'
import { numberLabel } from '#/lib/labels.ts'
import './print.css'

export const Route = createFileRoute('/p/$slug')({
	loader: async ({ params }) => {
		try {
			return { document: await publishedDocumentFull({ data: { slug: params.slug } }), error: null }
		} catch (error) {
			return { document: null, error: error instanceof Error ? error.message : String(error) }
		}
	},
	component: PublishedPage,
})

const when = (iso: string | null) =>
	iso
		? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
		: ''

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

function PublishedPage() {
	const data = Route.useLoaderData()
	return (
		<Show
			when={data().document}
			fallback={
				<main class="ocp-published">
					<Notice colorBase="info" variant="soft">
						{data().error ?? 'This document has no published version.'}
					</Notice>
				</main>
			}
		>
			{(doc) => {
				const parentOf = () => new Map(doc().sections.map((s) => [s.address, s.parentAddress]))
				const derived = (): DerivedView => ({
					referenceNumbers: Object.fromEntries(doc().references.map((r) => [r.id, r.number])),
					timeframes: [],
					map: null,
				})
				return (
					<main class="ocp-published">
						<header class="ocp-published-head">
							<Eyebrow>Optimal Care Pathways · published</Eyebrow>
							<h1>{doc().document.title}</h1>
							<p class="ocp-published-meta">
								Version {doc().document.version}
								{doc().document.label ? ` · ${doc().document.label}` : ''}
								{doc().document.publishedAt ? ` · ${when(doc().document.publishedAt)}` : ''}
							</p>
							<Show when={doc().document.releaseNotes}>
								{(notes) => <p class="ocp-published-notes">{notes()}</p>}
							</Show>
						</header>
						<For each={doc().sections}>
							{(section) => (
								<section
									class="ocp-published-section"
									id={section.address}
									data-depth={depthOf(section.address, parentOf())}
									data-ownership={section.ownership}
								>
									<h2 class="ocp-published-title">
										<Show when={section.printedNumber}>
											{(n) => <span class="ocp-published-number">{numberLabel(n())} </span>}
										</Show>
										{section.title ?? section.address}
									</h2>
									<Show when={section.body}>
										{(body) => <RenderedBody body={body()} derived={derived()} />}
									</Show>
								</section>
							)}
						</For>
						<Show when={doc().references.length > 0}>
							<section class="ocp-published-section ocp-published-references" id="references">
								<h2 class="ocp-published-title">References</h2>
								<ol>
									<For each={doc().references}>
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
