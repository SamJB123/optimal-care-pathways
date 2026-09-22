/**
 * The content schema — what a section body is made of. Defined ONCE, here, as a ProseKit
 * extension made of SPEC-ONLY definitions: the editor unions it with commands, keymaps
 * and plugins; the server builds the ProseMirror Schema from it to parse, validate and
 * render; the seed builds JSON that must satisfy it.
 *
 * Everything an author of a clinical document uses, from ProseKit's own definitions:
 *
 *   paragraph, heading (h1–h6 inside a section), blockquote, horizontalRule, hardBreak,
 *   image (the pathways' figures), table / tableRow / tableCell / tableHeaderCell,
 *   list — ProseKit's flat list (`kind`: bullet, ordered, task, toggle) plus this
 *   system's own kind, 'check': the template's tick rows, "actionable items for each
 *   step". A check item carries `pointOfCare`, from which the quick reference guide is
 *   derived.
 *   marks: bold, italic, underline, strike, superscript, subscript (units and
 *   footnote-style text), link.
 *
 * And the 2026 template's own blocks, which no general editor has:
 *
 *   banner                      the title band of a box ("Signs and symptoms of cancer")
 *   timeframe                   a timeframe box: a care point ("Timeframe for referral to a
 *                               cancer specialist") and its statement. The template offers
 *                               alternatives; an author keeps one
 *   guidance                    a green/purple developer box: instruction to the author,
 *                               never published
 *   citation (inline atom)      a reference to a row of the document's references table.
 *                               Its number is derived at render, so it cannot go stale
 *   placeholder (mark)          the template's editable slots ("[cancer type]")
 *   sectionLink (mark)          a typed cross-reference to another section, by address
 */

import {
	defineMarkSpec,
	defineNodeAttr,
	defineNodeSpec,
	type ExtractMarks,
	type ExtractNodes,
	union,
} from '@prosekit/core'
import { defineBlockquoteSpec } from '@prosekit/extensions/blockquote'
import { defineBoldSpec } from '@prosekit/extensions/bold'
import { defineDoc } from '@prosekit/extensions/doc'
import { defineHardBreakSpec } from '@prosekit/extensions/hard-break'
import { defineHeadingSpec } from '@prosekit/extensions/heading'
import { defineHorizontalRuleSpec } from '@prosekit/extensions/horizontal-rule'
import { defineImageSpec } from '@prosekit/extensions/image'
import { defineItalicSpec } from '@prosekit/extensions/italic'
import { defineLinkSpec } from '@prosekit/extensions/link'
import { defineListSpec } from '@prosekit/extensions/list'
import { defineParagraphSpec } from '@prosekit/extensions/paragraph'
import { defineStrikeSpec } from '@prosekit/extensions/strike'
import { defineSubscriptSpec } from '@prosekit/extensions/subscript'
import { defineSuperscriptSpec } from '@prosekit/extensions/superscript'
import {
	defineTableCellSpec,
	defineTableHeaderCellSpec,
	defineTableRowSpec,
	defineTableSpec,
} from '@prosekit/extensions/table'
import { defineText } from '@prosekit/extensions/text'
import { defineUnderlineSpec } from '@prosekit/extensions/underline'
import { Node as PmNode, type Schema } from '@prosekit/pm/model'

// ---------------------------------------------------------------------------
// The template's own blocks
// ---------------------------------------------------------------------------

export interface TimeframeAttrs {
	carePoint: string
}

export interface CitationAttrs {
	referenceId: string
}

export interface PlaceholderAttrs {
	label: string
}

export interface SectionLinkAttrs {
	address: string
}

const attr = (element: HTMLElement, name: string) => element.getAttribute(name) ?? ''

const defineBanner = () =>
	defineNodeSpec({
		name: 'banner',
		content: 'inline*',
		group: 'block',
		defining: true,
		parseDOM: [{ tag: 'p[data-ocp="banner"]' }],
		toDOM: () => ['p', { 'data-ocp': 'banner' }, 0],
	})

const defineTimeframe = () =>
	defineNodeSpec<'timeframe', TimeframeAttrs>({
		name: 'timeframe',
		content: 'paragraph+',
		group: 'block',
		defining: true,
		attrs: { carePoint: { default: '', validate: 'string' } },
		parseDOM: [
			{
				tag: 'aside[data-ocp="timeframe"]',
				getAttrs: (element) => ({ carePoint: attr(element, 'data-care-point') }),
			},
		],
		toDOM: (node) => [
			'aside',
			{ 'data-ocp': 'timeframe', 'data-care-point': String(node.attrs.carePoint) },
			0,
		],
	})

const defineGuidance = () =>
	defineNodeSpec({
		name: 'guidance',
		content: 'block+',
		group: 'block',
		defining: true,
		parseDOM: [{ tag: 'aside[data-ocp="guidance"]' }],
		toDOM: () => ['aside', { 'data-ocp': 'guidance' }, 0],
	})

const defineCitation = () =>
	defineNodeSpec<'citation', CitationAttrs>({
		name: 'citation',
		inline: true,
		group: 'inline',
		atom: true,
		selectable: true,
		attrs: { referenceId: { validate: 'string' } },
		parseDOM: [
			{
				tag: 'sup[data-ocp="citation"]',
				getAttrs: (element) => ({ referenceId: attr(element, 'data-reference-id') }),
			},
		],
		toDOM: (node) => [
			'sup',
			{ 'data-ocp': 'citation', 'data-reference-id': String(node.attrs.referenceId) },
		],
	})

/** Tick rows: ProseKit's list node with kind 'check' and a point-of-care flag. */
const definePointOfCare = () =>
	defineNodeAttr<'list', 'pointOfCare', boolean>({
		type: 'list',
		attr: 'pointOfCare',
		default: false,
		splittable: true,
		toDOM: (value) => (value ? ['data-point-of-care', 'true'] : null),
		parseDOM: (element) => element.getAttribute('data-point-of-care') === 'true',
	})

const definePlaceholder = () =>
	defineMarkSpec<'placeholder', PlaceholderAttrs>({
		name: 'placeholder',
		attrs: { label: { validate: 'string' } },
		inclusive: false,
		excludes: 'placeholder',
		parseDOM: [
			{
				tag: 'mark[data-ocp="placeholder"]',
				getAttrs: (element) => ({ label: attr(element, 'data-label') }),
			},
		],
		toDOM: (mark) => [
			'mark',
			{ 'data-ocp': 'placeholder', 'data-label': String(mark.attrs.label) },
			0,
		],
	})

const defineSectionLink = () =>
	defineMarkSpec<'sectionLink', SectionLinkAttrs>({
		name: 'sectionLink',
		attrs: { address: { validate: 'string' } },
		inclusive: false,
		parseDOM: [
			{
				tag: 'a[data-ocp="section"]',
				getAttrs: (element) => ({ address: attr(element, 'data-address') }),
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
	})

// ---------------------------------------------------------------------------
// The schema extension
// ---------------------------------------------------------------------------

/**
 * Spec-only. The editor adds behaviour; the server adds nothing.
 *
 * ORDER MATTERS: ProseKit gives the LATEST definition the highest priority, so the
 * schema lists nodes in reverse of this union. ProseMirror fills an empty container
 * (`doc`, a table cell, a guidance box) with the FIRST block type in the schema, and
 * recurses without end if that type itself holds blocks. Paragraph is therefore
 * defined last, so it comes first. `schema.test.ts` pins this.
 */
export function defineContentSchema() {
	return union(
		defineDoc(),
		defineText(),
		defineHeadingSpec(),
		defineBlockquoteSpec(),
		defineHorizontalRuleSpec(),
		defineHardBreakSpec(),
		defineImageSpec(),
		defineTableSpec(),
		defineTableRowSpec(),
		defineTableCellSpec(),
		defineTableHeaderCellSpec(),
		defineListSpec(),
		definePointOfCare(),
		defineBoldSpec(),
		defineItalicSpec(),
		defineUnderlineSpec(),
		defineStrikeSpec(),
		defineSuperscriptSpec(),
		defineSubscriptSpec(),
		defineLinkSpec(),
		defineBanner(),
		defineTimeframe(),
		defineGuidance(),
		defineCitation(),
		definePlaceholder(),
		defineSectionLink(),
		defineParagraphSpec(), // last, so first in the schema (see above)
	)
}

export type ContentExtension = ReturnType<typeof defineContentSchema>
export type NodeName = keyof ExtractNodes<ContentExtension> & string
export type MarkName = keyof ExtractMarks<ContentExtension> & string

/** The block node names that carry durable identity in the editor. */
export const BLOCK_NODE_NAMES = [
	'paragraph',
	'heading',
	'blockquote',
	'horizontalRule',
	'image',
	'table',
	'list',
	'banner',
	'timeframe',
	'guidance',
] as const satisfies readonly NodeName[]

function buildSchema(): Schema {
	const schema = defineContentSchema().schema
	if (!schema) throw new Error('[content] the content extension declares no schema')
	return schema
}

/** The ProseMirror schema, for the server and the seed. The editor never uses this
 *  directly: it unions `defineContentSchema()` into its own extension. */
export const contentSchema: Schema = buildSchema()

/** The JSON form of a node, as stored in `sections.body_json` and served by the API. */
export interface JsonNode {
	type: NodeName
	attrs?: Record<string, string | number | boolean | null>
	content?: JsonNode[]
	text?: string
	marks?: JsonMark[]
}

export interface JsonMark {
	type: MarkName
	attrs?: Record<string, string | number | boolean | null>
}

/** Parses stored JSON into a node and checks it against the schema; throws if malformed. */
export function parseBody(json: unknown): PmNode {
	const node = PmNode.fromJSON(contentSchema, json)
	node.check()
	return node
}

export const emptyBody = (): JsonNode => ({ type: 'doc', content: [{ type: 'paragraph' }] })
