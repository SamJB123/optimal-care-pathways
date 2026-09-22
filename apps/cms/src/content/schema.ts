/**
 * The content schema — what a section body is made of. Defined ONCE, here, as plain
 * ProseMirror node and mark specs; the editor wraps these same specs into its ProseKit
 * extension, the server parses and renders with the Schema built from them, and the seed
 * builds JSON that must satisfy them.
 *
 * The vocabulary is the 2026 template's own, read off the three template PDFs:
 *
 *   paragraph                   prose
 *   banner                      the title band of a box ("Signs and symptoms of cancer")
 *   bulletList / listItem       a plain bulleted list
 *   checklist / checkItem       the tick rows: "actionable items for each step". A check
 *                               item may be tagged point-of-care, which is what the quick
 *                               reference guide is derived from
 *   timeframe                   a timeframe box: a care point ("Timeframe for referral to a
 *                               cancer specialist") and its statement. The template offers
 *                               alternatives; an author keeps one
 *   guidance                    a green/purple developer box: instruction to the author,
 *                               never published
 *   citation (inline atom)      a reference to a row of the document's references table.
 *                               Its number is derived at render, so it cannot go stale
 *
 * marks: bold, italic, link(href), placeholder(label) for the template's editable slots
 * ("[cancer type]", "[insert timeframe]") and sectionLink(address) for a typed cross-
 * reference to another section of the same document.
 *
 * Names follow ProseKit's where the concept is the same (bold, italic, link), so its
 * commands and keymaps apply unchanged.
 */

import { type MarkSpec, type NodeSpec, Node as PmNode, Schema } from '@prosekit/pm/model'

const attr = (element: HTMLElement | string, name: string) =>
	typeof element === 'string' ? null : element.getAttribute(name)

export const nodeSpecs = {
	doc: { content: 'block+' },
	paragraph: {
		content: 'inline*',
		group: 'block',
		parseDOM: [{ tag: 'p:not([data-ocp])' }],
		toDOM: () => ['p', 0],
	},
	banner: {
		content: 'inline*',
		group: 'block',
		defining: true,
		parseDOM: [{ tag: 'p[data-ocp="banner"]' }],
		toDOM: () => ['p', { 'data-ocp': 'banner' }, 0],
	},
	bulletList: {
		content: 'listItem+',
		group: 'block',
		parseDOM: [{ tag: 'ul:not([data-ocp])' }],
		toDOM: () => ['ul', 0],
	},
	listItem: {
		content: 'paragraph block*',
		defining: true,
		parseDOM: [{ tag: 'li:not([data-ocp])' }],
		toDOM: () => ['li', 0],
	},
	checklist: {
		content: 'checkItem+',
		group: 'block',
		parseDOM: [{ tag: 'ul[data-ocp="checklist"]' }],
		toDOM: () => ['ul', { 'data-ocp': 'checklist' }, 0],
	},
	checkItem: {
		content: 'paragraph block*',
		defining: true,
		attrs: { pointOfCare: { default: false } },
		parseDOM: [
			{
				tag: 'li[data-ocp="check"]',
				getAttrs: (element) => ({ pointOfCare: attr(element, 'data-point-of-care') === 'true' }),
			},
		],
		toDOM: (node) => [
			'li',
			{ 'data-ocp': 'check', 'data-point-of-care': String(node.attrs.pointOfCare) },
			0,
		],
	},
	timeframe: {
		content: 'paragraph+',
		group: 'block',
		defining: true,
		attrs: { carePoint: { default: '' } },
		parseDOM: [
			{
				tag: 'aside[data-ocp="timeframe"]',
				getAttrs: (element) => ({ carePoint: attr(element, 'data-care-point') ?? '' }),
			},
		],
		toDOM: (node) => [
			'aside',
			{ 'data-ocp': 'timeframe', 'data-care-point': String(node.attrs.carePoint) },
			0,
		],
	},
	guidance: {
		content: 'block+',
		group: 'block',
		defining: true,
		parseDOM: [{ tag: 'aside[data-ocp="guidance"]' }],
		toDOM: () => ['aside', { 'data-ocp': 'guidance' }, 0],
	},
	citation: {
		inline: true,
		group: 'inline',
		atom: true,
		selectable: true,
		attrs: { referenceId: {} },
		parseDOM: [
			{
				tag: 'sup[data-ocp="citation"]',
				getAttrs: (element) => ({ referenceId: attr(element, 'data-reference-id') ?? '' }),
			},
		],
		toDOM: (node) => [
			'sup',
			{ 'data-ocp': 'citation', 'data-reference-id': String(node.attrs.referenceId) },
		],
	},
	text: { group: 'inline' },
} satisfies Record<string, NodeSpec>

export const markSpecs = {
	bold: {
		parseDOM: [{ tag: 'strong' }, { tag: 'b' }],
		toDOM: () => ['strong', 0],
	},
	italic: {
		parseDOM: [{ tag: 'em' }, { tag: 'i' }],
		toDOM: () => ['em', 0],
	},
	link: {
		attrs: { href: {} },
		inclusive: false,
		parseDOM: [
			{
				tag: 'a[href]:not([data-ocp])',
				getAttrs: (element) => ({ href: attr(element, 'href') ?? '' }),
			},
		],
		toDOM: (mark) => ['a', { href: String(mark.attrs.href), rel: 'noopener' }, 0],
	},
	placeholder: {
		attrs: { label: {} },
		inclusive: false,
		excludes: 'placeholder',
		parseDOM: [
			{
				tag: 'mark[data-ocp="placeholder"]',
				getAttrs: (element) => ({ label: attr(element, 'data-label') ?? '' }),
			},
		],
		toDOM: (mark) => [
			'mark',
			{ 'data-ocp': 'placeholder', 'data-label': String(mark.attrs.label) },
			0,
		],
	},
	sectionLink: {
		attrs: { address: {} },
		inclusive: false,
		parseDOM: [
			{
				tag: 'a[data-ocp="section"]',
				getAttrs: (element) => ({ address: attr(element, 'data-address') ?? '' }),
			},
		],
		toDOM: (mark) => [
			'a',
			{
				'data-ocp': 'section',
				'data-address': String(mark.attrs.address),
				href: `#${String(mark.attrs.address)}`,
			},
			0,
		],
	},
} satisfies Record<string, MarkSpec>

export type NodeName = keyof typeof nodeSpecs
export type MarkName = keyof typeof markSpecs

/** The block node names that carry durable identity in the editor. */
export const BLOCK_NODE_NAMES = [
	'paragraph',
	'banner',
	'bulletList',
	'checklist',
	'timeframe',
	'guidance',
] as const satisfies readonly NodeName[]

export const contentSchema = new Schema({ nodes: nodeSpecs, marks: markSpecs })

/** The JSON form of a node, as stored in `sections.body_json` and served by the API. */
export interface JsonNode {
	type: NodeName
	attrs?: Record<string, string | number | boolean>
	content?: JsonNode[]
	text?: string
	marks?: JsonMark[]
}

export interface JsonMark {
	type: MarkName
	attrs?: Record<string, string | number | boolean>
}

/** Parses stored JSON into a node and checks it against the schema; throws if malformed. */
export function parseBody(json: unknown): PmNode {
	const node = PmNode.fromJSON(contentSchema, json)
	node.check()
	return node
}

export const emptyBody = (): JsonNode => ({ type: 'doc', content: [{ type: 'paragraph' }] })
