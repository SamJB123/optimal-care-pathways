/**
 * The section editor's ProseKit extension: the content schema (specs) plus the
 * behaviour of each of its parts — ProseKit's own commands, keymaps and input rules —
 * wrapped in the kit's collaboration layer.
 */

import {
	type CollaborativeExtensionOptions,
	createCollaborativeExtension,
} from '@aicolab/app-kit/prosekit/extension'
import {
	defineCommands,
	defineKeymap,
	definePlugin,
	Priority,
	union,
	withPriority,
} from '@prosekit/core'
import { type Command, Plugin, type Transaction } from '@prosekit/pm/state'
import { Decoration, DecorationSet } from '@prosekit/pm/view'
import {
	defineBlockquoteCommands,
	defineBlockquoteInputRule,
	defineBlockquoteKeymap,
} from '@prosekit/extensions/blockquote'
import {
	defineBoldCommands,
	defineBoldInputRule,
	defineBoldKeymap,
} from '@prosekit/extensions/bold'
import { defineHardBreakCommands, defineHardBreakKeymap } from '@prosekit/extensions/hard-break'
import {
	defineHeadingCommands,
	defineHeadingInputRule,
	defineHeadingKeymap,
} from '@prosekit/extensions/heading'
import {
	defineHorizontalRuleCommands,
	defineHorizontalRuleInputRule,
} from '@prosekit/extensions/horizontal-rule'
import { defineImageCommands } from '@prosekit/extensions/image'
import {
	defineItalicCommands,
	defineItalicInputRule,
	defineItalicKeymap,
} from '@prosekit/extensions/italic'
import {
	defineLinkCommands,
	defineLinkInputRule,
	defineLinkPasteRule,
} from '@prosekit/extensions/link'
import {
	defineListCommands,
	defineListInputRules,
	defineListKeymap,
	defineListPlugins,
} from '@prosekit/extensions/list'
import { defineParagraphCommands, defineParagraphKeymap } from '@prosekit/extensions/paragraph'
import {
	defineStrikeCommands,
	defineStrikeInputRule,
	defineStrikeKeymap,
} from '@prosekit/extensions/strike'
import { defineSubscriptCommands } from '@prosekit/extensions/subscript'
import { defineSuperscriptCommands } from '@prosekit/extensions/superscript'
import { defineTable } from '@prosekit/extensions/table'
import { defineTextAlignCommands, defineTextAlignKeymap } from '@prosekit/extensions/text-align'
import { defineUnderlineCommands, defineUnderlineKeymap } from '@prosekit/extensions/underline'
import { Fragment, Slice } from '@prosekit/pm/model'
import {
	createDedentListCommand,
	createIndentListCommand,
	createToggleListCommand,
} from 'prosemirror-flat-list'
import type { GuidanceMode } from '#/content/blocks.tsx'
import type { DerivedView } from '#/content/derived.ts'
import { BLOCK_NODE_NAMES, defineContentSchema } from '#/content/schema.ts'
import { defineTemplateNodeViews } from './node-views.tsx'

/** List toggles from the flat-list package, whose attribute type is open: ProseKit's
 *  typed `toggleList` names only its four kinds and not this system's 'check', nor the
 *  point-of-care attribute the schema adds. */
const defineListToggles = () =>
	defineCommands({
		toggleBulletList: () => createToggleListCommand({ kind: 'bullet' }),
		toggleOrderedList: () => createToggleListCommand({ kind: 'ordered' }),
		toggleCheckList: () => createToggleListCommand({ kind: 'check', pointOfCare: false }),
		toggleCheckListPointOfCare: () => createToggleListCommand({ kind: 'check', pointOfCare: true }),
	})

/** ProseKit's page-break command and keymap, written here because its module cannot be
 *  imported where the shared schema loads (see `definePageBreak` in content/schema.ts);
 *  the spec is the schema's. */
const definePageBreakBehaviour = () => {
	const insertPageBreak = () =>
		defineCommands({
			insertPageBreak: () => (state, dispatch) => {
				const type = state.schema.nodes.pageBreak
				if (!type) return false
				if (dispatch) {
					const pos = state.selection.anchor
					const slice = new Slice(Fragment.from(type.createChecked()), 0, 0)
					dispatch(state.tr.replaceRange(pos, pos, slice).scrollIntoView())
				}
				return true
			},
		})
	return union(
		insertPageBreak(),
		defineKeymap({
			'Mod-Enter': (state, dispatch) => {
				const type = state.schema.nodes.pageBreak
				if (!type) return false
				if (dispatch) {
					const pos = state.selection.anchor
					const slice = new Slice(Fragment.from(type.createChecked()), 0, 0)
					dispatch(state.tr.replaceRange(pos, pos, slice).scrollIntoView())
				}
				return true
			},
		}),
	)
}

/** The command, taken only when it changes the document: otherwise the key is left to
 *  the browser. */
const whenItChanges =
	(command: Command): Command =>
	(state, dispatch, view) => {
		const taken: Transaction[] = []
		command(state, (tr) => taken.push(tr), view)
		const tr = taken.at(-1)
		if (!tr?.docChanged) return false
		dispatch?.(tr)
		return true
	}

/** The keyboard always has a way out of the text (WCAG 2.1.2). Tab and Shift+Tab indent a
 *  list row where that changes the list, and move focus everywhere else; Escape leaves
 *  the text, and the next Tab carries on through the page from it. (Mod-] and Mod-[ indent
 *  as always.) Escape is the lowest binding, so an open menu's Escape closes the menu. */
const defineKeyboardExits = () =>
	union(
		withPriority(
			defineKeymap({
				Tab: whenItChanges(createIndentListCommand()),
				'Shift-Tab': whenItChanges(createDedentListCommand()),
			}),
			Priority.high,
		),
		withPriority(
			defineKeymap({
				Escape: (_state, _dispatch, view) => {
					if (!view) return false
					view.dom.blur()
					return true
				},
			}),
			Priority.lowest,
		),
	)

const ALIGNABLE = ['paragraph', 'heading', 'carePoint']

/** A citation straight after another is marked `data-joined` so the pair reads "26,27",
 *  as the published render marks it (CitationInline). */
function defineJoinedCitations() {
	return definePlugin(
		new Plugin({
			props: {
				decorations(state) {
					const marks: Decoration[] = []
					state.doc.descendants((node, pos) => {
						if (node.type.name !== 'citation') return
						if (state.doc.resolve(pos).nodeBefore?.type.name === 'citation')
							marks.push(Decoration.node(pos, pos + node.nodeSize, { 'data-joined': 'true' }))
					})
					return DecorationSet.create(state.doc, marks)
				},
			},
		}),
	)
}

/** A table cell always has a line to write on. A cell whose blocks are all guidance (the
 *  template's prompt for that cell, which a pathway shows in the margin and not in the
 *  text) has no place for a caret: a click in it lands nowhere. An empty paragraph goes
 *  after the guidance — what the template seed writes now, applied here to every draft
 *  written before it did, the moment the draft loads. */
function defineCellFloor() {
	return definePlugin(
		new Plugin({
			appendTransaction(transactions, _old, state) {
				if (!transactions.some((tr) => tr.docChanged)) return null
				const paragraph = state.schema.nodes.paragraph
				if (!paragraph) return null
				// Two drafts of the same old cell, each given its line at once, merge into a cell
				// with two blank lines: a cell whose own lines are all blank keeps exactly one,
				// so every copy settles on the same shape.
				const inserts: number[] = []
				const removals: { from: number; to: number }[] = []
				state.doc.descendants((node, pos) => {
					if (node.type.name !== 'tableCell' && node.type.name !== 'tableHeaderCell') return true
					const own: { from: number; to: number; blank: boolean }[] = []
					node.forEach((child, offset) => {
						if (child.type.name === 'guidance') return
						const from = pos + 1 + offset
						own.push({
							from,
							to: from + child.nodeSize,
							blank: child.type === paragraph && child.content.size === 0,
						})
					})
					if (own.length === 0) inserts.push(pos + node.nodeSize - 1)
					else if (own.length > 1 && own.every((line) => line.blank)) removals.push(...own.slice(1))
					return false
				})
				if (inserts.length === 0 && removals.length === 0) return null
				const tr = state.tr
				const edits = [
					...inserts.map((at) => ({ at, run: () => tr.insert(at, paragraph.create()) })),
					...removals.map((r) => ({ at: r.from, run: () => tr.delete(r.from, r.to) })),
				].sort((a, b) => b.at - a.at)
				for (const edit of edits) edit.run()
				return tr
			},
		}),
	)
}

/** Schema + behaviour. `defineTable()` also carries the table specs; ProseKit merges
 *  same-named specs, so the schema stays the one in content/schema.ts. `derived` is the
 *  page's derived view (citation numbers, timeframes) the node views read. */
export function defineSectionSchema(derived: () => DerivedView, guidance: GuidanceMode = 'inline') {
	return union(
		defineContentSchema(),
		defineTemplateNodeViews(derived, guidance),
		defineJoinedCitations(),
		defineTextAlignCommands(ALIGNABLE),
		defineTextAlignKeymap(ALIGNABLE),
		definePageBreakBehaviour(),
		defineParagraphCommands(),
		defineParagraphKeymap(),
		defineHeadingCommands(),
		defineHeadingKeymap(),
		defineHeadingInputRule(),
		defineBlockquoteCommands(),
		defineBlockquoteKeymap(),
		defineBlockquoteInputRule(),
		defineHorizontalRuleCommands(),
		defineHorizontalRuleInputRule(),
		defineHardBreakCommands(),
		defineHardBreakKeymap(),
		defineImageCommands(),
		defineTable(),
		defineCellFloor(),
		defineListCommands(),
		defineListKeymap(),
		defineListInputRules(),
		defineListPlugins(),
		defineListToggles(),
		defineKeyboardExits(),
		defineBoldCommands(),
		defineBoldKeymap(),
		defineBoldInputRule(),
		defineItalicCommands(),
		defineItalicKeymap(),
		defineItalicInputRule(),
		defineUnderlineCommands(),
		defineUnderlineKeymap(),
		defineStrikeCommands(),
		defineStrikeKeymap(),
		defineStrikeInputRule(),
		defineSuperscriptCommands(),
		defineSubscriptCommands(),
		defineLinkCommands(),
		defineLinkInputRule(),
		defineLinkPasteRule(),
	)
}

export type SectionSchemaExtension = ReturnType<typeof defineSectionSchema>

export function createSectionExtension(
	opts: Omit<
		CollaborativeExtensionOptions<SectionSchemaExtension>,
		'schema' | 'blockIdentityTypes'
	> & { derived: () => DerivedView; guidance: GuidanceMode },
) {
	const { derived, guidance, ...rest } = opts
	return createCollaborativeExtension({
		...rest,
		schema: defineSectionSchema(derived, guidance),
		blockIdentityTypes: BLOCK_NODE_NAMES,
	})
}
