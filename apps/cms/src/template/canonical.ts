/**
 * The shape of Cancer Australia's 2026 templates as extracted: `template/2026/*.tagged-
 * canonical.json`, built from the PDFs' own logical structure trees (each template PDF is
 * tagged), verified heading by heading, tick row by tick row, and carried into this repo
 * as data. Only the fields the seed reads are typed here.
 *
 * Beside each canonical file sits `*.inline.json`: for every paragraph whose links or
 * citation markers the canonical build pulled out into blocks of their own, the
 * paragraph's full text in reading order and the runs it contains, keyed by the source
 * element's sequence number. It is derived once from the raw tagged extraction by
 * `scripts/derive-inline-runs.ts`.
 */

export type CanonicalKind = 'cancer' | 'population' | 'principles'

export interface CanonicalDocument {
	id: string
	kind: CanonicalKind
	title: string
	sourceFile: string
	consultationDate: string
	pageCount: number
}

export interface CanonicalSection {
	entryId: string
	parentEntryId: string | null
	headingText: string | null
	headingLevel: number | null
	printedNumber: string | null
	stepNumber: number | null
	address: string
	canonical: boolean
	orderIndex: number
	/** 'shared' = every pathway presents this text; 'pathway' = each pathway writes its own. */
	ownership: 'shared' | 'pathway'
}

export type CanonicalBlockType = 'narrative' | 'key_table' | 'checklist' | 'dev_box' | 'banner'

export interface CanonicalBlock {
	entryId: string
	sectionEntryId: string
	position: number
	blockType: CanonicalBlockType
	/** The PDF structure role: P, LBody, Lbl (a list marker), Span (an inline run), H3. */
	role: string
	textContent: string
	sourceElement: { seq: number; page: number }
}

export interface CanonicalChecklistItem {
	entryId: string
	blockEntryId: string
	text: string
}

export interface CanonicalEndnoteEntry {
	entryId: string
	printedNumber: number
	text: string
}

export interface CanonicalEndnoteMarker {
	entryId: string
	endnoteEntryId: string
	blockEntryId: string
	printedNumber: number
}

export interface CanonicalResource {
	entryId: string
	blockEntryId: string
	position: number
	title: string
	url: string
}

export interface CanonicalTimeframeComponent {
	blockEntryId: string
	statementText: string
	carePoint: string
}

export interface CanonicalEditableSlot {
	blockEntryId: string
	placeholderText: string
}

export interface CanonicalTemplate {
	document: CanonicalDocument
	sections: CanonicalSection[]
	blocks: CanonicalBlock[]
	checklistItems: CanonicalChecklistItem[]
	endnoteEntries: CanonicalEndnoteEntry[]
	endnoteMarkers: CanonicalEndnoteMarker[]
	resources: CanonicalResource[]
	timeframeComponents: CanonicalTimeframeComponent[]
	editableSlots: CanonicalEditableSlot[]
}

/** One paragraph's inline runs in reading order (see the file comment). */
export interface InlineParagraph {
	/** The full paragraph text, runs in place. */
	text: string
	/** The runs the canonical build holds as separate blocks: their source seq and text. */
	parts: { seq: number; text: string }[]
}

/** Keyed by the paragraph element's source seq, as a string (JSON object keys). */
export type InlineRuns = Record<string, InlineParagraph>
