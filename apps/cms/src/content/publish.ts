/**
 * The publishable form of a body (decisions 29, 99). A PATHWAY publishes only its own
 * words: drafting guidance and the instructions written inside core sentences ("<for
 * prostate cancer OCP only add: …>") are stripped, the subject placeholders filled from
 * the document, everything else left as written. A CORE document is the template itself
 * and publishes as the template prints, its guidance and instructions included. Pure
 * over the JSON, shared by the lifecycle (what "changed", what a review pins, what is
 * frozen at publish), the gate (which placeholders block) and the change hashes.
 *
 * Stripping guidance can empty a container. What happens then follows the schema: a
 * container that may not be empty and exists only to hold content (a box, a variant, a
 * column, a list item) is dropped with its guidance; a container that is part of a
 * larger structure (a table cell, a timeframe with its care point, the document itself)
 * is filled with an empty paragraph so the structure stands.
 */

import { Fragment } from '@prosekit/pm/model'
import { walkNodes } from './derived.ts'
import { bodyHash } from './diff.ts'
import { contentSchema, emptyBody, type JsonNode, jsonOf } from './schema.ts'

/** Who a body is published for: a pathway's readers, or the template's own page. */
export type PublishAs = 'pathway' | 'template'

export const publishAsFor = (kind: 'core' | 'pathway'): PublishAs =>
	kind === 'core' ? 'template' : 'pathway'

/** Subject placeholders fill from the document at render; every other placeholder left
 *  in an owned section blocks publishing. */
export const SUBJECT_PLACEHOLDERS = ['[cancer type]', '[population group]'] as const

/** The subject as the templates write it: "[cancer type]", and the variants the print
 *  also uses — "[Cancer type]", "<cancer type>", "[insert cancer type]", and the highlight
 *  running on over the stop after it ("[cancer type]."). */
const SUBJECT = /[[<]\s*(?:insert\s+)?(?:cancer type|population group)\s*[\]>]/gi
const SUBJECT_WHOLE = /^[[<]\s*(?:insert\s+)?(?:cancer type|population group)\s*[\]>][.,;:]?$/i

export const isSubjectPlaceholder = (label: string): boolean => SUBJECT_WHOLE.test(label.trim())

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

/** Text written inside a core sentence as an instruction to the author. */
const isInstruction = (node: JsonNode): boolean =>
	node.type === 'text' && (node.marks?.some((m) => m.type === 'instruction') ?? false)

/** An instruction's text leaves the sentence it sat in: the space it leaves behind goes
 *  with it when the sentence closes or continues with punctuation after it. */
function withoutInstructions(content: JsonNode[]): JsonNode[] {
	const out: JsonNode[] = []
	for (let i = 0; i < content.length; i++) {
		const node = content[i]
		if (!node) continue
		if (!isInstruction(node)) {
			out.push(node)
			continue
		}
		const before = out.at(-1)
		const after = content.slice(i + 1).find((n) => !isInstruction(n))
		const closes = after === undefined || (after.type === 'text' && /^[\s.,;:)]/.test(after.text ?? ''))
		if (before?.type === 'text' && closes) {
			const text = (before.text ?? '').replace(/\s+$/, '')
			out.pop()
			if (text.length > 0) out.push({ ...before, text })
		}
	}
	return out
}

/** The body as published: for a pathway, guidance and instructions stripped and the
 *  subject placeholders filled; for the template's own page, as written. */
export function publishBody(
	body: JsonNode | null,
	subject: string,
	as: PublishAs = 'pathway',
): JsonNode | null {
	if (!body) return null
	if (as === 'template') return body
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
				// The subject in place of the bracketed form, the stop after it kept.
				const written = node.text ?? ''
				const text = SUBJECT_WHOLE.test(written.trim()) ? written.replace(SUBJECT, subject) : subject
				return [marks.length > 0 ? { ...rest, text, marks } : { ...rest, text }]
			}
			return [node]
		}
		if (!node.content) return [node]
		const content = withoutInstructions(node.content).flatMap(fill)
		const type = contentSchema.nodes[node.type]
		if (!type) return [{ ...node, content }]
		const fragment = Fragment.fromJSON(contentSchema, content)
		if (type.validContent(fragment)) return [{ ...node, content }]
		// The stripping left this container invalid: drop a container that only held the
		// stripped content, fill one that is part of a structure.
		if (DROPPED_WHEN_EMPTY.has(node.type) && content.every((c) => c.type === 'banner')) return []
		const filled = type.createAndFill(node.attrs ?? null, fragment)
		return filled ? [jsonOf(filled)] : []
	}
	const [doc] = fill(body)
	if (!doc) return null
	return (doc.content?.length ?? 0) === 0 ? emptyBody() : doc
}

/** The hash of what a body would publish (`sections.draft_hash`,
 *  `version_sections.body_hash`): equal hashes mean nothing to publish. */
export function publishableHash(
	body: JsonNode | null,
	subject: string,
	as: PublishAs = 'pathway',
): Promise<string> {
	return bodyHash(publishBody(body, subject, as))
}
