/**
 * The review diff (decision 96, 112): a section's draft body annotated against its
 * PUBLISHED body as ONE body — insertions carry the `insertion` mark, deleted text is
 * put back where it was under the `deletion` mark — so the Solid renderer paints it
 * like any other body and a reviewer reads the change in place.
 *
 * prosemirror-changeset does the work: the whole old document is replaced by the whole
 * new one in a single step, and the changeset's token diff (nodes by name, text by
 * character) narrows that to the ranges that actually differ; `simplifyChanges` widens
 * mixed edits to word boundaries so a reviewer never reads half a word struck through.
 */

import { Slice } from '@prosekit/pm/model'
import { ReplaceStep, Transform } from '@prosekit/pm/transform'
import { ChangeSet, simplifyChanges } from 'prosemirror-changeset'
import { contentSchema, emptyBody, type JsonNode, parseBody } from './schema.ts'

export interface AnnotatedBody {
	body: JsonNode
	/** Characters inserted and deleted, for the section's change chip. */
	inserted: number
	deleted: number
	changed: boolean
}

const asJson = (node: { toJSON(): unknown }): JsonNode => node.toJSON() as JsonNode

/** The draft body with its changes against `published` marked. A body never published
 *  is wholly an insertion. */
export function annotateChanges(published: JsonNode | null, draft: JsonNode | null): AnnotatedBody {
	const oldDoc = parseBody(published ?? emptyBody())
	const newDoc = parseBody(draft ?? emptyBody())
	if (oldDoc.eq(newDoc)) return { body: asJson(newDoc), inserted: 0, deleted: 0, changed: false }

	const step = new ReplaceStep(0, oldDoc.content.size, new Slice(newDoc.content, 0, 0))
	const changes = simplifyChanges(
		ChangeSet.create(oldDoc).addSteps(newDoc, [step.getMap()], 0).changes,
		newDoc,
	)
	const insertion = contentSchema.marks.insertion
	const deletion = contentSchema.marks.deletion
	if (!insertion || !deletion) throw new Error('[diff] the content schema lacks the review marks')

	const tr = new Transform(newDoc)
	let inserted = 0
	let deleted = 0
	// Latest change first, so the positions of earlier ones stay valid as text is put back.
	for (const change of [...changes].reverse()) {
		inserted += change.toB - change.fromB
		if (change.toB > change.fromB) tr.addMark(change.fromB, change.toB, insertion.create())
		const removed = oldDoc.textBetween(change.fromA, change.toA, '\n', ' ').trim()
		if (removed.length === 0) continue
		deleted += removed.length
		const text = contentSchema.text(removed, [deletion.create()])
		const $at = tr.doc.resolve(change.fromB)
		if ($at.parent.isTextblock) tr.insert(change.fromB, text)
		else {
			const paragraph = contentSchema.nodes.paragraph?.create(null, text)
			if (paragraph) tr.insert(change.fromB, paragraph)
		}
	}
	return { body: asJson(tr.doc), inserted, deleted, changed: true }
}

/** A stable hash of a body's JSON, for pinning what a review saw (decision 119). */
export async function bodyHash(body: JsonNode | null): Promise<string> {
	const bytes = new TextEncoder().encode(JSON.stringify(body ?? emptyBody()))
	const digest = await crypto.subtle.digest('SHA-256', bytes)
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
