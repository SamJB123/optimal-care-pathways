/**
 * The document workspace's contract: what every view on a document page — the section
 * views, the inspector, the hub, the wizard — reads from the shell. Kept apart from the
 * route module so the views depend on the contract, never on the route (no import
 * cycle), and the route provides it.
 */

import { createContext } from 'solid-js'
import type { DerivedView } from '#/content/derived.ts'
import { numberLabel } from '#/lib/labels.ts'
import type { DocumentWireRow, SectionWireRow } from '#/lib/live-topics.ts'
import type { PathwayClient } from '#/lib/ocp-client.ts'
import { ROLE_LADDER, type Role } from '#/lib/roles.ts'
import type { CommentWire } from '#/server/lifecycle-fns.ts'
import type { DocumentState } from '#/server/lifecycle.ts'

export type WorkspaceMode = 'edit' | 'review'
export type DiffView = 'marks' | 'clean'

/** What every section view on the stage needs: the outline, the room, the role, and
 *  where the document stands in its lifecycle. */
export interface DocumentWorkspace {
	documentId: string
	document: DocumentWireRow
	/** The caller's role on the document (a central member is at least a reviewer). */
	role: Role
	sections: () => SectionWireRow[]
	client: () => PathwayClient | null
	/** Citation numbers and the timeframe snapshot, as of the page load (decision 15, 50). */
	derived: DerivedView
	state: () => DocumentState
	refreshState: () => Promise<void>
	comments: () => CommentWire[]
	refreshComments: () => Promise<void>
	/** Editing, or reading the changes since the published version (decision 108). */
	mode: () => WorkspaceMode
	setMode: (mode: WorkspaceMode) => void
	/** The section the inspector is about. */
	focused: () => string | null
	focus: (sectionId: string | null) => void
	diffView: () => DiffView
	setDiffView: (view: DiffView) => void
	openPublish: () => void
}

/** Default-less: the context IS the provider, and reading it outside one throws. */
export const DocumentContext = createContext<DocumentWorkspace>()

export const atLeast = (role: Role, floor: Role): boolean =>
	ROLE_LADDER.indexOf(role) >= ROLE_LADDER.indexOf(floor)

/** A part of the document as the navigation shows it: a top-level section and its subtree. */
export interface Part {
	key: string
	label: string
	root: SectionWireRow
}

export function partsOf(sections: SectionWireRow[]): Part[] {
	return sections
		.filter((s) => s.parentId === null && !s.apparatus && !s.hidden)
		.sort((a, b) => a.orderIndex - b.orderIndex)
		.map((root) => ({
			key: root.address,
			label: root.printedNumber
				? `${numberLabel(root.printedNumber)} ${root.title ?? ''}`
				: (root.title ?? root.address),
			root,
		}))
}
