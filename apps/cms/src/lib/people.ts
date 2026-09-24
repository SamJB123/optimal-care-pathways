/**
 * The names this page knows for the people in its rooms: one book for every surface
 * that labels a user id — the spine's roster, a caret in a section's text, whatever
 * comes next — so nobody is ever shown as a bare id. Names are learnt as the document
 * route fetches them (namesIn, checked against membership) and read through `nameOf`,
 * which falls back to the same stable stand-in every other surface renders
 * (displayNameOf: "Amber Capybara"), never a slice of the id.
 *
 * `knownNames` is reactive for views; `onNamesLearnt` is for transport code that holds no
 * reactive scope (the room client repaints its cursor labels from it).
 */

import { displayNameOf } from '@aicolab/better-auth/cloudflare/shared/user-tag'
import { createSignal } from 'solid-js'

const [names, setNames] = createSignal<Readonly<Record<string, string>>>({})
const listeners = new Set<() => void>()

/** Every name learnt so far, by user id (reactive). */
export const knownNames = names

/** What to call a user: their name once known, else the stable stand-in. */
export const nameOf = (userId: string): string =>
	displayNameOf({ id: userId, name: names()[userId] })

/** Names fetched for `asked` ids. An id the fetch did not answer for is remembered as
 *  nameless, so it is rendered as its stand-in and not asked for again. */
export function learnNames(asked: readonly string[], found: Record<string, string>): void {
	setNames((known) => ({
		...known,
		...Object.fromEntries(asked.map((id) => [id, ''])),
		...found,
	}))
	for (const fn of [...listeners]) fn()
}

export function onNamesLearnt(fn: () => void): () => void {
	listeners.add(fn)
	return () => {
		listeners.delete(fn)
	}
}
