/**
 * /legacy/{slug} — a previous edition as it was printed (decisions 139, S8): every section
 * of the published PDF in order, read off the PDF by the layout reader, in the reading
 * frame and marked as archival: the PDF itself one link away, and the pathway it became
 * (its current edition, once published). This is the provenance the migrated draft
 * points back to. Public, read-only.
 */

import { type DocsNavItem, Notice } from '@aicolab/ui-solid'
import { createFileRoute } from '@tanstack/solid-router'
import { createMemo, For, Show } from 'solid-js'
import { Masthead } from '#/components/Masthead.tsx'
import { citationNumbers, type DerivedView } from '#/content/derived.ts'
import { RenderedBody } from '#/content/render.tsx'
import { publishedHref } from '#/lib/links.ts'
import { CopyLink, ReadingFrame } from '#/published/ReadingFrame.tsx'
import { legacyDocumentBySlug } from '#/server/legacy-fns.ts'

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

type Legacy = NonNullable<Awaited<ReturnType<typeof legacyDocumentBySlug>>>

const printedOn = (iso: string | null) =>
	iso ? new Date(iso).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }) : null

function LegacyPage() {
	const data = Route.useLoaderData()
	return (
		<>
			<Masthead
				crumbs={[
					{ label: 'Published library', href: '/library' },
					{
						label: data().legacy?.document.title ?? 'Not found',
						accent: data().legacy?.pathway?.accent ?? null,
					},
					{ label: 'As printed' },
				]}
			/>
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
				{(legacy) => <LegacyReading legacy={legacy()} />}
			</Show>
		</>
	)
}

function LegacyReading(props: { legacy: Legacy }) {
	const derived = createMemo(
		(): DerivedView => ({
			referenceNumbers: citationNumbers(props.legacy.sections.map((s) => s.body)),
			timeframes: [],
			map: null,
		}),
	)
	/** A section's anchor: its key as the print numbered it, else its id. */
	const anchorOf = (s: Legacy['sections'][number]) => s.key ?? s.id
	const spine = createMemo((): DocsNavItem[] =>
		props.legacy.sections
			.filter((s) => s.level <= 1)
			.map((s) => {
				const step = /^step\s+(\d+)/i.exec(s.heading ?? '')?.[1]
				return {
					href: `#${anchorOf(s)}`,
					mark: step ?? '·',
					label: (s.heading ?? s.key ?? '').replace(/^Step\s+\d+\s*:\s*/i, ''),
				}
			}),
	)
	const doc = () => props.legacy.document
	return (
		<ReadingFrame
			class="ocp-reading-legacy"
			accent={props.legacy.pathway?.accent ?? null}
			nav={spine()}
			navLabel="As printed"
			kicker="Previous edition, as printed"
			title={doc().title}
			editionLine={[
				doc().edition ?? 'Edition not stated',
				printedOn(doc().publicationDate) ? `published ${printedOn(doc().publicationDate)}` : null,
			]
				.filter((part) => part)
				.join(' · ')}
			note="An archival copy: the pathway as its PDF printed it, read section by section. It is not kept up to date."
			links={
				<>
					<Show when={doc().pdfUrl}>{(url) => <a href={url()}>The PDF as printed</a>}</Show>
					<Show when={props.legacy.pathway?.published ? props.legacy.pathway : null}>
						{(pathway) => <a href={publishedHref(pathway().slug)}>The current pathway</a>}
					</Show>
					<CopyLink />
				</>
			}
		>
			<For each={props.legacy.sections}>
				{(section) => {
					const depth = Math.max(0, section.level - 1)
					return (
						<section class="ocp-published-section" data-depth={depth}>
							<Show
								when={depth === 0}
								fallback={
									<Show
										when={depth === 1}
										fallback={
											<h4 class="ocp-published-title" id={anchorOf(section)}>
												{section.heading ?? section.key}
											</h4>
										}
									>
										<h3 class="ocp-published-title" id={anchorOf(section)}>
											{section.heading ?? section.key}
										</h3>
									</Show>
								}
							>
								<h2 class="ocp-published-title" id={anchorOf(section)}>
									{section.heading ?? section.key}
								</h2>
							</Show>
							<Show when={section.body}>
								{(body) => <RenderedBody body={body()} derived={derived()} />}
							</Show>
						</section>
					)
				}}
			</For>
		</ReadingFrame>
	)
}
