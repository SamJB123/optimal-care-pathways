/**
 * /d/{documentId}/preview — the draft in the published page's own frame, as publishing it
 * now would give it (decision S4): placeholders filled with the subject, a pathway's
 * guidance gone, citations numbered as publish numbers them. Marked as a draft on screen
 * and on every printed page. Outside the workspace: this is the reader's view. With
 * `?print`, the page as Browser Run prints it to the draft's PDF (no masthead, no banner).
 */

import { Notice } from '@aicolab/ui-solid'
import { createFileRoute } from '@tanstack/solid-router'
import { Show } from 'solid-js'
import { z } from 'zod'
import { Masthead } from '#/components/Masthead.tsx'
import { imprintDate } from '#/lib/labels.ts'
import { draftDocxHref, draftPdfHref, workspaceHref } from '#/lib/links.ts'
import { kickerOf } from '#/published/PublishedEdition.tsx'
import { ReadingDocument } from '#/published/ReadingDocument.tsx'
import { draftReading } from '#/server/preview-fns.ts'

export const Route = createFileRoute('/d/$documentId_/preview')({
	validateSearch: z.object({ print: z.coerce.boolean().optional() }),
	loader: async ({ params }) => {
		try {
			return {
				draft: await draftReading({ data: { documentId: params.documentId } }),
				error: null,
				now: Date.now(),
			}
		} catch (error) {
			return {
				draft: null,
				error: error instanceof Error ? error.message : String(error),
				now: Date.now(),
			}
		}
	},
	component: PreviewPage,
})

function PreviewPage() {
	const data = Route.useLoaderData()
	const search = Route.useSearch()
	const params = Route.useParams()
	const printing = () => search().print === true
	return (
		<>
			<Show when={!printing()}>
				<Masthead
					crumbs={[
						{ label: 'Pathways', href: '/' },
						{
							label: data().draft?.document.name ?? 'Draft',
							href: workspaceHref(params().documentId),
							accent: data().draft?.document.accent ?? null,
						},
						{ label: 'Preview' },
					]}
				/>
			</Show>
			<Show
				when={data().draft}
				fallback={
					<main class="ocp-published">
						<Notice colorBase="info" variant="soft">
							{data().error ?? 'This draft could not be read.'}
						</Notice>
					</main>
				}
			>
				{(draft) => (
					<ReadingDocument
						accent={draft().document.accent}
						document={{
							title: draft().document.title,
							kicker: `Draft · ${kickerOf(draft().document.kind, draft().document.audience)}`,
							editionLine: `Draft of edition ${draft().editionNo} · as it would publish on ${imprintDate(data().now)}`,
							releaseNotes: null,
							sections: draft().sections,
							references: draft().references,
						}}
						draft
						aside={
							<Show when={!printing()}>
								<p class="ocp-draft-banner" role="note">
									<span>Not published. This is the draft as publishing it now would give it.</span>
									<span class="ocp-draft-banner-links">
										<a href={workspaceHref(params().documentId)}>Back to the draft</a>
										<a href={draftPdfHref(params().documentId)}>PDF</a>
										<a href={draftDocxHref(params().documentId)}>Word</a>
									</span>
								</p>
							</Show>
						}
					/>
				)}
			</Show>
		</>
	)
}
