/**
 * The document workspace's contract: what every view on a document page — the spine,
 * the section views, the margin, the toolbar, the overview, the wizard — reads from the
 * shell. Kept apart from the route module so the views depend on the contract, never on
 * the route (no import cycle), and the route provides it.
 */

import type { ToolbarItem } from '@aicolab/ui-solid/prosekit-solid'
import { createContext } from 'solid-js'
import type { GuidanceMode } from '#/content/blocks.tsx'
import type { DerivedView } from '#/content/derived.ts'
import type { JsonNode } from '#/content/schema.ts'
import { numberLabel } from '#/lib/labels.ts'
import type { DocumentWireRow, SectionWireRow } from '#/lib/live-topics.ts'
import type { PathwayClient } from '#/lib/ocp-client.ts'
import { spineOf } from '#/lib/outline.ts'
import { ROLE_LADDER, type Role } from '#/lib/roles.ts'
import type { DocumentState, SectionChange } from '#/server/lifecycle.ts'
import type { CommentWire } from '#/server/lifecycle-fns.ts'
import type { RestingBodies } from './bodies.ts'

export type WorkspaceMode = 'edit' | 'review'
export type DiffView = 'marks' | 'clean'
/** Review mode reads the changed sections only, or the whole text with them marked. */
export type ReviewScope = 'changed' | 'everything'

/** What the toolbar can do to the table the caret is in. */
export type TableAction =
	| 'rowAbove'
	| 'rowBelow'
	| 'columnBefore'
	| 'columnAfter'
	| 'deleteRow'
	| 'deleteColumn'
	| 'deleteTable'

/** One live section editor, as the page's single toolbar and the margin drive it. */
export interface EditorControl {
	sectionId: string
	/** The toolbar's items for this editor (reactive: active marks follow the caret). */
	toolbar: () => readonly ToolbarItem[]
	canUndo: () => boolean
	canRedo: () => boolean
	undo(): void
	redo(): void
	focus(): void
	/** The body as the editor holds it now. */
	body(): JsonNode
	/** Mark the `index`th guidance note (in reading order) done or not, as `by`. */
	setGuidanceDone(index: number, done: boolean, by: string): void
	/** Insert template content at the caret (the '/' menu, the Cite tool). */
	insert(nodes: JsonNode[]): void
	/** Apply a link, or a typed cross-reference, to the selection. */
	link(target: { href: string } | { address: string } | null): void
	/** Whether the caret sits in a check list, and flip that list's point-of-care flag. */
	inCheckList(): boolean
	checkListPointOfCare(): boolean
	toggleCheckListPointOfCare(): void
	/** The selected text, for a link's default wording. */
	selectedText(): string
	/** Whether the caret sits in a table, and the table edits the toolbar offers there. */
	inTable(): boolean
	tableAction(action: TableAction): void
}

/** One change since the published version, placed in the document. */
export interface ChangeEntry {
	change: SectionChange
	section: SectionWireRow
	/** The address of the part (top-level section) it sits in. */
	part: string
}

/** A change that needs the reader next, where the review stands: while a review is open,
 *  one it covers and nobody has decided; once it is decided, one sent back for changes;
 *  with no review, every change. */
export const needsAttention = (entry: ChangeEntry, review: DocumentState['review']): boolean => {
	const pinned = entry.change.decision
	if (!review) return true
	if (review.decision === null) return pinned !== null && pinned.decision === null
	return pinned?.decision === 'changes_requested'
}

/** Who else is in the document, and where. */
export interface PresenceEntry {
	userId: string
	name: string
	/** The section they are in, when they are in one. */
	sectionId: string | null
}

/** What every view on the page needs: the outline, the room, the role, where the document
 *  stands in its lifecycle, and where the reader is. */
export interface DocumentWorkspace {
	documentId: string
	document: DocumentWireRow
	/** The caller's role on the document (a central member is at least a reviewer). */
	role: Role
	sections: () => SectionWireRow[]
	client: () => PathwayClient | null
	/** The resting bodies this page knows (lifecycle/bodies.ts): primed by the part on
	 *  stage, read by every section view and the margin. */
	bodies: RestingBodies
	/** Citation numbers and the timeframe snapshot, as of the page load (decision 15, 50). */
	derived: DerivedView
	state: () => DocumentState
	refreshState: () => Promise<void>
	comments: () => CommentWire[]
	refreshComments: () => Promise<void>
	/** Editing, or reading the changes since the published version (decision 108). */
	mode: () => WorkspaceMode
	setMode: (mode: WorkspaceMode) => void
	/** Into review mode; from anywhere but a part, at the first change that needs
	 *  attention. */
	startReview: () => void
	reviewScope: () => ReviewScope
	setReviewScope: (scope: ReviewScope) => void
	/** The changes in reading order, each with the part it sits in. */
	changeOrder: () => ChangeEntry[]
	/** To the next (1) or previous (-1) change that needs attention (`needsAttention`),
	 *  from the section the margin is on, wrapping; J and K. False when there is none. */
	goToChange: (direction: 1 | -1) => boolean
	/** The section the margin is about: the one pinned by a click, else the one at the
	 *  reading line. */
	focused: () => string | null
	/** Pin the margin to a section (a click into it); null follows the reading again. */
	focus: (sectionId: string | null) => void
	pinned: () => string | null
	/** The section at the reading line as the page scrolls. */
	setReading: (sectionId: string | null) => void
	diffView: () => DiffView
	setDiffView: (view: DiffView) => void
	openPublish: () => void
	/** Open the "Ask for review" sheet. */
	openRequestReview: () => void
	/** Guidance on this document: in place (a core template) or in the margin (a pathway). */
	guidance: GuidanceMode
	/** Hidden sections shown struck through (the spine's switch), or left out. */
	showHidden: () => boolean
	setShowHidden: (show: boolean) => void
	/** The live editors on the page, and the one the toolbar acts on. */
	editors: {
		register(control: EditorControl): () => void
		get(sectionId: string): EditorControl | undefined
		active: () => EditorControl | null
		activate(sectionId: string): void
	}
	presence: () => PresenceEntry[]
	/** The reader's own name, for "Done · name · date". */
	selfName: () => string
}

/** Default-less: the context IS the provider, and reading it outside one throws. */
export const DocumentContext = createContext<DocumentWorkspace>()

export const atLeast = (role: Role, floor: Role): boolean =>
	ROLE_LADDER.indexOf(role) >= ROLE_LADDER.indexOf(floor)

/** A part of the document as the spine shows it: a top-level section and its subtree. */
export interface Part {
	key: string
	label: string
	root: SectionWireRow
}

/** The heading of a section as the page sets it. */
export const sectionLabel = (
	s: Pick<SectionWireRow, 'printedNumber' | 'title' | 'address'>,
): string =>
	s.printedNumber
		? `${numberLabel(s.printedNumber)} ${s.title ?? ''}`.trim()
		: (s.title ?? s.address)

/** The document's parts in reading order. Apparatus (the cover banner, the contents page)
 *  is never a part; a hidden part is one only while hidden sections are shown. */
export function partsOf(sections: SectionWireRow[], showHidden = false): Part[] {
	return spineOf(sections, (s) => !s.apparatus && (showHidden || !s.hidden))
		.flatMap((band) => band.roots)
		.map((root) => ({ key: root.address, label: sectionLabel(root), root }))
}

/** A section's standing, in the spine's marks (decision U13). In a pathway: shared from
 *  the core (○), its own copy of a shared section (◐), written for it (●). In a core
 *  template the same marks say what a pathway gets (the ownership legend): read by every
 *  pathway as written (○), a scaffold each pathway writes its own (◑), or the template's
 *  instructions to authors (◇). */
export type SectionMark = 'shared' | 'diverged' | 'owned' | 'scaffold' | 'instructions'
export const markOf = (
	s: Pick<SectionWireRow, 'ownership' | 'coreSectionId' | 'pathwayOwnership' | 'instructions'>,
): SectionMark =>
	s.instructions
		? 'instructions'
		: s.pathwayOwnership !== null
			? s.pathwayOwnership === 'shared'
				? 'shared'
				: 'scaffold'
			: s.ownership === 'shared'
				? 'shared'
				: s.coreSectionId
					? 'diverged'
					: 'owned'
export const MARK_GLYPH: Record<SectionMark, string> = {
	shared: '○',
	diverged: '◐',
	owned: '●',
	scaffold: '◑',
	instructions: '◇',
}
export const MARK_WORDS: Record<SectionMark, string> = {
	shared: 'Shared: every pathway reads it as written',
	diverged: 'This pathway’s own copy of a shared section',
	owned: 'Written for this document',
	scaffold: 'A scaffold: each pathway writes its own',
	instructions: 'Instructions to the people writing a pathway',
}
