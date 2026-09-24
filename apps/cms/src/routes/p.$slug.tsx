/**
 * /p/{slug} — the public read page of a published document (decisions 125, 126, U22, S5):
 * the current edition in the reading frame (published/PublishedEdition.tsx) — the
 * seven-step spine, the imprint, every section rendered by the site's own renderer, the
 * References numbered as the API numbers them, section ids for fragment links. This is
 * the page Browser Run prints to PDF, and the canonical url the API and MCP results cite.
 * Public: no sign-in, published content only.
 */

import { Notice } from '@aicolab/ui-solid'
import { createFileRoute } from '@tanstack/solid-router'
import { Show } from 'solid-js'
import { publishedDocumentFull } from '#/api/server-fns.ts'
import { Masthead } from '#/components/Masthead.tsx'
import { libraryLink } from '#/lib/links.ts'
import { PublishedEdition } from '#/published/PublishedEdition.tsx'

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

function PublishedPage() {
	const data = Route.useLoaderData()
	return (
		<>
			<Masthead
				crumbs={[
					{ label: 'Published library', link: libraryLink() },
					{
						label: data().document?.document.title ?? 'Not found',
						accent: data().document?.accent ?? null,
					},
				]}
			/>
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
				{(doc) => <PublishedEdition data={doc()} />}
			</Show>
		</>
	)
}
