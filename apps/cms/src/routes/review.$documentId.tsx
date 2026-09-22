/**
 * The fidelity review page (decision 39, 55): a core document section by section, each
 * rendered from its stored body on the left and the template PDF page(s) it was
 * extracted from on the right, in outline order. Central members only. `?eager` renders
 * every page up front (for automated screenshots); by default pages draw as they scroll
 * into view.
 */

import { Notice } from '@aicolab/ui-solid'
import { createFileRoute } from '@tanstack/solid-router'
import { For, Show } from 'solid-js'
import { RenderedBody } from '#/content/render.tsx'
import { PdfPages, pageRange } from '#/editors/PdfPages.tsx'
import { reviewSnapshot } from '#/server/documents.ts'
import './review.css'

export const Route = createFileRoute('/review/$documentId')({
	loader: async ({ params }) => reviewSnapshot({ data: { documentId: params.documentId } }),
	validateSearch: (search: Record<string, unknown>): { eager?: boolean } => ({
		eager:
			search.eager === true || search.eager === 'true' || search.eager === '' || search.eager === 1,
	}),
	component: ReviewPage,
})

const PAGE_WIDTH = 520

function ReviewPage() {
	const data = Route.useLoaderData()
	const search = Route.useSearch()
	const pdfUrl = () => `/template-sources/${data().sourceFile}`
	const rows = () => data().sections.filter((s) => s.address !== 'contents')
	return (
		<div class="ocp-review">
			<header class="ocp-review-header">
				<h1>{data().document.title}</h1>
				<p>
					Extracted from <code>{data().sourceFile}</code>
					{data().pageCount ? ` (${data().pageCount} pages)` : ''}. Left: the section as the CMS
					holds it. Right: the page(s) it came from.
				</p>
			</header>
			<Show when={rows().length > 0} fallback={<Notice colorBase="info">No sections.</Notice>}>
				<For each={rows()}>
					{(row) => (
						<article
							class="ocp-review-row"
							data-address={row.address}
							data-pages={row.sourcePages ?? ''}
							id={`s-${row.address.replace(/[^a-z0-9]+/gi, '-')}`}
						>
							<div class="ocp-review-rendered">
								<header class="ocp-review-section-heading">
									<span class="ocp-review-address">{row.address}</span>
									<h2 data-level={row.headingLevel ?? 1}>
										{row.printedNumber ? `${row.printedNumber} ` : ''}
										{row.title ?? ''}
									</h2>
									<span class="ocp-review-meta">
										{row.pathwayOwnership ?? ''}
										{row.apparatus ? ' · apparatus' : ''}
										{row.sourcePages ? ` · p.${row.sourcePages}` : ''}
									</span>
								</header>
								<Show when={row.body} fallback={<p class="ocp-section-empty">No body.</p>}>
									{(body) => <RenderedBody body={body()} derived={data().derived} />}
								</Show>
							</div>
							<div class="ocp-review-source">
								<PdfPages
									url={pdfUrl()}
									pages={pageRange(row.sourcePages)}
									width={PAGE_WIDTH}
									eager={search().eager ?? false}
								/>
							</div>
						</article>
					)}
				</For>
			</Show>
		</div>
	)
}
