/**
 * A published edition in the reading frame: the current one (/p/{slug}) or an earlier one
 * (/p/{slug}/v/{n}), the same page either way. The imprint names the edition, its date
 * and what changed; the quick reference guide and the PDFs are one link away (the PDFs
 * are the current edition's), the page's own address can be copied, and every edition is
 * listed, the one being read marked. An earlier edition says so and links the current.
 */

import { Link } from '@tanstack/solid-router'
import { For, Show } from 'solid-js'
import type { NumberedReference } from '#/api/published.ts'
import type { JsonNode } from '#/content/schema.ts'
import { imprintDate } from '#/lib/labels.ts'
import { editionLink, guideLink, guidePdfHref, pdfHref, publishedLink } from '#/lib/links.ts'
import { ReadingDocument } from './ReadingDocument.tsx'
import { CopyLink } from './ReadingFrame.tsx'

export interface EditionEntry {
	version: number
	status: 'draft' | 'published' | 'archived'
	label: string | null
	publishedAt: string | null
}

export interface PublishedEditionData {
	document: {
		slug: string
		title: string
		kind: 'core' | 'pathway'
		audience: 'cancer' | 'population' | 'principles'
		version: number
		label: string | null
		releaseNotes: string | null
		publishedAt: string | null
	}
	sections: {
		address: string
		parentAddress: string | null
		printedNumber: string | null
		title: string | null
		titleCitations: string[]
		ownership: 'shared' | 'owned'
		body: JsonNode | null
	}[]
	references: NumberedReference[]
	accent: string | null
	editions: EditionEntry[]
}

/** What a document is, in the words its readers use. */
export const kickerOf = (
	kind: 'core' | 'pathway',
	audience: 'cancer' | 'population' | 'principles',
): string =>
	kind === 'core'
		? audience === 'principles'
			? 'Principles for optimal care'
			: 'Core template'
		: audience === 'population'
			? 'Population pathway'
			: 'Cancer-specific pathway'

/** An edition's name as the imprint sets it: its label, else its number. */
const editionName = (e: { version: number; label: string | null }) =>
	e.label ?? `Edition ${e.version}`
const dated = (iso: string | null) => (iso ? imprintDate(Date.parse(iso)) : null)

export function PublishedEdition(props: { data: PublishedEditionData }) {
	const doc = () => props.data.document
	const current = () => props.data.editions.find((e) => e.status === 'published') ?? null
	const earlier = () => current() !== null && current()?.version !== doc().version
	return (
		<ReadingDocument
			accent={props.data.accent}
			document={{
				title: doc().title,
				kicker: kickerOf(doc().kind, doc().audience),
				editionLine: [editionName(doc()), dated(doc().publishedAt)]
					.filter((part) => part)
					.join(' · '),
				releaseNotes: doc().releaseNotes,
				sections: props.data.sections,
				references: props.data.references,
			}}
			links={
				<>
					<Show when={doc().kind === 'pathway' && !earlier()}>
						<Link {...guideLink(doc().slug)}>Quick reference guide</Link>
					</Show>
					<Show when={!earlier()}>
						<a href={pdfHref(doc().slug)}>PDF</a>
						<Show when={doc().kind === 'pathway'}>
							<a href={guidePdfHref(doc().slug)}>Guide PDF</a>
						</Show>
					</Show>
					<CopyLink />
				</>
			}
			aside={
				<>
					<Show when={earlier() ? current() : null}>
						{(now) => (
							<p class="ocp-imprint-note" role="note">
								An earlier edition. The current one is{' '}
								<Link {...publishedLink(doc().slug)}>{editionName(now())}</Link>
								{now().publishedAt ? `, ${dated(now().publishedAt)}` : ''}.
							</p>
						)}
					</Show>
					<Show when={props.data.editions.length > 1}>
						<ul class="ocp-imprint-editions" aria-label="Editions">
							<For each={props.data.editions}>
								{(e) => (
									<li aria-current={e.version === doc().version ? 'page' : undefined}>
										<Show
											when={e.version !== doc().version}
											fallback={<span>{editionName(e)}</span>}
										>
											<Link
												{...(e.status === 'published'
													? publishedLink(doc().slug)
													: editionLink(doc().slug, e.version))}
											>
												{editionName(e)}
											</Link>
										</Show>
										{e.publishedAt ? ` · ${dated(e.publishedAt)}` : ''}
										{e.status === 'published' ? ' · current' : ''}
									</li>
								)}
							</For>
						</ul>
					</Show>
				</>
			}
		/>
	)
}
