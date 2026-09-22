/**
 * The publishable form of a body (decisions 29, 99): drafting guidance stripped, the
 * subject placeholders filled from the document, everything else left as written. Pure
 * over the JSON, shared by the lifecycle (what "changed", what a review pins, what is
 * frozen at publish) and the gate (which placeholders block).
 *
 * Stripping guidance can empty a container. What happens then follows the schema: a
 * container that may not be empty and exists only to hold content (a box, a variant, a
 * column, a list item) is dropped with its guidance; a container that is part of a
 * larger structure (a table cell, a timeframe with its care point, the document itself)
 * is filled with an empty paragraph so the structure stands.
 */

import { Fragment } from '@prosekit/pm/model'
import { walkNodes } from './derived.ts'
import { contentSchema, emptyBody, type JsonNode } from './schema.ts'

/** Subject placeholders fill from the document at render; every other placeholder left
 *  in an owned section blocks publishing. */
export const SUBJECT_PLACEHOLDERS = ['[cancer type]', '[population group]'] as const

export const isSubjectPlaceholder = (label: string): boolean =>
	SUBJECT_PLACEHOLDERS.some((p) => label.trim().toLowerCase() === p)

const placeholderLabel = (node: JsonNode): string | null => {
	const placeholder = node.marks?.find((m) => m.type === 'placeholder')
	if (!placeholder) return null
	return typeof placeholder.attrs?.label === 'string' ? placeholder.attrs.label : (node.text ?? '')
}

/** Placeholders in a body that are not the subject's — the ones a drafter must replace. */
export function blockingPlaceholders(body: JsonNode | null): number {
	if (!body) return 0
	let n = 0
	walkNodes(body, (node) => {
		if (node.type !== 'text') return
		const label = placeholderLabel(node)
		if (label === null) return
		if (!isSubjectPlaceholder(label) && !isSubjectPlaceholder(node.text ?? '')) n++
	})
	return n
}

/** Containers that exist to hold what was stripped: gone with it when emptied. */
const DROPPED_WHEN_EMPTY = new Set([
	'box',
	'variants',
	'variant',
	'columns',
	'column',
	'figureRow',
	'resourceList',
	'resource',
	'list',
	'blockquote',
])

/** The body as published: guidance stripped, subject placeholders filled. */
export function publishBody(body: JsonNode | null, subject: string): JsonNode | null {
	if (!body) return null
	const fill = (node: JsonNode): JsonNode[] => {
		if (node.type === 'guidance') return []
		if (node.type === 'text') {
			const label = placeholderLabel(node)
			if (
				label !== null &&
				(isSubjectPlaceholder(label) || isSubjectPlaceholder(node.text ?? ''))
			) {
				const marks = node.marks?.filter((m) => m.type !== 'placeholder') ?? []
				const { marks: _dropped, ...rest } = node
				return [marks.length > 0 ? { ...rest, text: subject, marks } : { ...rest, text: subject }]
			}
			return [node]
		}
		if (!node.content) return [node]
		const content = node.content.flatMap(fill)
		const type = contentSchema.nodes[node.type]
		if (!type) return [{ ...node, content }]
		const fragment = Fragment.fromJSON(contentSchema, content)
		if (type.validContent(fragment)) return [{ ...node, content }]
		// The stripping left this container invalid: drop a container that only held the
		// stripped content, fill one that is part of a structure.
		if (DROPPED_WHEN_EMPTY.has(node.type) && content.every((c) => c.type === 'banner')) return []
		const filled = type.createAndFill(node.attrs ?? null, fragment)
		return filled ? [filled.toJSON() as JsonNode] : []
	}
	const [doc] = fill(body)
	if (!doc) return null
	return (doc.content?.length ?? 0) === 0 ? emptyBody() : doc
}
