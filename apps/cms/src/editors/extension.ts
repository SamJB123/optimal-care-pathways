/**
 * The section editor's ProseKit extension: the content schema (specs) plus the
 * behaviour of each of its parts — ProseKit's own commands, keymaps and input rules —
 * wrapped in the kit's collaboration layer.
 */

import {
	type CollaborativeExtensionOptions,
	createCollaborativeExtension,
} from '@aicolab/app-kit/prosekit/extension'
import { defineCommands, union } from '@prosekit/core'
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
import { defineUnderlineCommands, defineUnderlineKeymap } from '@prosekit/extensions/underline'
import { createToggleListCommand } from 'prosemirror-flat-list'
import { BLOCK_NODE_NAMES, defineContentSchema } from '#/content/schema.ts'

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

/** Schema + behaviour. `defineTable()` also carries the table specs; ProseKit merges
 *  same-named specs, so the schema stays the one in content/schema.ts. */
export function defineSectionSchema() {
	return union(
		defineContentSchema(),
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
		defineListCommands(),
		defineListKeymap(),
		defineListInputRules(),
		defineListPlugins(),
		defineListToggles(),
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
	>,
) {
	return createCollaborativeExtension({
		...opts,
		schema: defineSectionSchema(),
		blockIdentityTypes: BLOCK_NODE_NAMES,
	})
}
