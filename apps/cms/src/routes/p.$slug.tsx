/**
 * /p/{slug} — the public read page of a published document (decisions 125, 126): every
 * section in order with its body rendered by the site's own renderer, the References
 * list numbered as the API numbers them, and section ids for fragment links. This is
 * the page Browser Run prints to PDF, and the canonical url the API and MCP results
 * cite. Public: no sign-in, published content only. The frame is the one the draft
 * preview uses (published/ReadingDocument.tsx), so a preview is what publishing gives.
 */

import { Notice } from '@aicolab/ui-solid'
import { createFileRoute } from '@tanstack/solid-router'
import { Show } from 'solid-js'
import { publishedDocumentFull } from '#/api/server-fns.ts'
import { Masthead } from '#/components/Masthead.tsx'
import { imprintDate } from '#/lib/labels.ts'
import { ReadingDocument } from '#/published/ReadingDocument.tsx'

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
			<Masthead crumbs={[{ label: 'Published library', href: '/library' }, { label: data().document?.document.title ?? 'Not found' }]} />
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
				{(doc) => (
					<ReadingDocument
						eyebrow="published"
						document={{
							title: doc().document.title,
							editionLine: [
								`Version ${doc().document.version}`,
								doc().document.label,
								doc().document.publishedAt ? imprintDate(Date.parse(doc().document.publishedAt ?? '')) : null,
							]
								.filter((part) => part)
								.join(' · '),
							releaseNotes: doc().document.releaseNotes,
							sections: doc().sections,
							references: doc().references,
						}}
					/>
				)}
			</Show>
		</>
	)
}
