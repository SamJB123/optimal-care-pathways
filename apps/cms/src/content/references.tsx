/**
 * The numbered reference list of a published page (the pathway and its quick reference
 * guide): each entry as the list prints it, numbered as the text cites it. A citation that
 * prints its address ("… viewed 15 May 2020, <https://…>") has that address as the link;
 * one that prints none has its link after it.
 */

import { For, Show } from 'solid-js'

export interface ListedReference {
	number: number
	citation: string
	url: string | null
}

/** The citation split at the address it prints in angle brackets, if any. */
const printedAddress = (citation: string) => {
	const m = /<\s*((?:https?:\/\/|www\.)[^>\s]+)\s*>/.exec(citation)
	if (!m || m.index === undefined) return null
	return { before: citation.slice(0, m.index), address: m[1] ?? '', after: citation.slice(m.index + m[0].length) }
}

const hrefOf = (address: string) => (/^https?:\/\//.test(address) ? address : `https://${address}`)

export function ReferenceList(props: { references: ListedReference[] }) {
	return (
		<ol class="ocp-reference-list">
			<For each={props.references}>
				{(reference) => (
					<li value={reference.number}>
						<Show
							when={printedAddress(reference.citation)}
							fallback={
								<>
									{reference.citation}
									<Show when={reference.url}>
										{(url) => (
											<>
												{' '}
												<a href={url()}>{url()}</a>
											</>
										)}
									</Show>
								</>
							}
						>
							{(split) => (
								<>
									{split().before}
									{'<'}
									<a href={reference.url ?? hrefOf(split().address)}>{split().address}</a>
									{'>'}
									{split().after}
								</>
							)}
						</Show>
					</li>
				)}
			</For>
		</ol>
	)
}
