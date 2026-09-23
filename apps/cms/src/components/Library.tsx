/**
 * The public library (decision S1): what a visitor who is not signed in lands on — every
 * published pathway, grouped, each in its own colour with its edition and date, and the
 * pathway, its quick reference guide and its PDF one link away. The Principles for Optimal
 * Cancer Care stand first as the foundation every pathway builds on; the latest editions
 * are listed with the first line of what changed.
 */

import { createMemo, createSignal, For, Show } from 'solid-js'
import { familyStyle } from '#/lib/family.ts'
import { monthDate, shortDate } from '#/lib/labels.ts'
import { guideHref, guidePdfHref, pdfHref, publishedHref } from '#/lib/links.ts'
import type { LibraryEntry } from '#/server/atlas.ts'
import { SpineGlyph } from './Masthead.tsx'
import './library.css'

const GROUPS: { key: 'cancer' | 'population'; label: string }[] = [
	{ key: 'cancer', label: 'Cancer-specific pathways' },
	{ key: 'population', label: 'Population pathways' },
]

/** An edition as the print names it ("Second edition"), else by number, and its month. */
const editionLine = (entry: LibraryEntry): string =>
	`${entry.label ?? `Edition ${entry.versionNo}`}${entry.publishedAt ? ` · ${monthDate(entry.publishedAt)}` : ''}`

function EntryLinks(props: { entry: LibraryEntry }) {
	return (
		<span class="ocp-library-links">
			<Show when={props.entry.guide}>
				<a href={guideHref(props.entry.slug)}>Quick reference guide</a>
			</Show>
			<a href={pdfHref(props.entry.slug)}>PDF</a>
			<Show when={props.entry.guide}>
				<a href={guidePdfHref(props.entry.slug)}>Guide PDF</a>
			</Show>
		</span>
	)
}

export function Library(props: { entries: readonly LibraryEntry[] }) {
	const [query, setQuery] = createSignal('')
	const principles = () => props.entries.find((e) => e.audience === 'principles')
	const pathways = createMemo(() => {
		const q = query().trim().toLowerCase()
		return props.entries
			.filter((e) => e.kind === 'pathway')
			.filter((e) => !q || [e.name, e.title, e.slug].some((s) => s.toLowerCase().includes(q)))
			.sort((a, b) => a.name.localeCompare(b.name, 'en-AU'))
	})
	const recent = () =>
		[...props.entries]
			.filter((e) => e.publishedAt !== null)
			.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
			.slice(0, 5)

	return (
		<div class="ocp-library">
			<header class="ocp-library-head">
				<SpineGlyph class="ocp-library-glyph" />
				<h1>Optimal Care Pathways</h1>
				<p class="ocp-library-lede">
					The national standards for cancer care in Australia: for each cancer type and population group, what
					good care looks like at each of seven steps, from prevention to the end of life. Published by Cancer
					Australia.
				</p>
			</header>

			<Show when={principles()}>
				{(p) => (
					<section class="ocp-library-foundation" style={familyStyle(p().accent)} aria-labelledby="ocp-library-foundation">
						<p class="ocp-library-kicker" id="ocp-library-foundation">
							The foundation for every pathway
						</p>
						<h2>
							<a href={publishedHref(p().slug)}>{p().name}</a>
						</h2>
						<p class="ocp-muted">{editionLine(p())}</p>
					</section>
				)}
			</Show>

			<div class="ocp-library-body">
				<div class="ocp-library-main">
					<label class="ocp-library-search">
						<span class="ocp-visually-hidden">Find a pathway</span>
						<input type="search" placeholder="Find a pathway" value={query()} onInput={(e) => setQuery(e.currentTarget.value)} />
					</label>
					<Show
						when={props.entries.some((e) => e.kind === 'pathway')}
						fallback={<p class="ocp-muted">No pathway has been published here yet.</p>}
					>
						<For each={GROUPS}>
							{(group) => (
								<Show when={pathways().some((e) => e.audience === group.key)}>
									<section class="ocp-library-group" aria-label={group.label}>
										<h2>{group.label}</h2>
										<ul>
											<For each={pathways().filter((e) => e.audience === group.key)}>
												{(entry) => (
													<li style={familyStyle(entry.accent)}>
														<a class="ocp-library-name" href={publishedHref(entry.slug)}>
															{entry.name}
														</a>
														<span class="ocp-library-edition ocp-muted">{editionLine(entry)}</span>
														<EntryLinks entry={entry} />
													</li>
												)}
											</For>
										</ul>
									</section>
								</Show>
							)}
						</For>
						<Show when={pathways().length === 0}>
							<p class="ocp-muted">No pathway matches “{query()}”.</p>
						</Show>
					</Show>
				</div>
				<aside class="ocp-library-aside">
					<Show when={recent().length > 0}>
						<section aria-labelledby="ocp-library-recent">
							<h2 id="ocp-library-recent">Latest editions</h2>
							<ol class="ocp-library-recent">
								<For each={recent()}>
									{(entry) => (
										<li style={familyStyle(entry.accent)}>
											<a href={publishedHref(entry.slug)}>{entry.name}</a>
											<span class="ocp-muted ocp-figure">
												{entry.label ?? `Edition ${entry.versionNo}`} · {shortDate(entry.publishedAt ?? 0)}
											</span>
											<Show when={entry.note}>{(note) => <span class="ocp-library-note">{note()}</span>}</Show>
										</li>
									)}
								</For>
							</ol>
						</section>
					</Show>
					<section class="ocp-library-dev" aria-labelledby="ocp-library-dev">
						<h2 id="ocp-library-dev">For developers</h2>
						<p>
							Every published pathway is also available as data: <a href="/api/v1/docs">the API</a>, and an MCP endpoint at{' '}
							<code>/mcp</code> for AI tools.
						</p>
					</section>
				</aside>
			</div>
		</div>
	)
}
