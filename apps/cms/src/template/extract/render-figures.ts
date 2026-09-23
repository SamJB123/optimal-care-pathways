/**
 * Renders a document's figures — the schematics, cover thumbnails and principle icons the
 * structure tree tags as `Figure` — to PNG files, one per figure, cropped from a render of
 * their page. Band icons (pen, info, hand, stopwatch, clipboard, speech) are box
 * semantics and are skipped; the mapper records them as the box's `icon` instead.
 *
 * Numbering follows the mapper's: figures are counted per page in document order, so an
 * image node's `src` and the file written here always agree.
 *
 * Node only. Canvases come from pdf.js's OWN canvas factory (its Node build resolves
 * `@napi-rs/canvas` itself): a canvas from any other copy of that package rejects the
 * `Path2D` objects pdf.js draws with.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { contentFigures } from './map-to-content.ts'
import type { ExtractedDocument } from './model.ts'

interface CanvasAndContext {
	canvas: HTMLCanvasElement
	context: CanvasRenderingContext2D
}

interface CanvasFactory {
	create(width: number, height: number): CanvasAndContext
	destroy(target: CanvasAndContext): void
}

const isCanvasFactory = (value: unknown): value is CanvasFactory =>
	typeof value === 'object' &&
	value !== null &&
	'create' in value &&
	typeof value.create === 'function' &&
	'destroy' in value &&
	typeof value.destroy === 'function'

function canvasFactoryOf(doc: PDFDocumentProxy): CanvasFactory {
	const factory: unknown = doc.canvasFactory
	if (!isCanvasFactory(factory))
		throw new Error('pdf.js exposed no canvas factory; is @napi-rs/canvas installed?')
	return factory
}

/** Render every content figure of `model` to `${outDir}/p<page>-<index>.png`. */
export async function renderFigures(
	doc: PDFDocumentProxy,
	model: ExtractedDocument,
	outDir: string,
	scale = 3,
): Promise<number> {
	mkdirSync(outDir, { recursive: true })
	const factory = canvasFactoryOf(doc)
	const byPage = new Map<number, { index: number; bbox: [number, number, number, number] }[]>()
	for (const { figure, index } of contentFigures(model)) {
		if (!figure.bbox) continue
		const list = byPage.get(figure.page) ?? []
		list.push({ index, bbox: figure.bbox })
		byPage.set(figure.page, list)
	}
	let written = 0
	for (const [pageNumber, figures] of byPage) {
		const page = await doc.getPage(pageNumber)
		const viewport = page.getViewport({ scale })
		const full = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height))
		await page.render({ canvas: full.canvas, canvasContext: full.context, viewport }).promise
		for (const { index, bbox } of figures) {
			// PDF space (origin bottom-left) → canvas space (origin top-left).
			const [x0, y0] = viewport.convertToViewportPoint(bbox[0], bbox[3])
			const [x1, y1] = viewport.convertToViewportPoint(bbox[2], bbox[1])
			const width = Math.max(1, Math.round(x1 - x0))
			const height = Math.max(1, Math.round(y1 - y0))
			const crop = factory.create(width, height)
			crop.context.drawImage(
				full.canvas,
				Math.round(x0),
				Math.round(y0),
				width,
				height,
				0,
				0,
				width,
				height,
			)
			const dataUrl = crop.canvas.toDataURL('image/png')
			const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
			writeFileSync(join(outDir, `p${pageNumber}-${index}.png`), Buffer.from(base64, 'base64'))
			factory.destroy(crop)
			written += 1
		}
		factory.destroy(full)
	}
	return written
}
