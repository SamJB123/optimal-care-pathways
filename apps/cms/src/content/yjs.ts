/**
 * Between the resting form and the live form of a section body.
 *
 * At rest a body is ProseMirror JSON in D1 (`sections.body_json`). Live, it is a yjs
 * document in the document's room, which the editor binds to. These two functions are
 * the only crossing: the room hydrates a fresh yjs doc from the row, and folds the yjs
 * doc back into the row after every debounced change. Both go through y-prosemirror's
 * own converters, so what the editor sees and what D1 holds are the same node tree.
 *
 * Server-side: ProseMirror model and state only, no DOM.
 */

import { EditorState } from '@prosekit/pm/state'
import { fragmentToPm, pmToFragment } from '@y/prosemirror'
import type { Type as YType } from '@y/y'
import { contentSchema, type JsonNode, parseBody } from './schema.ts'

/** Write `body` into an (empty) yjs root. */
export function hydrateRoot(root: YType, body: JsonNode): void {
	pmToFragment(parseBody(body), root)
}

/** Read the yjs root as a body. The root is read without an attribution renderer, so
 *  the result is content, not history. */
export function bodyFromRoot(root: YType): JsonNode {
	const state = EditorState.create({ schema: contentSchema })
	const json: unknown = fragmentToPm(root, state.tr).toJSON()
	return asJsonNode(json)
}

function asJsonNode(value: unknown): JsonNode {
	if (
		typeof value !== 'object' ||
		value === null ||
		!('type' in value) ||
		typeof value.type !== 'string'
	) {
		throw new Error('[content] the body is not a node')
	}
	return parseBody(value).toJSON() as JsonNode
}
