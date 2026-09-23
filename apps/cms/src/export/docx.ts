/**
 * The draft as a Word file (the workspace's "Download as Word"): what would publish if
 * the draft were published now — each live section's publishable body in outline order,
 * headed by its printed number and title — then the references it cites, every page
 * marked as a draft. Pure: the route (routes/d.$documentId.draft[.]docx.ts) reads the
 * draft, its references and its images; this module only writes the file, so the node
 * tests build one from bodies alone.
 *
 * Every node and mark of the content schema has a Word form, walked the way
 * `bodyToMarkdown` walks a body. Tables are Word tables; a box is a one-cell bordered
 * table in its family's colour, its banner the bold first line; a timeframe the same in
 * the timeframe red, its care point first; guidance (which reaches here only for a core
 * template, the one kind that publishes it) a shaded box headed "Drafting guidance";
 * columns a borderless table; the "Or" alternatives indented under a dotted rule with
 * "Or" between them; lists real Word numbering (check rows ✓ or ✗, task rows ☑ or ☐, an
 * icon row its icon); resources bulleted titled links over their description; the
 * snapshot of optimal timeframes a table off the derived view. Marks become run
 * formatting, links hyperlinks, a cross-reference its visible text, a placeholder
 * highlighted text; citations are superscript numbers as the page numbers them ("26,27"
 * for a joined run) and footnotes Word footnotes. Images are embedded, sized to the
 * width they sit in; a format Word cannot take here (SVG, WebP) prints its alt text in
 * brackets.
 */

import {
	AlignmentType,
	BorderStyle,
	Document,
	ExternalHyperlink,
	FootnoteReferenceRun,
	Header,
	HeadingLevel,
	type IBorderOptions,
	type ILevelsOptions,
	ImageRun,
	type IParagraphOptions,
	type IRunPropertiesOptions,
	LevelFormat,
	Packer,
	PageBreak,
	Paragraph,
	type ParagraphChild,
	ShadingType,
	Tab,
	Table,
	TableBorders,
	TableCell,
	TableRow,
	TextRun,
	WidthType,
} from 'docx'
import { type DerivedView, walkNodes } from '#/content/derived.ts'
import { hrefOf, type ListedReference, printedAddress } from '#/content/references.tsx'
import {
	boxAttrsOf,
	boxFamily,
	type ColorFamily,
	guidanceAttrsOf,
	isColorFamily,
	type JsonMark,
	type JsonNode,
} from '#/content/schema.ts'
import { imprintDate, numberLabel } from '#/lib/labels.ts'

/** A live section of the draft, in outline order. */
export interface DocxSection {
	/** Depth in the outline: 0 for a top-level part (Word's Heading 1). */
	depth: number
	printedNumber: string | null
	title: string
	/** The heading's own citation markers, printed after it as the page prints them. */
	titleCitations: readonly string[]
	/** The body as it would publish. */
	body: JsonNode | null
}

export interface DraftDocxInput {
	title: string
	/** The draft's version number: the edition it becomes when published. */
	editionNo: number
	exportedAt: number
	exportedBy: string
	/** Where the site lives, so a link written as a path ("/p/…") works from Word. */
	origin: string
	sections: DocxSection[]
	derived: DerivedView
	/** Every cited reference, numbered as the bodies cite them. */
	references: ListedReference[]
	/** An image's bytes by its `src`, or null when they cannot be read. */
	loadImage(src: string): Promise<Uint8Array | null>
}

// ---------------------------------------------------------------------------
// Page and paint
// ---------------------------------------------------------------------------

/** A4 with 2 cm margins, in twentieths of a point (twips). */
const PAGE = { width: 11906, height: 16838, margin: 1134 }
const TEXT_WIDTH = PAGE.width - 2 * PAGE.margin
/** Images are sized in pixels at 96 dpi: 15 twips to the pixel. */
const TWIPS_PER_PX = 15
const MAX_IMAGE_HEIGHT_PX = 860
const ICON_PX = 28
/** One step of indent: a list level, a quote, the alternatives. */
const INDENT = 360
const CELL_MARGINS = { top: 80, bottom: 80, left: 120, right: 120 }
const BOX_MARGINS = { top: 120, bottom: 120, left: 160, right: 160 }

/** The theme's colour families (theme.css, light scheme): the ink for a border, a band
 *  or marked text, the soft tint for a shaded cell or box. */
const INK: Record<ColorFamily, string> = {
	primary: '244A8F',
	secondary: '1D2B57',
	accent: '6A4C9C',
	neutral: '5B6170',
	info: '3A6FB0',
	success: '0D7A3A',
	warning: 'A87800',
	error: 'B8323C',
}
const SOFT: Record<ColorFamily, string> = {
	primary: 'E3E9F3',
	secondary: 'E1E4EC',
	accent: 'EDE8F4',
	neutral: 'EEEFF1',
	info: 'E5EDF6',
	success: 'E0F0E6',
	warning: 'FFF3CC',
	error: 'F7E3E4',
}
const RULE = 'A0A4AD'
const MUTED = '555B66'
const HEADER_FILL = 'EEF0F3'

const HEADINGS = [
	HeadingLevel.HEADING_1,
	HeadingLevel.HEADING_2,
	HeadingLevel.HEADING_3,
	HeadingLevel.HEADING_4,
	HeadingLevel.HEADING_5,
	HeadingLevel.HEADING_6,
] as const

const headingAt = (level: number) => HEADINGS[Math.min(6, Math.max(1, level)) - 1] ?? HeadingLevel.HEADING_6

const line = (color: string, size = 8): IBorderOptions => ({ style: BorderStyle.SINGLE, size, color })
const around = (border: IBorderOptions) => ({ top: border, bottom: border, left: border, right: border })
const fill = (color: string) => ({ type: ShadingType.CLEAR, color: 'auto', fill: color })

const ALIGN = {
	left: AlignmentType.LEFT,
	center: AlignmentType.CENTER,
	right: AlignmentType.RIGHT,
	justify: AlignmentType.JUSTIFIED,
} as const
const alignOf = (value: unknown) =>
	value === 'left' || value === 'center' || value === 'right' || value === 'justify' ? ALIGN[value] : undefined

const str = (value: unknown): string => (typeof value === 'string' ? value : '')
const num = (value: unknown): number | null => (typeof value === 'number' && value > 0 ? value : null)

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

interface Picture {
	type: 'png' | 'jpg' | 'gif' | 'bmp'
	data: Uint8Array
	width: number
	height: number
}

const u16be = (b: Uint8Array, i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0)
const u16le = (b: Uint8Array, i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8)
const u32be = (b: Uint8Array, i: number) => u16be(b, i) * 65536 + u16be(b, i + 2)
const u32le = (b: Uint8Array, i: number) => u16le(b, i) + u16le(b, i + 2) * 65536

/** JPEG's start-of-frame markers, which carry the image's size. */
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

/** An image Word can embed, read off its bytes (never its name or declared type); null
 *  for anything else. */
export function pictureOf(data: Uint8Array): Picture | null {
	if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47)
		return { type: 'png', data, width: u32be(data, 16), height: u32be(data, 20) }
	if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46)
		return { type: 'gif', data, width: u16le(data, 6), height: u16le(data, 8) }
	if (data[0] === 0x42 && data[1] === 0x4d)
		return { type: 'bmp', data, width: u32le(data, 18), height: Math.abs(u32le(data, 22) | 0) }
	if (data[0] === 0xff && data[1] === 0xd8) {
		let i = 2
		while (i + 9 < data.length) {
			if (data[i] !== 0xff) return null
			const marker = data[i + 1] ?? 0
			if (marker === 0xff) {
				i++
				continue
			}
			if (SOF.has(marker)) return { type: 'jpg', data, width: u16be(data, i + 7), height: u16be(data, i + 5) }
			i += 2 + u16be(data, i + 2)
		}
	}
	return null
}

/** Every image a body shows: figures and the icons of icon rows. */
function imageSources(bodies: (JsonNode | null)[]): Set<string> {
	const sources = new Set<string>()
	for (const body of bodies) {
		if (!body) continue
		walkNodes(body, (n) => {
			if (n.type === 'image' && str(n.attrs?.src)) sources.add(str(n.attrs?.src))
			if (n.type === 'list' && str(n.attrs?.icon)) sources.add(str(n.attrs?.icon))
		})
	}
	return sources
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

const LEVELS = [0, 1, 2, 3, 4, 5, 6, 7, 8]

const glyphLevels = (glyphs: string[], color?: string): ILevelsOptions[] =>
	LEVELS.map((level) => ({
		level,
		format: LevelFormat.BULLET,
		text: glyphs[level % glyphs.length] ?? '•',
		alignment: AlignmentType.LEFT,
		style: {
			paragraph: { indent: { left: INDENT * (level + 1), hanging: INDENT } },
			...(color ? { run: { color, bold: true } } : {}),
		},
	}))

/** The bullet and tick numberings every document carries; an ordered run adds its own
 *  so it counts from its own start. */
const BASE_NUMBERING = [
	{ reference: 'bullet', levels: glyphLevels(['•', '◦', '▪']) },
	{ reference: 'check', levels: glyphLevels(['✓'], INK.primary) },
	{ reference: 'cross', levels: glyphLevels(['✗'], INK.error) },
	{ reference: 'task-done', levels: glyphLevels(['☑']) },
	{ reference: 'task-open', levels: glyphLevels(['☐']) },
]

const ORDERED_FORMATS = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN] as const

const orderedLevels = (startLevel: number, start: number): ILevelsOptions[] =>
	LEVELS.map((level) => ({
		level,
		format: ORDERED_FORMATS[level % ORDERED_FORMATS.length] ?? LevelFormat.DECIMAL,
		text: `%${level + 1}.`,
		start: level === startLevel ? start : 1,
		alignment: AlignmentType.LEFT,
		style: { paragraph: { indent: { left: INDENT * (level + 1), hanging: INDENT } } },
	}))

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

type Block = Paragraph | Table
type RunStyle = IRunPropertiesOptions

/** Where a block sits. */
interface Ctx {
	/** The width of the column the block sits in, in twips; indent comes off it. */
	width: number
	/** The Word heading level of the section the body belongs to. */
	level: number
	/** The left indent, in twips, and the rule down the left, if any. */
	indent: number
	rule: IBorderOptions | null
	/** Formatting every run in the block takes (a header cell's bold, a band's ink). */
	run: RunStyle
	/** The numbering level a list item here takes. */
	listLevel: number
}

const QUOTE_RULE: IBorderOptions = { style: BorderStyle.SINGLE, size: 12, color: RULE, space: 8 }
const VARIANTS_RULE: IBorderOptions = { style: BorderStyle.DOTTED, size: 12, color: RULE, space: 8 }

class Writer {
	readonly footnotes: Record<string, { children: Paragraph[] }> = {}
	readonly numbering: { reference: string; levels: ILevelsOptions[] }[] = [...BASE_NUMBERING]
	private nextFootnote = 1

	constructor(
		private readonly derived: DerivedView,
		private readonly pictures: Map<string, Picture>,
		private readonly origin: string,
	) {}

	/** Where a link goes from Word: a web or mail address as written, a path on this
	 *  site made whole; null for an anchor within a page. */
	private target(href: string): string | null {
		if (/^(https?:|mailto:)/i.test(href)) return href
		if (href.startsWith('/')) return `${this.origin}${href}`
		return null
	}

	private link(href: string, text: string, style: RunStyle = {}): ParagraphChild {
		const target = this.target(href)
		const run = new TextRun({ text, ...style, ...(target ? { color: INK.primary, underline: {} } : {}) })
		return target ? new ExternalHyperlink({ link: target, children: [run] }) : run
	}

	private text(text: string, marks: JsonMark[], base: RunStyle): ParagraphChild {
		let style: RunStyle = base
		let href: string | null = null
		for (const mark of marks) {
			switch (mark.type) {
				case 'bold':
					style = { ...style, bold: true }
					break
				case 'italic':
					style = { ...style, italics: true }
					break
				case 'underline':
					style = { ...style, underline: {} }
					break
				case 'strike':
					style = { ...style, strike: true }
					break
				case 'superscript':
					style = { ...style, superScript: true }
					break
				case 'subscript':
					style = { ...style, subScript: true }
					break
				case 'link':
					href = str(mark.attrs?.href)
					break
				case 'placeholder':
					style = { ...style, highlight: 'yellow' }
					break
				case 'note':
					style = { ...style, italics: true, color: INK.accent }
					break
				case 'instruction':
					style = { ...style, italics: true, color: INK.success }
					break
				case 'insertion':
					style = { ...style, underline: {}, color: INK.success }
					break
				case 'deletion':
					style = { ...style, strike: true, color: INK.error }
					break
				// A cross-reference reads as its text: the section it names is in this file.
				case 'sectionLink':
					break
			}
		}
		return href ? this.link(href, text, style) : new TextRun({ text, ...style })
	}

	private image(node: JsonNode, width: number): ParagraphChild {
		const src = str(node.attrs?.src)
		const alt = str(node.attrs?.alt)
		const picture = this.pictures.get(src)
		if (!picture || picture.width === 0 || picture.height === 0)
			return new TextRun({ text: `[${alt || 'Image'}]`, italics: true, color: MUTED })
		// The size the author set, else the image's own; a width alone keeps the proportions.
		const setWidth = num(node.attrs?.width)
		const setHeight = num(node.attrs?.height)
		const w = setWidth ?? picture.width
		const h = setWidth !== null && setHeight !== null ? setHeight : (picture.height * w) / picture.width
		const scale = Math.min(1, Math.max(1, width) / TWIPS_PER_PX / w, MAX_IMAGE_HEIGHT_PX / h)
		return new ImageRun({
			type: picture.type,
			data: picture.data,
			transformation: { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) },
			altText: { name: alt || 'Figure', description: alt, title: alt },
		})
	}

	private icon(src: string): ParagraphChild | null {
		const picture = this.pictures.get(src)
		if (!picture || picture.width === 0 || picture.height === 0) return null
		const scale = ICON_PX / Math.max(picture.width, picture.height)
		return new ImageRun({
			type: picture.type,
			data: picture.data,
			transformation: {
				width: Math.max(1, Math.round(picture.width * scale)),
				height: Math.max(1, Math.round(picture.height * scale)),
			},
			altText: { name: 'Icon' },
		})
	}

	/** Inline content as runs. */
	runs(nodes: JsonNode[], style: RunStyle, ctx: Ctx): ParagraphChild[] {
		const out: ParagraphChild[] = []
		nodes.forEach((node, i) => {
			switch (node.type) {
				case 'text':
					out.push(this.text(node.text ?? '', node.marks ?? [], style))
					break
				case 'hardBreak':
					out.push(new TextRun({ break: 1 }))
					break
				case 'citation': {
					const n = this.derived.referenceNumbers[str(node.attrs?.referenceId)]
					const joined = nodes[i - 1]?.type === 'citation'
					out.push(new TextRun({ ...style, text: `${joined ? ',' : ''}${n ?? '?'}`, superScript: true }))
					break
				}
				case 'footnote': {
					const id = this.nextFootnote++
					this.footnotes[String(id)] = { children: [new Paragraph({ children: [new TextRun(str(node.attrs?.text))] })] }
					out.push(new FootnoteReferenceRun(id))
					break
				}
				case 'mention':
					out.push(new TextRun({ ...style, text: str(node.attrs?.value) }))
					break
				case 'image':
					out.push(this.image(node, ctx.width - ctx.indent))
					break
				default:
					out.push(...this.runs(node.content ?? [], style, ctx))
			}
		})
		return out
	}

	/** A paragraph where the block sits: its indent and its rule. */
	private para(children: ParagraphChild[], ctx: Ctx, options: IParagraphOptions = {}): Paragraph {
		return new Paragraph({
			children,
			...(ctx.indent > 0 ? { indent: { left: ctx.indent } } : {}),
			...(ctx.rule ? { border: { left: ctx.rule } } : {}),
			...options,
		})
	}

	/** Blocks, with a paragraph between two tables (Word joins adjacent tables into one)
	 *  and each list item numbered in its run. */
	blocks(nodes: JsonNode[], ctx: Ctx): Block[] {
		const out: Block[] = []
		let ordered: string | null = null
		nodes.forEach((node, i) => {
			let made: Block[]
			if (node.type === 'list') {
				const previous = nodes[i - 1]
				const kind = str(node.attrs?.kind) || 'bullet'
				if (kind === 'ordered' && (ordered === null || previous?.type !== 'list' || str(previous.attrs?.kind) !== 'ordered')) {
					ordered = `ordered-${this.numbering.length}`
					this.numbering.push({ reference: ordered, levels: orderedLevels(Math.min(8, ctx.listLevel), num(node.attrs?.order) ?? 1) })
				}
				const reference =
					kind === 'ordered'
						? (ordered ?? 'bullet')
						: kind === 'check'
							? node.attrs?.negated === true
								? 'cross'
								: 'check'
							: kind === 'task'
								? node.attrs?.checked === true
									? 'task-done'
									: 'task-open'
								: 'bullet'
				made = this.listItem(node, ctx, reference)
			} else made = this.block(node, ctx)
			const [first] = made
			if (first instanceof Table && out.at(-1) instanceof Table) out.push(new Paragraph({ children: [] }))
			out.push(...made)
		})
		return out
	}

	/** One list item (a flat list node): its first paragraph numbered, the rest of its
	 *  content indented under it, a nested list a level down. An icon row prints its icon
	 *  where the number would be. */
	private listItem(node: JsonNode, ctx: Ctx, reference: string): Block[] {
		const [first, ...rest] = node.content ?? []
		const lead = first && (first.type === 'paragraph' || first.type === 'heading')
		const text = lead ? this.runs(first.content ?? [], ctx.run, ctx) : []
		const icon = this.icon(str(node.attrs?.icon))
		const head = icon
			? new Paragraph({
					children: [icon, new TextRun({ children: [new Tab()] }), ...text],
					indent: { left: ctx.indent + 2 * INDENT, hanging: 2 * INDENT },
				})
			: new Paragraph({
					children: text,
					numbering: { reference, level: Math.min(8, ctx.listLevel) },
					indent: { left: ctx.indent + INDENT, hanging: INDENT },
					alignment: lead ? alignOf(first.attrs?.textAlign) : undefined,
				})
		const inner: Ctx = { ...ctx, indent: ctx.indent + (icon ? 2 * INDENT : INDENT), rule: null, listLevel: ctx.listLevel + 1 }
		return [head, ...this.blocks(lead ? rest : (node.content ?? []), inner)]
	}

	/** Blocks inside a one-cell frame: a box, a timeframe, guidance. */
	private framed(content: Block[], ctx: Ctx, paint: { border: string; fill: string | null }): Table {
		const width = ctx.width - ctx.indent
		return new Table({
			width: { size: width, type: WidthType.DXA },
			columnWidths: [width],
			...(ctx.indent > 0 ? { indent: { size: ctx.indent, type: WidthType.DXA } } : {}),
			borders: around(line(paint.border, 12)),
			rows: [
				new TableRow({
					cantSplit: false,
					children: [
						new TableCell({
							children: closed(content),
							width: { size: width, type: WidthType.DXA },
							margins: BOX_MARGINS,
							borders: around(line(paint.border, 12)),
							...(paint.fill ? { shading: fill(paint.fill) } : {}),
						}),
					],
				}),
			],
		})
	}

	/** The context inside a frame: its own width, no indent or rule carried in. */
	private inside(ctx: Ctx, run: RunStyle = ctx.run): Ctx {
		return {
			...ctx,
			width: ctx.width - ctx.indent - BOX_MARGINS.left - BOX_MARGINS.right,
			indent: 0,
			rule: null,
			run,
			listLevel: 0,
		}
	}

	private banner(node: JsonNode, ctx: Ctx): Paragraph {
		const band = node.attrs?.tone !== 'sub'
		return this.para(this.runs(node.content ?? [], { ...ctx.run, bold: true, ...(band ? { color: 'FFFFFF' } : {}) }, ctx), ctx, {
			shading: fill(band ? INK.secondary : SOFT.secondary),
			keepNext: true,
		})
	}

	private table(node: JsonNode, ctx: Ctx): Table {
		const rows = node.content ?? []
		const columns = Math.max(
			1,
			...rows.map((row) => (row.content ?? []).reduce((n, cell) => n + (num(cell.attrs?.colspan) ?? 1), 0)),
		)
		const width = ctx.width - ctx.indent
		const each = Math.floor(width / columns)
		return new Table({
			width: { size: each * columns, type: WidthType.DXA },
			columnWidths: Array.from({ length: columns }, () => each),
			...(ctx.indent > 0 ? { indent: { size: ctx.indent, type: WidthType.DXA } } : {}),
			borders: { ...around(line(RULE, 4)), insideHorizontal: line(RULE, 4), insideVertical: line(RULE, 4) },
			rows: rows.map((row, r) => {
				const cells = row.content ?? []
				return new TableRow({
					tableHeader: r === 0 && cells.length > 0 && cells.every((c) => c.type === 'tableHeaderCell'),
					children: cells.map((cell) => {
						const span = num(cell.attrs?.colspan) ?? 1
						const header = cell.type === 'tableHeaderCell'
						const family = str(cell.attrs?.background)
						const shade = isColorFamily(family) ? SOFT[family] : header ? HEADER_FILL : null
						const inner: Ctx = {
							...ctx,
							width: each * span - CELL_MARGINS.left - CELL_MARGINS.right,
							indent: 0,
							rule: null,
							listLevel: 0,
							run: header ? { ...ctx.run, bold: true } : ctx.run,
						}
						return new TableCell({
							children: closed(this.blocks(cell.content ?? [], inner)),
							width: { size: each * span, type: WidthType.DXA },
							margins: CELL_MARGINS,
							...(span > 1 ? { columnSpan: span } : {}),
							...((num(cell.attrs?.rowspan) ?? 1) > 1 ? { rowSpan: num(cell.attrs?.rowspan) ?? 1 } : {}),
							...(shade ? { shading: fill(shade) } : {}),
						})
					}),
				})
			}),
		})
	}

	private columns(node: JsonNode, ctx: Ctx): Table {
		const columns = node.content ?? []
		const width = ctx.width - ctx.indent
		const each = Math.floor(width / Math.max(1, columns.length))
		return new Table({
			width: { size: each * columns.length, type: WidthType.DXA },
			columnWidths: columns.map(() => each),
			...(ctx.indent > 0 ? { indent: { size: ctx.indent, type: WidthType.DXA } } : {}),
			borders: TableBorders.NONE,
			rows: [
				new TableRow({
					children: columns.map(
						(column) =>
							new TableCell({
								children: closed(
									this.blocks(column.content ?? [], {
										...ctx,
										width: each - CELL_MARGINS.left - CELL_MARGINS.right,
										indent: 0,
										rule: null,
										listLevel: 0,
									}),
								),
								width: { size: each, type: WidthType.DXA },
								margins: CELL_MARGINS,
							}),
					),
				}),
			],
		})
	}

	private resource(node: JsonNode, ctx: Ctx): Block[] {
		const title = str(node.attrs?.title)
		const style: RunStyle = { bold: true, color: INK.primary }
		const description = node.content ?? []
		return [
			new Paragraph({
				children: [this.link(str(node.attrs?.url), title, style)],
				numbering: { reference: 'bullet', level: Math.min(8, ctx.listLevel) },
				indent: { left: ctx.indent + INDENT, hanging: INDENT },
				keepNext: description.length > 0,
			}),
			...this.blocks(description, { ...ctx, indent: ctx.indent + INDENT, rule: null, run: { ...ctx.run, color: MUTED } }),
		]
	}

	/** The snapshot of optimal timeframes, off the derived view (as the page draws it). */
	private snapshot(ctx: Ctx): Block[] {
		const rows = this.derived.timeframes
		const caption = this.para(
			[
				new TextRun({
					text:
						rows.length > 0
							? 'Snapshot of optimal timeframes — generated from the timeframe boxes of this document.'
							: 'Snapshot of optimal timeframes — no timeframe boxes yet.',
					italics: true,
					color: MUTED,
				}),
			],
			ctx,
			{ keepNext: true },
		)
		if (rows.length === 0) return [caption]
		const stepLabel = (row: (typeof rows)[number]) => (row.stepNumber !== null ? `Step ${row.stepNumber}` : row.section)
		const cell = (children: Paragraph[], header = false) =>
			new TableCell({ children: closed(children), margins: CELL_MARGINS, ...(header ? { shading: fill(HEADER_FILL) } : {}) })
		const plain = (text: string, header = false) => new Paragraph({ children: [new TextRun({ text, bold: header })] })
		const width = ctx.width - ctx.indent
		const widths = [0.2, 0.4, 0.4].map((share) => Math.floor(width * share))
		return [
			caption,
			new Table({
				width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
				columnWidths: widths,
				...(ctx.indent > 0 ? { indent: { size: ctx.indent, type: WidthType.DXA } } : {}),
				borders: { ...around(line(INK.error, 8)), insideHorizontal: line(RULE, 4), insideVertical: line(RULE, 4) },
				rows: [
					new TableRow({
						tableHeader: true,
						children: ['Pathway step', 'Care point', 'Timeframe'].map((label) => cell([plain(label, true)], true)),
					}),
					...rows.map(
						(row, i) =>
							new TableRow({
								children: [
									cell([plain(i > 0 && stepLabel(rows[i - 1] ?? row) === stepLabel(row) ? '' : stepLabel(row))]),
									cell([plain(row.carePoint)]),
									cell(
										row.statements.map(
											(alternatives) =>
												new Paragraph({
													children: alternatives.flatMap((alternative, j) => [
														...(j > 0 ? [new TextRun({ text: ' or ', italics: true, bold: true, color: INK.success })] : []),
														new TextRun(alternative),
													]),
												}),
										),
									),
								],
							}),
					),
				],
			}),
		]
	}

	/** The steps map, where the view carries one: its steps as a list. */
	private pathwayMap(ctx: Ctx): Block[] {
		const steps = this.derived.map?.nodes.filter((n) => n.kind === 'step') ?? []
		if (steps.length === 0)
			return [this.para([new TextRun({ text: 'The steps map is shown on the online page.', italics: true, color: MUTED })], ctx)]
		return steps.map(
			(step) =>
				new Paragraph({
					children: [new TextRun(step.badge ? `Step ${step.badge}: ${step.label}` : step.label)],
					numbering: { reference: 'bullet', level: Math.min(8, ctx.listLevel) },
					indent: { left: ctx.indent + INDENT, hanging: INDENT },
				}),
		)
	}

	private block(node: JsonNode, ctx: Ctx): Block[] {
		const children = node.content ?? []
		switch (node.type) {
			case 'paragraph':
				return [this.para(this.runs(children, ctx.run, ctx), ctx, { alignment: alignOf(node.attrs?.textAlign) })]
			case 'heading':
				return [
					this.para(this.runs(children, ctx.run, ctx), ctx, {
						// Below the section's own heading, at the level it names when deeper.
						heading: headingAt(Math.max(ctx.level + 1, num(node.attrs?.level) ?? 1)),
						alignment: alignOf(node.attrs?.textAlign),
					}),
				]
			case 'carePoint':
				return [
					this.para(
						[new TextRun({ text: '⏱ ', color: INK.error }), ...this.runs(children, { ...ctx.run, bold: true }, ctx)],
						ctx,
						{ alignment: alignOf(node.attrs?.textAlign), keepNext: true },
					),
				]
			case 'banner':
				return [this.banner(node, ctx)]
			case 'blockquote':
				return this.blocks(children, { ...ctx, indent: ctx.indent + INDENT, rule: QUOTE_RULE })
			case 'horizontalRule':
				return [this.para([], ctx, { border: { bottom: line(RULE, 6) } })]
			case 'pageBreak':
				return [new Paragraph({ children: [new PageBreak()] })]
			case 'image':
				return [this.para([this.image(node, ctx.width - ctx.indent)], ctx)]
			case 'figureRow': {
				const share = (ctx.width - ctx.indent) / Math.max(1, children.length)
				return [
					this.para(
						children.flatMap((image, i) => [...(i > 0 ? [new TextRun('  ')] : []), this.image(image, share - 60)]),
						ctx,
						{ alignment: AlignmentType.CENTER },
					),
				]
			}
			case 'list':
				return this.listItem(node, ctx, 'bullet')
			case 'table':
				return [this.table(node, ctx)]
			case 'box': {
				const attrs = boxAttrsOf(node.attrs ?? {})
				const family = boxFamily(attrs)
				const solid = attrs.kind === 'callout' && attrs.variant === 'solid'
				const inner = this.inside(ctx, solid ? { ...ctx.run, color: 'FFFFFF' } : ctx.run)
				return [
					this.framed(this.blocks(children, inner), ctx, {
						border: INK[family],
						fill: attrs.kind === 'callout' ? (solid ? INK[family] : SOFT[family]) : null,
					}),
				]
			}
			case 'timeframe':
				return [this.framed(this.blocks(children, this.inside(ctx)), ctx, { border: INK.error, fill: null })]
			case 'guidance': {
				const done = guidanceAttrsOf(node.attrs ?? {}).done
				const inner = this.inside(ctx)
				const label = new Paragraph({
					children: [new TextRun({ text: done ? 'Drafting guidance (done)' : 'Drafting guidance', bold: true, allCaps: true, size: 16, color: INK.success })],
					keepNext: true,
				})
				return [this.framed([label, ...this.blocks(children, inner)], ctx, { border: INK.success, fill: SOFT.success })]
			}
			case 'variants': {
				const inner: Ctx = { ...ctx, indent: ctx.indent + INDENT, rule: VARIANTS_RULE }
				return children.flatMap((variant, i) => [
					...(i > 0 ? [this.para([new TextRun({ text: 'Or', italics: true, bold: true, color: INK.success })], inner, { keepNext: true })] : []),
					...this.blocks(variant.content ?? [], inner),
				])
			}
			case 'columns':
				return [this.columns(node, ctx)]
			case 'resourceList':
				return children.flatMap((resource) => this.resource(resource, ctx))
			case 'resource':
				return this.resource(node, ctx)
			case 'timeframeSnapshot':
				return this.snapshot(ctx)
			case 'pathwayMap':
				return this.pathwayMap(ctx)
			// variant, column, doc: their content in place.
			default:
				return this.blocks(children, ctx)
		}
	}
}

/** A table cell's content as Word requires it: at least one paragraph, and a paragraph
 *  last. */
function closed(content: Block[]): Block[] {
	return content.at(-1) instanceof Paragraph ? content : [...content, new Paragraph({ children: [] })]
}

/** One reference as the published list prints it: a printed address is its link. */
function referenceRuns(reference: ListedReference, link: (href: string, text: string) => ParagraphChild): ParagraphChild[] {
	const split = printedAddress(reference.citation)
	if (split)
		return [
			new TextRun(`${split.before}<`),
			link(reference.url ?? hrefOf(split.address), split.address),
			new TextRun(`>${split.after}`),
		]
	return [new TextRun(reference.citation), ...(reference.url ? [new TextRun(' '), link(reference.url, reference.url)] : [])]
}

// ---------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------

/** The draft as a .docx file's bytes. */
export async function draftDocx(input: DraftDocxInput): Promise<Uint8Array<ArrayBuffer>> {
	const sources = [...imageSources(input.sections.map((s) => s.body))]
	const loaded = await Promise.all(
		sources.map(async (src): Promise<[string, Picture | null]> => {
			const bytes = await input.loadImage(src).catch(() => null)
			return [src, bytes ? pictureOf(bytes) : null]
		}),
	)
	const pictures = new Map<string, Picture>()
	for (const [src, picture] of loaded) if (picture) pictures.set(src, picture)

	const writer = new Writer(input.derived, pictures, input.origin)
	const date = imprintDate(input.exportedAt)
	const children: Block[] = [
		new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(input.title)] }),
		new Paragraph({ children: [new TextRun({ text: `Draft edition ${input.editionNo}`, bold: true, size: 28, color: INK.error })] }),
		new Paragraph({
			children: [new TextRun({ text: `Not for publication. Exported ${date} by ${input.exportedBy}.`, italics: true })],
			spacing: { after: 360 },
		}),
	]
	for (const section of input.sections) {
		const level = Math.min(6, section.depth + 1)
		const number = section.printedNumber ? `${numberLabel(section.printedNumber)} ` : ''
		const cites = section.titleCitations.map((id) => input.derived.referenceNumbers[id] ?? '?').join(',')
		children.push(
			new Paragraph({
				heading: headingAt(level),
				children: [new TextRun(`${number}${section.title}`), ...(cites ? [new TextRun({ text: cites, superScript: true })] : [])],
			}),
		)
		if (!section.body) continue
		const made = writer.blocks(section.body.content ?? [], {
			width: TEXT_WIDTH,
			level,
			indent: 0,
			rule: null,
			run: {},
			listLevel: 0,
		})
		if (made[0] instanceof Table && children.at(-1) instanceof Table) children.push(new Paragraph({ children: [] }))
		children.push(...made)
	}
	if (input.references.length > 0) {
		children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('References')] }))
		const link = (href: string, text: string): ParagraphChild =>
			new ExternalHyperlink({ link: href, children: [new TextRun({ text, color: INK.primary, underline: {} })] })
		for (const reference of input.references)
			children.push(
				new Paragraph({
					indent: { left: 560, hanging: 560 },
					children: [new TextRun({ children: [`${reference.number}.`, new Tab()] }), ...referenceRuns(reference, link)],
				}),
			)
	}

	const heading = (size: number, extra: RunStyle = {}) => ({
		run: { size, bold: true, color: INK.secondary, ...extra },
		paragraph: { spacing: { before: 280, after: 120 }, keepNext: true },
	})
	const document = new Document({
		title: input.title,
		creator: input.exportedBy,
		description: `Draft edition ${input.editionNo}, not published. Exported ${date}.`,
		styles: {
			default: {
				document: { run: { font: 'Arial', size: 20 }, paragraph: { spacing: { after: 120 } } },
				title: { run: { font: 'Arial', size: 40, bold: true, color: INK.secondary }, paragraph: { spacing: { after: 120 } } },
				heading1: heading(32),
				heading2: heading(28),
				heading3: heading(24),
				heading4: heading(22),
				heading5: heading(20),
				heading6: heading(20, { italics: true }),
			},
		},
		numbering: { config: writer.numbering },
		footnotes: writer.footnotes,
		sections: [
			{
				properties: {
					page: {
						size: { width: PAGE.width, height: PAGE.height },
						margin: { top: PAGE.margin, right: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin },
					},
				},
				headers: {
					default: new Header({
						children: [
							new Paragraph({
								alignment: AlignmentType.RIGHT,
								children: [
									new TextRun({
										text: `DRAFT — edition ${input.editionNo}, not published · exported ${date}`,
										bold: true,
										size: 16,
										color: INK.error,
									}),
								],
							}),
						],
					}),
				},
				children,
			},
		],
	})
	return new Uint8Array(await Packer.pack(document, 'arraybuffer'))
}
