/**
 * /p/{slug}/v/{n} — an edition of a published document, current or earlier (decision S3):
 * every edition stays readable at its own address, in the same frame as the current one,
 * marked as earlier with a link to the current. Public: published content only.
 */

import { Notice } from '@aicolab/ui-solid'
import { createFileRoute } from '@tanstack/solid-router'
import { Show } from 'solid-js'
import { publishedDocumentFull } from '#/api/server-fns.ts'
import { Masthead } from '#/components/Masthead.tsx'
import { libraryLink, publishedLink } from '#/lib/links.ts'
import { PublishedEdition } from '#/published/PublishedEdition.tsx'

export const Route = createFileRoute('/p/$slug_/v/$version')({
	loader: async ({ params }) => {
		const version = Number(params.version)
		if (!Number.isInteger(version) || version < 1)
			return { document: null, error: `There is no edition "${params.version}".` }
		try {
			return {
				document: await publishedDocumentFull({ data: { slug: params.slug, version } }),
				error: null,
			}
		} catch (error) {
			return { document: null, error: error instanceof Error ? error.message : String(error) }
		}
	},
	component: EditionPage,
})

function EditionPage() {
	const data = Route.useLoaderData()
	const params = Route.useParams()
	return (
		<>
			<Masthead
				crumbs={[
					{ label: 'Published library', link: libraryLink() },
					{
						label: data().document?.document.title ?? 'Not found',
						link: publishedLink(params().slug),
						accent: data().document?.accent ?? null,
					},
					{ label: `Edition ${params().version}` },
				]}
			/>
			<Show
				when={data().document}
				fallback={
					<main class="ocp-published">
						<Notice colorBase="info" variant="soft">
							{data().error ?? 'This edition could not be found.'}
						</Notice>
					</main>
				}
			>
				{(doc) => <PublishedEdition data={doc()} />}
			</Show>
		</>
	)
}
