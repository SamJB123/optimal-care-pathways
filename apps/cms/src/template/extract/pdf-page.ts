/**
 * One PDF page, read completely — the extractor's view of the source, built from the three
 * things pdf.js exposes and joined by MARKED-CONTENT ID so nothing is matched by text:
 *
 *   - the structure tree (`getStructTree`): the document's own logical structure — roles
 *     (P, H1–H4, L/LI/Lbl/LBody, Table/TR/TH/TD, Span, Link, Figure, Note, TOC/TOCI,
 *     Sect), table spans, alt text — whose leaves name marked-content ids;
 *   - the text content (`getTextContent({ includeMarkedContent: true })`): the strings
 *     in reading order with pdf.js's spacing and line-end reconstruction, delimited by
 *     the same marked-content ids;
 *   - the operator list (`getOperatorList`): every glyph run with the FONT it was drawn
 *     in (whose descriptor says bold / italic), its size, fill colour and text rise, again
 *     inside marked-content begin/end pairs; and every filled rectangle with its colour —
 *     which is how the templates draw yellow highlights, navy title bands, green "Or"
 *     rows, blue shaded rows and the pale supportive-care page background.
 *
 * Plus the page's link annotations (URL or internal destination, with their rectangles).
 *
 * Why the operator list: the text content API knows nothing of colour, rise or the actual
 * font face, and the old pipeline's losses (bold, italic, placeholders, false citations)
 * all trace back to reading text without them. Style runs are aligned to the text items
 * character by character within each marked-content id, so the text is pdf.js's (with its
 * spaces) and the style is the drawing's.
 *
 * Node-only (pdf.js legacy build). Used by the extractor and the page inspector script.
 */

import { readFileSync } from 'node:fs'
import { getDocument, OPS, Util } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
// The display-layer record types are declared in pdf.js's typings but not re-exported
// from the entry module.
import type {
	StructTreeContent,
	StructTreeNode,
	TextItem,
	TextMarkedContent,
} from 'pdfjs-dist/types/src/display/api.js'

export type { StructTreeContent, StructTreeNode }

/** pdf.js returns `alt` and `bbox` (figures) and `lang` on tree nodes; its typings omit them. */
export type TreeNode = StructTreeNode & { alt?: string; lang?: string; bbox?: number[] }

/** `Util.applyTransform` mutates its point in place (pdf.js ≥ 5); this returns one. */
function applyTransform(point: [number, number], matrix: number[]): [number, number] {
	const p: [number, number] = [point[0], point[1]]
	Util.applyTransform(p, matrix)
	return p
}

/** A rectangle in page space (PDF points, origin bottom-left). */
export interface Box {
	x: number
	y: number
	width: number
	height: number
}

/** A run of glyphs drawn with one style, inside one marked-content id. */
export interface StyleSpan {
	mcid: string
	/** The font's own name from its descriptor (e.g. "Arial-BoldMT"), never pdf.js's alias. */
	font: string
	bold: boolean
	italic: boolean
	size: number
	/** Fill colour as `#rrggbb`. */
	fill: string
	/** Text rise: positive = superscript, negative = subscript. */
	rise: number
	/** The glyphs' unicode, with a space wherever the drawing left a word gap. */
	text: string
	/** The horizontal advance of each character of `text`, in page units. */
	advances: number[]
	/** Where the run was drawn (text-space origin transformed to page space). */
	origin: { x: number; y: number }
}

/** A string pdf.js reconstructed, inside one marked-content id. */
export interface TextRun {
	mcid: string
	text: string
	hasEOL: boolean
	box: Box
	/** pdf.js's font alias for the run (joins to `fonts`). */
	fontName: string
}

/** A painted path's bounding box: a filled one is a highlight, a band, a cell shading or a
 *  rule; a stroked one is a border (the developer boxes are green-bordered). */
export interface PaintedPath {
	box: Box
	kind: 'fill' | 'stroke'
	colour: string
	/** Segments in the path — a rectangle is four or five. */
	segments: number
	/** The marked content the path was drawn inside, if any: a highlight is drawn inside
	 *  its text's element; table shading and rules are drawn outside any (or as artifacts). */
	mcid: string | null
}

export interface LinkAnnotation {
	/** pdf.js's annotation id (e.g. "11106R"); the tree's Link element names it. */
	id: string
	box: Box
	url?: string
	/** An internal destination (named or explicit), when the link is within the document. */
	dest?: string
}

export interface FontFace {
	alias: string
	name: string
	bold: boolean
	italic: boolean
}

export interface PdfPage {
	pageNumber: number
	width: number
	height: number
	tree: TreeNode | null
	/** Text runs in reading order, keyed by marked-content id. */
	textByMcid: Map<string, TextRun[]>
	/** Style spans in drawing order, keyed by marked-content id. */
	spansByMcid: Map<string, StyleSpan[]>
	/** Every text run's page order (the order pdf.js emitted them). */
	textRuns: TextRun[]
	paths: PaintedPath[]
	links: LinkAnnotation[]
	/** Links by annotation id, for the tree's Link elements. */
	linksById: Map<string, LinkAnnotation>
	fonts: Map<string, FontFace>
	/** Marked-content ids that appear in the drawing but not under any tree leaf. */
	untaggedMcids: string[]
}

export async function openPdf(path: string): Promise<PDFDocumentProxy> {
	return getDocument({
		data: new Uint8Array(readFileSync(path)),
		useSystemFonts: true,
		verbosity: 0,
	}).promise
}

const hex = (v: number): string =>
	Math.round(Math.max(0, Math.min(1, v)) * 255)
		.toString(16)
		.padStart(2, '0')
const rgb = (r: number, g: number, b: number): string => `#${hex(r)}${hex(g)}${hex(b)}`

/** A finite number from an operator argument, or the fallback: a single NaN in the text
 *  state would poison every glyph advance after it. */
const finite = (value: unknown, fallback: number): number => {
	const n = typeof value === 'number' ? value : Number(value)
	return Number.isFinite(n) ? n : fallback
}

/** pdf.js ≥ 5 pre-converts colour operands to a CSS hex string; older forms are numbers. */
function colourOf(args: unknown[]): string | null {
	const first = args[0]
	if (typeof first === 'string' && first.startsWith('#')) return first.toLowerCase()
	const nums = args.filter((v): v is number => typeof v === 'number')
	if (nums.length === 3) return rgb(nums[0] / 255, nums[1] / 255, nums[2] / 255)
	if (nums.length === 1) return rgb(nums[0], nums[0], nums[0])
	if (nums.length === 4) {
		const [c, m, y, k] = nums
		return rgb((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k))
	}
	return null
}

/** The marked-content id in the form the text layer and structure tree use (`p48R_mc7`):
 *  pdf.js hands the operator list either that id, or a Dict / number holding the raw MCID. */
function mcidOf(props: unknown, pageObjId: string): string | null {
	if (props === null || props === undefined) return null
	if (typeof props === 'number') return `${pageObjId}_mc${props}`
	if (typeof props !== 'object') return null
	if ('id' in props && typeof props.id === 'string')
		return props.id.includes('_mc') ? props.id : `${pageObjId}_mc${props.id}`
	if ('get' in props && typeof props.get === 'function') {
		const id: unknown = props.get('MCID')
		return id === undefined || id === null ? null : `${pageObjId}_mc${String(id)}`
	}
	return null
}

/** An array or typed array of numbers (pdf.js uses Float32Array for path data). */
function isNumberList(value: unknown): value is ArrayLike<number> {
	return Array.isArray(value) || value instanceof Float32Array || value instanceof Float64Array
}

/** A six-number matrix from operator arguments, which pdf.js hands either as six numbers
 *  or as one typed array. */
function matrixOf(args: unknown[], fallback: number[]): number[] {
	const source =
		args.length === 1 && isNumberList(args[0]) ? Array.from(args[0], Number) : args.map(Number)
	if (source.length !== 6 || !source.every(Number.isFinite)) return fallback
	return source
}

/** The paint operators a `constructPath` ends with, by kind. */
const FILL_OPS = new Set<number>([
	OPS.fill,
	OPS.eoFill,
	OPS.fillStroke,
	OPS.eoFillStroke,
	OPS.closeFillStroke,
	OPS.closeEOFillStroke,
])
const STROKE_OPS = new Set<number>([
	OPS.stroke,
	OPS.closeStroke,
	OPS.fillStroke,
	OPS.eoFillStroke,
	OPS.closeFillStroke,
	OPS.closeEOFillStroke,
])

/** The font face behind a pdf.js alias, from the font object's own descriptor. */
async function fontFace(page: PDFPageProxy, alias: string): Promise<FontFace> {
	const font: unknown = await new Promise((resolve) => {
		try {
			page.commonObjs.get(alias, resolve)
		} catch {
			resolve(null)
		}
	})
	const record = font && typeof font === 'object' ? (font as Record<string, unknown>) : {}
	const name = typeof record.name === 'string' ? record.name : alias
	const lower = name.toLowerCase()
	return {
		alias,
		name,
		bold: record.bold === true || /bold|black|heavy|semibold|demibold/.test(lower),
		italic: record.italic === true || /italic|oblique/.test(lower),
	}
}

/** A bounding box `[xmin, ymin, xmax, ymax]` in user space, transformed to page space. */
function boxOf(minMax: number[], ctm: number[]): Box {
	const [ax, ay] = applyTransform([minMax[0] ?? 0, minMax[1] ?? 0], ctm)
	const [bx, by] = applyTransform([minMax[2] ?? 0, minMax[3] ?? 0], ctm)
	return {
		x: Math.min(ax, bx),
		y: Math.min(ay, by),
		width: Math.abs(bx - ax),
		height: Math.abs(by - ay),
	}
}

export async function readPage(doc: PDFDocumentProxy, pageNumber: number): Promise<PdfPage> {
	const page = await doc.getPage(pageNumber)
	const [, , width, height] = page.view as [number, number, number, number]
	const pageObjId = `p${page.ref?.num ?? pageNumber}R`
	const tree: TreeNode | null = await page.getStructTree()
	const content = await page.getTextContent({ includeMarkedContent: true })
	const ops = await page.getOperatorList()
	const annotations = await page.getAnnotations()

	// ---- text content, delimited by marked content ------------------------------------
	const textByMcid = new Map<string, TextRun[]>()
	const textRuns: TextRun[] = []
	const mcStack: (string | null)[] = []
	for (const item of content.items as (TextItem | TextMarkedContent)[]) {
		if ('type' in item) {
			if (item.type === 'beginMarkedContentProps') mcStack.push(item.id ?? null)
			else if (item.type === 'beginMarkedContent') mcStack.push(null)
			else if (item.type === 'endMarkedContent') mcStack.pop()
			continue
		}
		const mcid = mcStack.findLast((id) => id !== null) ?? '<none>'
		const [, , , , e, f] = item.transform
		const run: TextRun = {
			mcid,
			text: item.str,
			hasEOL: item.hasEOL,
			fontName: item.fontName,
			// pdf.js reports width and height already in page units; the transform's
			// translation is the baseline origin.
			box: { x: e ?? 0, y: f ?? 0, width: item.width, height: item.height },
		}
		textRuns.push(run)
		const runs = textByMcid.get(mcid) ?? []
		runs.push(run)
		textByMcid.set(mcid, runs)
	}

	// ---- operator list: glyph runs with style, and painted paths ---------------------
	const spansByMcid = new Map<string, StyleSpan[]>()
	const paths: PaintedPath[] = []
	const fontAliases = new Set<string>()
	// The graphics state: everything `q`/`Q` saves and restores — the transform AND the
	// colours, font and text spacing. Restoring only the transform misreports the colour
	// of any fill drawn after a `Q` (Word draws every highlight that way).
	interface GraphicsState {
		ctm: number[]
		fill: string
		stroke: string
		fontAlias: string
		fontSize: number
		rise: number
		leading: number
		charSpacing: number
		wordSpacing: number
		hScale: number
	}
	const stateStack: GraphicsState[] = []
	let ctm = [1, 0, 0, 1, 0, 0]
	let textMatrix = [1, 0, 0, 1, 0, 0]
	let lineMatrix = [1, 0, 0, 1, 0, 0]
	let fontAlias = ''
	let fontSize = 0
	let rise = 0
	let fill = '#000000'
	let stroke = '#000000'
	let leading = 0
	let charSpacing = 0
	let wordSpacing = 0
	let hScale = 1
	const opMcStack: (string | null)[] = []

	const currentMcid = () => opMcStack.findLast((id) => id !== null) ?? '<none>'
	/** The page-space length of one text-space unit along the baseline. */
	const textScale = () => {
		const m = Util.transform(ctm, textMatrix)
		return Math.hypot(m[0] ?? 1, m[1] ?? 0)
	}
	const pushSpan = (text: string, advances: number[]) => {
		if (!text) return
		const mcid = currentMcid()
		const [ox, oy] = applyTransform([0, 0], Util.transform(ctm, textMatrix))
		const spans = spansByMcid.get(mcid) ?? []
		const last = spans.at(-1)
		const face = fontAlias
		if (
			last &&
			last.font === face &&
			last.size === fontSize &&
			last.fill === fill &&
			last.rise === rise
		) {
			last.text += text
			last.advances.push(...advances)
		} else {
			spans.push({
				mcid,
				font: face,
				bold: false,
				italic: false,
				size: fontSize,
				fill,
				rise,
				text,
				advances,
				origin: { x: ox, y: oy },
			})
		}
		spansByMcid.set(mcid, spans)
	}
	const showGlyphs = (glyphs: unknown[]) => {
		let text = ''
		const advances: number[] = []
		const scale = textScale()
		for (const glyph of glyphs) {
			if (typeof glyph === 'number') {
				// A horizontal adjustment in thousandths of text space: a large negative one
				// is a word gap the font's own spacing did not draw; smaller ones are kerning,
				// folded into the previous character's advance.
				const shift = (-glyph / 1000) * fontSize * hScale * scale
				if (glyph < -150) {
					text += ' '
					advances.push(shift)
				} else if (advances.length > 0)
					advances[advances.length - 1] = (advances.at(-1) ?? 0) + shift
				continue
			}
			if (
				glyph &&
				typeof glyph === 'object' &&
				'unicode' in glyph &&
				typeof glyph.unicode === 'string'
			) {
				const width = 'width' in glyph ? finite(glyph.width, 500) : 500
				const isSpace = 'isSpace' in glyph && glyph.isSpace === true
				const advance = finite(
					((width / 1000) * fontSize + charSpacing + (isSpace ? wordSpacing : 0)) * hScale * scale,
					fontSize * 0.5,
				)
				// A multi-character unicode (a ligature) shares its advance across its characters.
				const chars = [...glyph.unicode]
				for (const ch of chars) {
					text += ch
					advances.push(advance / chars.length)
				}
			}
		}
		pushSpan(text, advances)
		// Advance the text matrix past what was drawn, so following runs start in place.
		const drawn = advances.reduce((sum, a) => sum + a, 0) / (scale || 1)
		textMatrix = Util.transform(textMatrix, [1, 0, 0, 1, drawn, 0])
	}
	const { fnArray, argsArray } = ops
	for (let i = 0; i < fnArray.length; i++) {
		const fn = fnArray[i]
		const args: unknown[] = (argsArray[i] as unknown[]) ?? []
		switch (fn) {
			case OPS.save:
				stateStack.push({
					ctm,
					fill,
					stroke,
					fontAlias,
					fontSize,
					rise,
					leading,
					charSpacing,
					wordSpacing,
					hScale,
				})
				break
			case OPS.restore: {
				const saved = stateStack.pop()
				if (saved)
					({
						ctm,
						fill,
						stroke,
						fontAlias,
						fontSize,
						rise,
						leading,
						charSpacing,
						wordSpacing,
						hScale,
					} = saved)
				break
			}
			case OPS.transform:
				ctm = Util.transform(ctm, matrixOf(args, [1, 0, 0, 1, 0, 0]))
				break
			case OPS.paintFormXObjectBegin:
				// A form's content is drawn under its own matrix; it ends with the matching End.
				stateStack.push({
					ctm,
					fill,
					stroke,
					fontAlias,
					fontSize,
					rise,
					leading,
					charSpacing,
					wordSpacing,
					hScale,
				})
				ctm = Util.transform(ctm, matrixOf([args[0]], [1, 0, 0, 1, 0, 0]))
				break
			case OPS.paintFormXObjectEnd: {
				const saved = stateStack.pop()
				if (saved)
					({
						ctm,
						fill,
						stroke,
						fontAlias,
						fontSize,
						rise,
						leading,
						charSpacing,
						wordSpacing,
						hScale,
					} = saved)
				break
			}
			case OPS.beginMarkedContentProps:
				opMcStack.push(mcidOf(args[1], pageObjId))
				break
			case OPS.beginMarkedContent:
				opMcStack.push(null)
				break
			case OPS.endMarkedContent:
				opMcStack.pop()
				break
			case OPS.beginText:
				textMatrix = [1, 0, 0, 1, 0, 0]
				lineMatrix = [1, 0, 0, 1, 0, 0]
				break
			case OPS.setFont:
				fontAlias = String(args[0])
				fontSize = finite(args[1], fontSize)
				fontAliases.add(fontAlias)
				break
			case OPS.setTextRise:
				rise = finite(args[0], 0)
				break
			case OPS.setCharSpacing:
				charSpacing = finite(args[0], 0)
				break
			case OPS.setWordSpacing:
				wordSpacing = finite(args[0], 0)
				break
			case OPS.setHScale:
				hScale = finite(args[0], 100) / 100
				break
			case OPS.setLeading:
				leading = finite(args[0], 0)
				break
			case OPS.setTextMatrix:
				textMatrix = matrixOf(args, textMatrix)
				lineMatrix = [...textMatrix]
				break
			case OPS.moveText:
				lineMatrix = Util.transform(lineMatrix, [
					1,
					0,
					0,
					1,
					finite(args[0], 0),
					finite(args[1], 0),
				])
				textMatrix = [...lineMatrix]
				break
			case OPS.setLeadingMoveText:
				leading = -finite(args[1], 0)
				lineMatrix = Util.transform(lineMatrix, [
					1,
					0,
					0,
					1,
					finite(args[0], 0),
					finite(args[1], 0),
				])
				textMatrix = [...lineMatrix]
				break
			case OPS.nextLine:
				lineMatrix = Util.transform(lineMatrix, [1, 0, 0, 1, 0, -leading])
				textMatrix = [...lineMatrix]
				break
			case OPS.setFillRGBColor:
			case OPS.setFillGray:
			case OPS.setFillCMYKColor:
			case OPS.setFillColorN:
			case OPS.setFillColor:
				fill = colourOf(args) ?? fill
				break
			case OPS.setStrokeRGBColor:
			case OPS.setStrokeGray:
			case OPS.setStrokeCMYKColor:
			case OPS.setStrokeColorN:
			case OPS.setStrokeColor:
				stroke = colourOf(args) ?? stroke
				break
			case OPS.showText:
				showGlyphs(args[0] as unknown[])
				break
			case OPS.showSpacedText:
				showGlyphs(args[0] as unknown[])
				break
			case OPS.nextLineShowText:
				lineMatrix = Util.transform(lineMatrix, [1, 0, 0, 1, 0, -leading])
				textMatrix = [...lineMatrix]
				showGlyphs(args[0] as unknown[])
				break
			case OPS.constructPath: {
				// pdf.js ≥ 5 packs a whole path: args = [paintOp, [segments…], minMax]. The
				// segment buffer is flat (type code then coordinates: 0 moveTo, 1 lineTo, 2/3
				// curves, 4 closePath); minMax is the path's bounding box in user space.
				// Both the segment buffers and minMax may be typed arrays.
				const paintOp = Number(args[0])
				const buffers = args[1]
				const minMax = isNumberList(args[2]) ? Array.from(args[2], Number) : null
				if (!minMax || minMax.length < 4) break
				let segments = 0
				if (isNumberList(buffers) || Array.isArray(buffers)) {
					for (const buffer of Array.from(buffers as ArrayLike<unknown>)) {
						if (!isNumberList(buffer)) continue
						for (const code of Array.from(buffer, Number))
							if (code === 0 || code === 1 || code === 4) segments += 1
					}
				}
				const box = boxOf(minMax, ctm)
				const mcid = opMcStack.findLast((id) => id !== null) ?? null
				if (FILL_OPS.has(paintOp)) paths.push({ box, kind: 'fill', colour: fill, segments, mcid })
				if (STROKE_OPS.has(paintOp))
					paths.push({ box, kind: 'stroke', colour: stroke, segments, mcid })
				break
			}
			default:
				break
		}
	}

	// ---- fonts: the real faces behind the aliases ----------------------------------
	const fonts = new Map<string, FontFace>()
	for (const alias of fontAliases) fonts.set(alias, await fontFace(page, alias))
	for (const spans of spansByMcid.values()) {
		for (const span of spans) {
			const face = fonts.get(span.font)
			if (face) {
				span.font = face.name
				span.bold = face.bold
				span.italic = face.italic
			}
		}
	}

	// ---- links ------------------------------------------------------------------------
	const links: LinkAnnotation[] = []
	const linksById = new Map<string, LinkAnnotation>()
	for (const annotation of annotations as Record<string, unknown>[]) {
		if (annotation.subtype !== 'Link') continue
		const rect = annotation.rect
		if (!Array.isArray(rect) || rect.length !== 4) continue
		const nums = rect.map(Number)
		const x0 = Math.min(nums[0] ?? 0, nums[2] ?? 0)
		const y0 = Math.min(nums[1] ?? 0, nums[3] ?? 0)
		const link: LinkAnnotation = {
			id: String(annotation.id ?? ''),
			box: {
				x: x0,
				y: y0,
				width: Math.abs((nums[2] ?? 0) - (nums[0] ?? 0)),
				height: Math.abs((nums[3] ?? 0) - (nums[1] ?? 0)),
			},
		}
		if (typeof annotation.url === 'string') link.url = annotation.url
		else if (annotation.dest !== undefined && annotation.dest !== null)
			link.dest = JSON.stringify(annotation.dest)
		links.push(link)
		linksById.set(link.id, link)
	}

	// ---- which drawn ids the tree does not claim -----------------------------------
	const claimed = new Set<string>()
	const claim = (node: TreeNode | StructTreeContent): void => {
		if ('type' in node) {
			if (node.type === 'content' && node.id) claimed.add(node.id)
			return
		}
		for (const child of node.children ?? []) claim(child)
	}
	if (tree) claim(tree)
	const untaggedMcids = [...new Set([...textByMcid.keys(), ...spansByMcid.keys()])].filter(
		(id) => id !== '<none>' && !claimed.has(id),
	)

	return {
		pageNumber,
		width,
		height,
		tree,
		textByMcid,
		spansByMcid,
		textRuns,
		paths,
		links,
		linksById,
		fonts,
		untaggedMcids,
	}
}

/** The annotation id a tree leaf of type "annotation" names, in `getAnnotations` form. */
export function annotationIdOf(leaf: StructTreeContent): string {
	return leaf.id.replace(/^pdfjs_internal_id_/, '')
}

/** Two boxes overlap (with a small tolerance in points). */
export function overlaps(a: Box, b: Box, tolerance = 0.5): boolean {
	return (
		a.x < b.x + b.width + tolerance &&
		a.x + a.width > b.x - tolerance &&
		a.y < b.y + b.height + tolerance &&
		a.y + a.height > b.y - tolerance
	)
}
