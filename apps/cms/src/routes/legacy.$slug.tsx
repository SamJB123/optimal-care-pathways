/**
 * /legacy/{slug} — a legacy pathway as it was printed (decision 139): every section of
 * the published PDF in order, read off the PDF by the layout reader, with a link to the
 * PDF itself. This is the provenance the migrated draft points back to; the current
 * content of the pathway is at /p/{slug} and in the workspace. Public, read-only.
 */

import { Eyebrow, Notice } from '@aicolab/ui-solid'
import { createFileRoute } from '@tanstack/solid-router'
import { For, Show } from 'solid-js'
import { citationNumbers, type DerivedView } from '#/content/derived.ts'
import { RenderedBody } from '#/content/render.tsx'
import { legacyDocumentBySlug } from '#/server/legacy-fns.ts'
import './print.css'

export const Route = createFileRoute('/legacy/$slug')({
	loader: async ({ params }) => {
		try {
			return { legacy: await legacyDocumentBySlug({ data: { slug: params.slug } }), error: null }
		} catch (error) {
			return { legacy: null, error: error instanceof Error ? error.message : String(error) }
		}
	},
	component: LegacyPage,
})

const when = (iso: string | null) =>
	iso ? new Date(iso).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }) : ''

function LegacyPage() {
	const data = Route.useLoaderData()
	return (
		<Show
			when={data().legacy}
			fallback={
				<main class="ocp-published">
					<Notice colorBase="info" variant="soft">
						{data().error ?? 'No legacy document with that name.'}
					</Notice>
				</main>
			}
		>
			{(legacy) => {
				const derived = (): DerivedView => ({
					referenceNumbers: citationNumbers(legacy().sections.map((s) => s.body)),
					timeframes: [],
					map: null,
				})
				return (
					<main class="ocp-published" data-legacy="true">
						<header class="ocp-published-head">
							<Eyebrow>Optimal Care Pathways · previous edition, as printed</Eyebrow>
							<h1>{legacy().document.title}</h1>
							<p class="ocp-published-meta">
								{legacy().document.edition ?? 'Edition not stated'}
								{legacy().document.publicationDate
									? ` · published ${when(legacy().document.publicationDate)}`
									: ''}
								<Show when={legacy().document.pdfUrl}>
									{(url) => (
										<>
											{' · '}
											<a href={url()}>the PDF</a>
										</>
									)}
								</Show>
							</p>
							<p class="ocp-published-notes">
								This is the pathway as its PDF printed it, read section by section. The pathway’s
								current content, drafted on the 2026 template, is the CMS’s own.
							</p>
						</header>
						<For each={legacy().sections}>
							{(section) => (
								<section
									class="ocp-published-section"
									id={section.key ?? section.id}
									data-depth={Math.max(0, section.level - 1)}
								>
									<h2 class="ocp-published-title">{section.heading ?? section.key}</h2>
									<Show when={section.body}>
										{(body) => <RenderedBody body={body()} derived={derived()} />}
									</Show>
								</section>
							)}
						</For>
					</main>
				)
			}}
		</Show>
	)
}
