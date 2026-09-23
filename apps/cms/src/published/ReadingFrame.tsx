/**
 * The published frame (decisions U22, S5, S7, S8): every page a reader opens — a pathway's
 * edition, its quick reference guide, the draft preview, an edition as it was printed —
 * reads in it. ui-solid's DocsShell carries it: on the left the page's spine (for a
 * pathway, its seven steps), on the right the parts of the chapter being read ("On this
 * page"), a reading-progress line in the document's colour, and on a phone the compass
 * that names where the reader is. The content keeps its own typography (the shell's prose
 * is off). At the head, the IMPRINT: what the page is, its edition and date, what changed,
 * the links, and whatever the page says under it. A draft is watermarked, on screen and
 * on every printed page.
 *
 * The page's headings are the shell's chapters: an h2 per chapter and an h3 per section,
 * each with an id; the nav's in-page hrefs name the h2 ids.
 */

import { DocsShell, type DocsNavItem, Eyebrow } from '@aicolab/ui-solid'
import type { JSX } from '@solidjs/web'
import { children, createSignal, Show } from 'solid-js'
import { familyStyle } from '#/lib/family.ts'
import '#/routes/print.css'
import './reading.css'

export function ReadingFrame(props: {
	/** The document's family colour (the print's step-band colour). */
	accent: string | null
	nav: DocsNavItem[]
	navLabel: string
	/** What the page is: "Cancer-specific pathway", "Quick reference guide". */
	kicker: string
	title: string
	/** "Second edition · 1 June 2021". */
	editionLine: string
	/** What changed in this edition, or what the page is. */
	note?: string | null
	/** The ways on: the guide, the PDFs, the link. */
	links?: JSX.Element
	/** Under the imprint: the other editions, a banner. */
	aside?: JSX.Element
	/** A draft: watermarked on screen and on every printed page. */
	draft?: boolean
	class?: string
	children: JSX.Element
}) {
	// Element props are getters: resolved once, or hydration claims their nodes twice.
	const links = children(() => props.links)
	const aside = children(() => props.aside)
	return (
		<div class={['ocp-reading', props.class]} style={familyStyle(props.accent)} data-draft={props.draft ? '' : undefined}>
			<Show when={props.draft}>
				<div class="ocp-watermark" aria-hidden="true">
					<span>Draft</span>
				</div>
			</Show>
			<DocsShell nav={props.nav} navLabel={props.navLabel} prose={false} tocChapters={false}>
				<main class="ocp-published">
					<header class="ocp-imprint-head">
						<Eyebrow>{props.kicker}</Eyebrow>
						<h1>{props.title}</h1>
						<p class="ocp-imprint-edition">{props.editionLine}</p>
						<Show when={props.note}>{(note) => <p class="ocp-imprint-changed">{note()}</p>}</Show>
						<Show when={links()}>
							<p class="ocp-imprint-links">{links()}</p>
						</Show>
						{aside()}
					</header>
					{props.children}
				</main>
			</DocsShell>
		</div>
	)
}

/** The "Copy the link" control an imprint offers: the page's own address, without its
 *  fragment. */
export function CopyLink() {
	const [copied, setCopied] = createSignal(false)
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(window.location.href.split('#')[0] ?? window.location.href)
			setCopied(true)
			setTimeout(() => setCopied(false), 2000)
		} catch {
			setCopied(false)
		}
	}
	return (
		<button type="button" onClick={() => void copy()} aria-live="polite">
			{copied() ? 'Link copied' : 'Copy the link'}
		</button>
	)
}
