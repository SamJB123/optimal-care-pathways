/**
 * The extracted document model — stage one's output (decision 44). A faithful record of
 * what a PDF SAYS and how it LOOKS, with no ProseMirror in it and no template grammar
 * applied: sections (from the heading structure), each holding typed blocks — paragraphs,
 * lists, tables, figures — whose text is runs carrying the marks the drawing gave them
 * (bold, italic, underline, superscript, colour, background highlight, link, footnote and
 * endnote references). Footnotes and endnotes are separate collections referenced from
 * the runs; artifacts (running headers, footers, page numbers) are excluded by the
 * structure tree.
 *
 * Stage two (the mapper) reads the template's grammar off this model — a green italic
 * run is developer guidance, a navy band is a title band, a yellow background is a
 * placeholder, a stopwatch figure opens a timeframe box — and emits the content schema.
 * The legacy (untagged) extractor targets THIS model too, so the mapper is shared.
 */

export interface TextRun {
	text: string
	bold: boolean
	italic: boolean
	underline: boolean
	/** Raised small text: an endnote marker, a footnote letter, an ordinal. */
	superscript: boolean
	subscript: boolean
	/** Font size in points. */
	size: number
	/** Text colour `#rrggbb`. */
	colour: string
	/** The fill drawn immediately behind this run (a highlight), when there is one. */
	background: string | null
	/** A hyperlink: an external URL, or an internal target page with the y (PDF space,
	 *  bottom-left origin) the destination points at when it gives one. */
	link: { url: string } | { page: number; y: number | null } | null
	/** Index into the document's footnotes (the run is the marker). */
	footnote: number | null
	/** Index into the document's endnotes (the run is the marker). */
	endnote: number | null
}

export type Alignment = 'left' | 'center' | 'right'

export interface Paragraph {
	kind: 'paragraph'
	runs: TextRun[]
	page: number
	/** The fill behind the whole paragraph's box, when it sits on shading. */
	background: string | null
	/** How the lines sit in their element: centred tiles and captions keep it. */
	align: Alignment
}

export type ListMarker = 'bullet' | 'dash' | 'check' | 'cross' | 'number' | 'other'

export interface ListItem {
	/** The printed marker, verbatim ("•", "–", "✓", "1."). */
	label: string
	marker: ListMarker
	blocks: Block[]
}

export interface List {
	kind: 'list'
	items: ListItem[]
	page: number
}

export interface TableCell {
	header: boolean
	rowSpan: number
	colSpan: number
	/** The dominant fill behind the cell's text, when shaded. */
	background: string | null
	blocks: Block[]
}

export interface TableRow {
	cells: TableCell[]
}

export interface Table {
	kind: 'table'
	rows: TableRow[]
	page: number
	/** The colour of the table's own border lines, when it has any. */
	border: string | null
}

export interface Figure {
	kind: 'figure'
	alt: string
	page: number
	/** Page-space box `[x0, y0, x1, y1]`. */
	bbox: [number, number, number, number] | null
}

export type Block = Paragraph | List | Table | Figure

export interface Section {
	/** Stable within a run of the extractor: `s` + sequence. */
	id: string
	/** Heading level from the structure tree (1–6). */
	level: number
	heading: TextRun[]
	headingText: string
	/** The printed number when the heading carries one ("1.1.2", "Step 3"). */
	number: string | null
	page: number
	/** The heading's baseline on its page (PDF space), for resolving internal links. */
	y: number
	/** The glyph printed beside the heading (a principle's icon), when there is one. */
	icon: Figure | null
	blocks: Block[]
	children: Section[]
}

export interface Footnote {
	/** The marker as printed ("b", "1"). */
	label: string
	page: number
	blocks: Block[]
}

export interface Endnote {
	number: number
	page: number
	runs: TextRun[]
}

export interface Warning {
	page: number
	message: string
}

export interface ExtractedDocument {
	source: string
	pages: number
	title: string
	/** The PDF's own creation date (its document information), ISO date; the last word on
	 *  a publication date when the print names none. */
	createdAt?: string
	/** Blocks before the first heading (a cover). */
	front: Block[]
	sections: Section[]
	footnotes: Footnote[]
	endnotes: Endnote[]
	warnings: Warning[]
}

export const plainText = (runs: TextRun[]): string => runs.map((r) => r.text).join('')
