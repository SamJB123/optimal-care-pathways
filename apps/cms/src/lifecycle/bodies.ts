/**
 * The resting bodies a document page knows (server/bodies.ts for what one is): what a
 * section view shows before its editor is bound and what a shared section shows for
 * good, and what the margin reads for the template's notes.
 *
 * One store per document shell, never module-wide — the server renders many requests
 * from one module, and a body read for one member must never be handed to the next
 * request. The part page's loader primes it with every body of the part before the
 * sections render (a synchronous `get`, so the first paint is the whole page); a row the
 * loader did not carry (one added live) is `load`ed once. A revert or a diverge
 * `forget`s the section, so the next view reads it afresh.
 */

import type { RestingBody } from '#/server/bodies.ts'
import { sectionBody } from '#/server/documents.ts'

export type { RestingBody }

export interface RestingBodies {
	/** The body as already known, for a synchronous first paint; undefined until loaded. */
	get(sectionId: string): RestingBody | undefined
	/** The body, read from the server once when it is not known. */
	load(sectionId: string): Promise<RestingBody>
	/** The bodies a loader carried: known from now on. */
	prime(found: Readonly<Record<string, RestingBody>>): void
	/** A section's resting body moved (a revert, a diverge): read it afresh next time. */
	forget(sectionId: string): void
}

export function createRestingBodies(): RestingBodies {
	const known = new Map<string, RestingBody>()
	const pending = new Map<string, Promise<RestingBody>>()
	return {
		get: (sectionId) => known.get(sectionId),
		load(sectionId) {
			const found = known.get(sectionId)
			if (found) return Promise.resolve(found)
			let loading = pending.get(sectionId)
			if (!loading) {
				loading = sectionBody({ data: { sectionId } }).then((body) => {
					known.set(sectionId, body)
					pending.delete(sectionId)
					return body
				})
				pending.set(sectionId, loading)
				loading.catch(() => pending.delete(sectionId))
			}
			return loading
		},
		prime(found) {
			for (const [sectionId, body] of Object.entries(found)) {
				known.set(sectionId, body)
				pending.delete(sectionId)
			}
		},
		forget(sectionId) {
			known.delete(sectionId)
			pending.delete(sectionId)
		},
	}
}
