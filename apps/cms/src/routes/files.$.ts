/**
 * /files/* — files in the FILES bucket, by key: uploaded images (src/server/files.ts) and
 * the previous editions' PDFs (legacy/…, scripts/upload-legacy-pdfs.ts). Public: a
 * published page shows its images, and the previous edition as printed links its PDF. A
 * key is never reused, so a response is cached for good. An uploaded SVG is served as an
 * inert document (no script, no requests of its own), so a drawing can never act as a
 * page of this site.
 */

import { createFileRoute } from '@tanstack/solid-router'

const PREFIX = '/files/'

const serve = async ({ request }: { request: Request }): Promise<Response> => {
	const path = new URL(request.url).pathname
	const key = path.startsWith(PREFIX) ? decodeURIComponent(path.slice(PREFIX.length)) : ''
	if (key === '' || key.split('/').some((part) => part === '' || part === '.' || part === '..'))
		return new Response('Not found', { status: 404 })
	// biome-ignore lint/correctness/noUnresolvedImports: provided by the Workers runtime
	const { env } = await import('cloudflare:workers')
	const object = await env.FILES.get(key, { onlyIf: request.headers })
	if (!object) return new Response('Not found', { status: 404 })
	const headers = new Headers()
	object.writeHttpMetadata(headers)
	headers.set('etag', object.httpEtag)
	headers.set('cache-control', 'public, max-age=31536000, immutable')
	headers.set('x-content-type-options', 'nosniff')
	if (!headers.has('content-type')) headers.set('content-type', 'application/octet-stream')
	// A PDF opens in the browser's own viewer, which a sandboxed document refuses; every
	// other file is served inert.
	if (headers.get('content-type') !== 'application/pdf')
		headers.set('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
	// A conditional GET the stored copy already satisfies: the object comes back bodiless.
	if (!('body' in object)) return new Response(null, { status: 304, headers })
	return new Response(request.method === 'HEAD' ? null : object.body, { headers })
}

export const Route = createFileRoute('/files/$')({
	server: {
		handlers: {
			GET: serve,
			HEAD: serve,
		},
	},
})
