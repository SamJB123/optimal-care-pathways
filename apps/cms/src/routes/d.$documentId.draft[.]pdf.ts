/**
 * /d/{documentId}/draft.pdf — the draft as a PDF, for any member of the document: Browser
 * Run prints the draft preview (/d/{id}/preview?print), watermarked on every page, the
 * way the published PDF is printed from the published page. The preview is behind
 * sign-in, so the reader's session goes with the print, as cookies for this site alone.
 * Never cached: a draft moves.
 */

import { createFileRoute } from '@tanstack/solid-router'
import { previewHref } from '#/lib/links.ts'
import { lifecycleOf } from '#/server/lifecycle-env.ts'
import { documentOf, LifecycleRefusal, roleOn } from '#/server/lifecycle.ts'

const plain = (status: number, text: string) =>
	new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })

/** A Cookie header's pairs, as cookies for `url`. */
const cookiesFor = (header: string, url: string) =>
	header
		.split(';')
		.map((pair) => pair.trim())
		.filter((pair) => pair.includes('='))
		.map((pair) => {
			const at = pair.indexOf('=')
			return { name: pair.slice(0, at), value: pair.slice(at + 1), url }
		})

const serve = async ({ request, params }: { request: Request; params: { documentId: string } }): Promise<Response> => {
	// biome-ignore lint/correctness/noUnresolvedImports: provided by the Workers runtime
	const { env } = await import('cloudflare:workers')
	const cookie = request.headers.get('cookie') ?? ''
	const userId = cookie ? ((await env.AUTH.verifySession(cookie)).user?.id ?? null) : null
	if (!userId) return plain(403, 'Sign in to download the draft.')
	const lc = await lifecycleOf()
	let document: Awaited<ReturnType<typeof documentOf>>
	try {
		document = await documentOf(lc, params.documentId)
	} catch (error) {
		if (error instanceof LifecycleRefusal) return plain(404, 'Document not found.')
		throw error
	}
	if (!(await roleOn(lc, userId, document))) return plain(403, 'You are not a member of this document.')

	const origin = new URL(request.url).origin
	let rendered: Response
	try {
		rendered = await env.BROWSER.quickAction('pdf', {
			url: `${origin}${previewHref(document.id)}?print=true`,
			cookies: cookiesFor(cookie, origin),
			pdfOptions: {
				format: 'a4',
				printBackground: true,
				margin: { top: '18mm', right: '16mm', bottom: '18mm', left: '16mm' },
			},
			gotoOptions: { waitUntil: 'networkidle0' },
		})
	} catch (error) {
		// Browser Run is not reachable (local development, an outage).
		console.error('[draft.pdf] Browser Run failed:', error instanceof Error ? error.message : error)
		return plain(502, 'The PDF could not be made just now. The Word file and the preview still work.')
	}
	if (!rendered.ok) return plain(502, `The PDF could not be made (${rendered.status}). Try again in a moment.`)
	return new Response(rendered.body, {
		headers: {
			'content-type': 'application/pdf',
			'content-disposition': `attachment; filename="${document.slug}-draft.pdf"`,
			'cache-control': 'private, no-store',
		},
	})
}

export const Route = createFileRoute('/d/$documentId/draft.pdf')({
	server: {
		handlers: {
			GET: serve,
		},
	},
})
