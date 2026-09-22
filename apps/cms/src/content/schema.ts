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
 *   box                         a bordered or shaded box: `kind` says what it is for
 *                               (developer, resources, seeAlso, actions, communication,
 *                               considerations, callout, plain), `icon` names the glyph
 *                               on its band and `family` may name a theme colour (a
 *                               tile's shading); holds a banner and the box's content
 *   columns / column            side-by-side layout: tiles, icon grids, paired boxes
 *   resource                    a Find out more / See also entry: `title`, `url`, and a
 *                               description
 *   pathwayMap (atom)           the steps schematic, derived from the document's steps
 *   banner                      the title band of a box ("Signs and symptoms of cancer");
 *                               `tone` 'sub' is a light group header inside a box
 *   list.icon                   an icon-and-text row's glyph, on the list item
 *   tableCell.background        a shaded cell's theme colour family
 *   textAlign                   ProseKit's alignment attribute on paragraphs and headings
 *   pageBreak, mention          ProseKit's, adopted for print and cross-reference entry
 *   variants / variant          mutually exclusive alternatives the template offers
 *                               ("Or" rows); an author keeps one
 *   timeframe                   a timeframe box: a care point ("Timeframe for referral to a
 *                               cancer specialist") and its statement, or variants of it
 *   carePoint                   the timeframe's first child: the care point as marked text
 *                               (the template prints placeholders inside it)
 *   timeframeSnapshot (atom)    the "Snapshot of optimal timeframes" schematic, derived at
 *                               render from the document's timeframe boxes (decision 50)
 *   guidance                    a green/purple developer instruction to the author,
 *                               never published
 *   citation (inline atom)      a reference to a row of the document's references table.
 *                               Its number is derived at render, so it cannot go stale
 *   footnote (inline atom)      a note printed at the foot of the page in the source,
 *                               carried with its marker
 *   placeholder (mark)          the template's editable slots ("[cancer type]")
 *   instruction (mark)          a developer instruction INSIDE a core sentence ("<for
 *                               prostate cancer OCP only add: …>"), never published
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
import { defineMentionSpec } from '@prosekit/extensions/mention'
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

/** What a box is for, read off the template's icons and shading. */
export const BOX_KINDS = [
	'developer',
	'resources',
	'seeAlso',
	'actions',
	'communication',
	'considerations',
	/** A shaded statement with no heading band. */
	'callout',
	/** A bordered box headed by a banner, with no icon of its own. */
	'plain',
] as const
export type BoxKind = (typeof BOX_KINDS)[number]

export interface BoxAttrs {
	kind: BoxKind
	/** The glyph on the band, as the template names it: pen, info, hand, clipboard,
	 *  speech, care, stopwatch; empty when there is none. */
	icon: string
	/** A theme colour family overriding the kind's own (a tile's shading); '' = the kind's. */
	family: string
}

/** The theme's colour families a block may name (ui-solid's `colorBase` values). */
export const COLOR_FAMILIES = [
	'primary',
	'secondary',
	'accent',
	'neutral',
	'info',
	'success',
	'warning',
	'error',
] as const
export type ColorFamily = (typeof COLOR_FAMILIES)[number]
export const isColorFamily = (value: string): value is ColorFamily =>
	(COLOR_FAMILIES as readonly string[]).includes(value)

export interface BannerAttrs {
	/** 'band' = the box's navy title band; 'sub' = a light group header inside a box. */
	tone: 'band' | 'sub'
}

export interface ResourceAttrs {
	title: string
	/** A URL, a `#address` section reference, or '' when the source printed a placeholder. */
	url: string
}

export interface GuidanceAttrs {
	/** Marked done by an author: the box collapses and stops counting as an open item. */
	done: boolean
}

export interface CitationAttrs {
	referenceId: string
}

export interface PlaceholderAttrs {
	label: string
}

export interface FootnoteAttrs {
	/** The note's text, as printed at the foot of the source page. */
	text: string
}

export interface SectionLinkAttrs {
	address: string
}

const attr = (element: HTMLElement, name: string) => element.getAttribute(name) ?? ''

/**
 * Paint comes from ui-solid's colour resolver: a block names its colour FAMILY and
 * VARIANT with the package's own attributes, and the theme (light or dark) supplies
 * the surface, ink and border. No block names a colour of its own.
 */
const ui = (base: string, variant: 'solid' | 'soft' | 'outline') => ({
	'data-ui-color-base': base,
	'data-ui-color-variant': variant,
})

/** The colour family each box kind is painted in. */
const BOX_FAMILY: Record<BoxKind, string> = {
	developer: 'success',
	resources: 'info',
	seeAlso: 'info',
	actions: 'secondary',
	communication: 'secondary',
	considerations: 'secondary',
	callout: 'info',
	plain: 'secondary',
}

const isBoxKind = (value: string): value is BoxKind =>
	(BOX_KINDS as readonly string[]).includes(value)

/** A box's attributes read off loose node attributes (JSON, a ProseMirror node). */
export const boxAttrsOf = (attrs: Record<string, unknown>): BoxAttrs => ({
	kind: typeof attrs.kind === 'string' && isBoxKind(attrs.kind) ? attrs.kind : 'callout',
	icon: typeof attrs.icon === 'string' ? attrs.icon : '',
	family: typeof attrs.family === 'string' ? attrs.family : '',
})

/** The family a box paints in: its own, else its kind's (decision 60). */
export const boxFamily = (attrs: { kind: string; family: string }): ColorFamily => {
	if (isColorFamily(attrs.family)) return attrs.family
	const kind = attrs.kind
	const family = isBoxKind(kind) ? BOX_FAMILY[kind] : 'info'
	return isColorFamily(family) ? family : 'info'
}

const defineBanner = () =>
	defineNodeSpec<'banner', BannerAttrs>({
		name: 'banner',
		content: 'inline*',
		group: 'block',
		defining: true,
		attrs: { tone: { default: 'band', validate: 'string' } },
		parseDOM: [
			{
				tag: 'p[data-ocp="banner"]',
				getAttrs: (element) => ({ tone: attr(element, 'data-tone') === 'sub' ? 'sub' : 'band' }),
			},
		],
		toDOM: (node) => {
			const tone = node.attrs.tone === 'sub' ? 'sub' : 'band'
			return [
				'p',
				{
					'data-ocp': 'banner',
					'data-tone': tone,
					...ui('secondary', tone === 'sub' ? 'soft' : 'solid'),
				},
				0,
			]
		},
	})

const defineBox = () =>
	defineNodeSpec<'box', BoxAttrs>({
		name: 'box',
		content: 'block+',
		group: 'block',
		defining: true,
		attrs: {
			kind: { default: 'callout', validate: 'string' },
			icon: { default: '', validate: 'string' },
			family: { default: '', validate: 'string' },
		},
		parseDOM: [
			{
				tag: 'section[data-ocp="box"]',
				getAttrs: (element) => ({
					kind: attr(element, 'data-kind'),
					icon: attr(element, 'data-icon'),
					family: attr(element, 'data-family'),
				}),
			},
		],
		toDOM: (node) => {
			const kind = String(node.attrs.kind)
			const own = String(node.attrs.family)
			const family = isColorFamily(own) ? own : isBoxKind(kind) ? BOX_FAMILY[kind] : 'info'
			return [
				'section',
				{
					'data-ocp': 'box',
					'data-kind': kind,
					'data-icon': String(node.attrs.icon),
					'data-family': own,
					...ui(family, kind === 'callout' ? 'soft' : 'outline'),
				},
				0,
			]
		},
	})

/** Side-by-side layout: the template's tiles, icon grids and paired boxes. Each column
 *  holds blocks; the grid gives every column an equal share. */
const defineColumns = () =>
	defineNodeSpec({
		name: 'columns',
		content: 'column+',
		group: 'block',
		defining: true,
		parseDOM: [{ tag: 'div[data-ocp="columns"]' }],
		toDOM: () => ['div', { 'data-ocp': 'columns' }, 0],
	})

const defineColumn = () =>
	defineNodeSpec({
		name: 'column',
		content: 'block+',
		defining: true,
		parseDOM: [{ tag: 'div[data-ocp="column"]' }],
		toDOM: () => ['div', { 'data-ocp': 'column' }, 0],
	})

/** The entries of a Find out more / See also box, as one list (a RichList in the
 *  view): consecutive entries in the source become one of these. */
const defineResourceList = () =>
	defineNodeSpec({
		name: 'resourceList',
		content: 'resource+',
		group: 'block',
		defining: true,
		parseDOM: [{ tag: 'ul[data-ocp="resourceList"]' }],
		toDOM: () => ['ul', { 'data-ocp': 'resourceList' }, 0],
	})

/** A Find out more / See also entry: a titled link with a description (decision 64). */
const defineResource = () =>
	defineNodeSpec<'resource', ResourceAttrs>({
		name: 'resource',
		content: 'block*',
		defining: true,
		attrs: {
			title: { default: '', validate: 'string' },
			url: { default: '', validate: 'string' },
		},
		parseDOM: [
			{
				tag: 'li[data-ocp="resource"]',
				getAttrs: (element) => ({
					title: attr(element, 'data-title'),
					url: attr(element, 'data-url'),
				}),
			},
		],
		toDOM: (node) => {
			const title = String(node.attrs.title)
			const url = String(node.attrs.url)
			return [
				'li',
				{ 'data-ocp': 'resource', 'data-title': title, 'data-url': url },
				url === ''
					? ['span', { class: 'ocp-resource-title' }, title]
					: ['a', { class: 'ocp-resource-title', href: url }, title],
				['div', { class: 'ocp-resource-body' }, 0],
			]
		},
	})

/** The pathway map: derived from the document's steps at render (decisions 63, 67–74). */
const definePathwayMap = () =>
	defineNodeSpec({
		name: 'pathwayMap',
		group: 'block',
		atom: true,
		selectable: true,
		parseDOM: [{ tag: 'div[data-ocp="pathwayMap"]' }],
		toDOM: () => ['div', { 'data-ocp': 'pathwayMap' }],
	})

/** Rows of [icon | text] carry the icon on the list item (decision 59). */
const defineListIcon = () =>
	defineNodeAttr<'list', 'icon', string>({
		type: 'list',
		attr: 'icon',
		default: '',
		splittable: false,
		// The icon reaches the DOM as a custom property, the one form CSS can paint from
		// (a url may not come out of attr()); the marker rule in section.css reads it.
		toDOM: (value) => (value ? ['style', `--ocp-list-icon: url("${encodeURI(value)}")`] : null),
		parseDOM: (element) => {
			const m = /^url\("(.*)"\)$/.exec(element.style.getPropertyValue('--ocp-list-icon').trim())
			return m?.[1] ? decodeURI(m[1]) : ''
		},
	})

/** Shaded cells name a theme family (decision 60), never a colour. */
const defineCellBackground = (type: 'tableCell' | 'tableHeaderCell') =>
	defineNodeAttr<typeof type, 'background', string>({
		type,
		attr: 'background',
		default: '',
		toDOM: (value) => (isColorFamily(value) ? ['data-background', value] : null),
		parseDOM: (element) => element.getAttribute('data-background') ?? '',
	})

/** ProseKit's TextAlign attribute, spec-only (its commands and keymap join in the editor). */
const defineTextAlignAttr = (type: 'paragraph' | 'heading' | 'carePoint') =>
	defineNodeAttr<typeof type, 'textAlign', string | null>({
		type,
		attr: 'textAlign',
		default: null,
		splittable: true,
		toDOM: (value) => (value ? ['style', `text-align:${value};`] : null),
		parseDOM: (element) => element.style.getPropertyValue('text-align') || null,
	})

const defineVariants = () =>
	defineNodeSpec({
		name: 'variants',
		content: 'variant+',
		group: 'block',
		defining: true,
		parseDOM: [{ tag: 'div[data-ocp="variants"]' }],
		toDOM: () => ['div', { 'data-ocp': 'variants' }, 0],
	})

const defineVariant = () =>
	defineNodeSpec({
		name: 'variant',
		content: 'block+',
		defining: true,
		parseDOM: [{ tag: 'div[data-ocp="variant"]' }],
		toDOM: () => ['div', { 'data-ocp': 'variant' }, 0],
	})

const defineTimeframe = () =>
	defineNodeSpec({
		name: 'timeframe',
		content: 'carePoint block+',
		group: 'block',
		defining: true,
		parseDOM: [{ tag: 'aside[data-ocp="timeframe"]' }],
		toDOM: () => ['aside', { 'data-ocp': 'timeframe', ...ui('error', 'outline') }, 0],
	})

const defineCarePoint = () =>
	defineNodeSpec({
		name: 'carePoint',
		content: 'inline*',
		defining: true,
		parseDOM: [{ tag: 'p[data-ocp="carePoint"]' }],
		toDOM: () => ['p', { 'data-ocp': 'carePoint' }, 0],
	})

/** The snapshot schematic is a view over the document's timeframes, never authored. */
const defineTimeframeSnapshot = () =>
	defineNodeSpec({
		name: 'timeframeSnapshot',
		group: 'block',
		atom: true,
		selectable: true,
		parseDOM: [{ tag: 'div[data-ocp="timeframeSnapshot"]' }],
		toDOM: () => ['div', { 'data-ocp': 'timeframeSnapshot', ...ui('error', 'outline') }],
	})

const defineGuidance = () =>
	defineNodeSpec<'guidance', GuidanceAttrs>({
		name: 'guidance',
		content: 'block+',
		group: 'block',
		defining: true,
		attrs: { done: { default: false, validate: 'boolean' } },
		parseDOM: [
			{
				tag: 'aside[data-ocp="guidance"]',
				getAttrs: (element) => ({ done: element.getAttribute('data-done') === 'true' }),
			},
		],
		toDOM: (node) => [
			'aside',
			{
				'data-ocp': 'guidance',
				'data-done': node.attrs.done ? 'true' : 'false',
				...ui('success', 'soft'),
			},
			0,
		],
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

const defineFootnote = () =>
	defineNodeSpec<'footnote', FootnoteAttrs>({
		name: 'footnote',
		inline: true,
		group: 'inline',
		atom: true,
		selectable: true,
		attrs: { text: { validate: 'string' } },
		parseDOM: [
			{
				tag: 'sup[data-ocp="footnote"]',
				getAttrs: (element) => ({ text: attr(element, 'data-text') }),
			},
		],
		toDOM: (node) => ['sup', { 'data-ocp': 'footnote', 'data-text': String(node.attrs.text) }],
	})

const defineInstruction = () =>
	defineMarkSpec({
		name: 'instruction',
		inclusive: false,
		excludes: 'instruction',
		parseDOM: [{ tag: 'span[data-ocp="instruction"]' }],
		toDOM: () => ['span', { 'data-ocp': 'instruction' }, 0],
	})

/** Figures carry their alternative text (ProseKit's image node has only src and size). */
const defineImageAlt = () =>
	defineNodeAttr<'image', 'alt', string>({
		type: 'image',
		attr: 'alt',
		default: '',
		toDOM: (value) => (value ? ['alt', value] : null),
		parseDOM: (element) => element.getAttribute('alt') ?? '',
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
			{
				'data-ocp': 'placeholder',
				'data-label': String(mark.attrs.label),
				...ui('warning', 'soft'),
			},
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
 * ProseKit's page break, as its `definePageBreakSpec` writes it (name, DOM class and the
 * `pageBreak` flag its page rendering keys on), defined here because ProseKit's page
 * module registers a custom element at load and so cannot be imported where the Worker
 * builds this schema. The editor unions ProseKit's page-break commands and keymap.
 */
function definePageBreak() {
	return defineNodeSpec({
		name: 'pageBreak',
		group: 'block',
		selectable: true,
		parseDOM: [{ tag: 'div.prosekit-page-break' }],
		toDOM: () => ['div', { class: 'prosekit-horizontal-rule prosekit-page-break' }, ['hr']],
		pageBreak: true,
	})
}

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
		defineImageAlt(),
		defineTableSpec(),
		defineTableRowSpec(),
		defineTableCellSpec(),
		defineTableHeaderCellSpec(),
		defineCellBackground('tableCell'),
		defineCellBackground('tableHeaderCell'),
		defineListSpec(),
		definePointOfCare(),
		defineListIcon(),
		definePageBreak(),
		defineMentionSpec(),
		defineBoldSpec(),
		defineItalicSpec(),
		defineUnderlineSpec(),
		defineStrikeSpec(),
		defineSuperscriptSpec(),
		defineSubscriptSpec(),
		defineLinkSpec(),
		defineBox(),
		defineColumns(),
		defineColumn(),
		defineVariants(),
		defineVariant(),
		defineBanner(),
		defineTimeframe(),
		defineCarePoint(),
		defineTimeframeSnapshot(),
		definePathwayMap(),
		defineResourceList(),
		defineResource(),
		defineGuidance(),
		defineCitation(),
		defineFootnote(),
		definePlaceholder(),
		defineInstruction(),
		defineSectionLink(),
		defineParagraphSpec(), // last, so first in the schema (see above)
		defineTextAlignAttr('paragraph'),
		defineTextAlignAttr('heading'),
		defineTextAlignAttr('carePoint'),
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
	'box',
	'columns',
	'variants',
	'banner',
	'timeframe',
	'timeframeSnapshot',
	'pathwayMap',
	'resourceList',
	'resource',
	'guidance',
	'pageBreak',
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
