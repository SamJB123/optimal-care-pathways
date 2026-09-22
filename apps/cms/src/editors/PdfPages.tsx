/**
 * The pages of a PDF, drawn by pdf.js in the browser: one canvas per page, rendered when
 * it scrolls into view. Client-only by construction — pdf.js is imported inside the
 * settled effect, never during SSR — and one parsed document is shared per file URL.
 */

import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { createSignal, For, onSettled } from 'solid-js'

const documents = new Map<string, Promise<PDFDocumentProxy>>()

function openDocument(url: string): Promise<PDFDocumentProxy> {
	const cached = documents.get(url)
	if (cached) return cached
	const opened = import('pdfjs-dist').then((pdfjs) => {
		pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
		return pdfjs.getDocument({ url }).promise
	})
	documents.set(url, opened)
	return opened
}

/** "13" or "13-14" → [13, 14]. */
export function pageRange(sourcePages: string | null): number[] {
	if (!sourcePages) return []
	const [from, to] = sourcePages.split('-').map(Number)
	if (!from || Number.isNaN(from)) return []
	const last = to && !Number.isNaN(to) ? to : from
	return Array.from({ length: last - from + 1 }, (_, i) => from + i)
}

export function PdfPages(props: { url: string; pages: number[]; width: number; eager?: boolean }) {
	return (
		<div class="ocp-pdf-pages">
			<For each={props.pages}>
				{(page) => (
					<PdfPage url={props.url} page={page} width={props.width} eager={props.eager ?? false} />
				)}
			</For>
		</div>
	)
}

function PdfPage(props: { url: string; page: number; width: number; eager: boolean }) {
	let canvas!: HTMLCanvasElement
	const [state, setState] = createSignal<'waiting' | 'rendering' | 'rendered' | 'failed'>('waiting')

	onSettled(() => {
		let cancelled = false
		const render = async () => {
			if (cancelled || state() !== 'waiting') return
			setState('rendering')
			try {
				const doc = await openDocument(props.url)
				const pdfPage = await doc.getPage(props.page)
				const base = pdfPage.getViewport({ scale: 1 })
				const scale = (props.width / base.width) * (window.devicePixelRatio || 1)
				const viewport = pdfPage.getViewport({ scale })
				canvas.width = Math.floor(viewport.width)
				canvas.height = Math.floor(viewport.height)
				canvas.style.width = `${props.width}px`
				canvas.style.height = `${Math.floor(viewport.height / (window.devicePixelRatio || 1))}px`
				const context = canvas.getContext('2d')
				if (!context) throw new Error('no 2d context')
				await pdfPage.render({ canvas, canvasContext: context, viewport }).promise
				if (!cancelled) setState('rendered')
			} catch (error) {
				console.error('[pdf-pages]', props.url, props.page, error)
				if (!cancelled) setState('failed')
			}
		}
		if (props.eager) {
			void render()
			return () => {
				cancelled = true
			}
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					observer.disconnect()
					void render()
				}
			},
			{ rootMargin: '600px 0px' },
		)
		observer.observe(canvas)
		return () => {
			cancelled = true
			observer.disconnect()
		}
	})

	return (
		<figure class="ocp-pdf-page" data-state={state()}>
			<canvas
				ref={canvas}
				data-page={props.page}
				data-rendered={state() === 'rendered' ? 'true' : 'false'}
			/>
			<figcaption>p.{props.page}</figcaption>
		</figure>
	)
}
