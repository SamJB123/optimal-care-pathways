/**
 * /d/{documentId}/draft.docx — the document's draft as a Word file, for any member of
 * the document (viewer and up). It holds what publishing now would freeze: the room is
 * folded first so the latest typing is in, then each live section's publishable body in
 * outline order (export/docx.ts writes the file). Nothing is written: the edition number
 * is the open draft's, or the one it would open as.
 *
 * Images are read where the page reads them: an uploaded one (/files/…) from the FILES
 * bucket, the template's own figures from the site's static files (the ASSETS binding).
 */

import { createFileRoute } from '@tanstack/solid-router'
import { desc, eq } from 'drizzle-orm'
import { referencesFor } from '#/api/published.ts'
import { citationNumbers, citedBody, type DerivedView, timeframeRows } from '#/content/derived.ts'
import { type Db, schema } from '#/db/index.ts'
import { draftDocx } from '#/export/docx.ts'
import { lifecycleOf } from '#/server/lifecycle-env.ts'
import { documentOf, foldRoom, LifecycleRefusal, live, resolveSections, roleOn } from '#/server/lifecycle.ts'

const FILES_PREFIX = '/files/'

const plain = (status: number, text: string) =>
	new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })

const serve = async ({ request, params }: { request: Request; params: { documentId: string } }): Promise<Response> => {
	// biome-ignore lint/correctness/noUnresolvedImports: provided by the Workers runtime
	const { env } = await import('cloudflare:workers')
	const cookie = request.headers.get('cookie') ?? ''
	const userId = cookie ? ((await env.AUTH.verifySession(cookie)).user?.id ?? null) : null
	if (!userId) return plain(403, 'Sign in to download the draft.')
	const lc = await lifecycleOf()
	let document: typeof schema.documents.$inferSelect
	try {
		document = await documentOf(lc, params.documentId)
	} catch (error) {
		if (error instanceof LifecycleRefusal) return plain(404, 'Document not found.')
		throw error
	}
	if (!(await roleOn(lc, userId, document))) return plain(403, 'You are not a member of this document.')

	await foldRoom(lc, document.id)
	const resolved = await resolveSections(lc, document.id)
	const parentOf = new Map(resolved.map((s) => [s.row.id, s.row.parentId]))
	const depthOf = (id: string): number => {
		let depth = 0
		for (let p = parentOf.get(id); p; p = parentOf.get(p)) depth++
		return depth
	}
	// What publish freezes: the publishable bodies of the live sections, numbered (headings'
	// own citations first) and snapshotted over those alone.
	const sections = resolved.filter(live)
	const cited = sections.map((s) => ({ titleCitations: s.row.titleCitations, bodyJson: s.publishable }))
	const derived: DerivedView = {
		referenceNumbers: citationNumbers(cited.map((s) => citedBody(s.titleCitations, s.bodyJson))),
		timeframes: timeframeRows(
			sections.map((s) => ({
				stepNumber: s.row.stepNumber,
				address: s.row.address,
				printedNumber: s.row.printedNumber,
				title: s.row.title,
				body: s.publishable,
			})),
		),
		map: null,
	}
	const [references, editionNo, user] = await Promise.all([
		referencesFor(lc.d, cited),
		draftEdition(lc.d, document.id),
		lc.auth.getUserById(userId),
	])

	const origin = new URL(request.url).origin
	const loadImage = async (src: string): Promise<Uint8Array | null> => {
		const url = new URL(src, origin)
		if (url.origin !== origin) return null
		if (url.pathname.startsWith(FILES_PREFIX)) {
			const object = await env.FILES.get(decodeURIComponent(url.pathname.slice(FILES_PREFIX.length)))
			return object ? new Uint8Array(await object.arrayBuffer()) : null
		}
		// The template's figures are the site's own static files: read through the assets
		// binding, never a request back to this hostname.
		const response = await env.ASSETS.fetch(new Request(url))
		return response.ok ? new Uint8Array(await response.arrayBuffer()) : null
	}

	const file = await draftDocx({
		title: document.title,
		editionNo,
		exportedAt: Date.now(),
		exportedBy: user?.name || user?.email || 'a member',
		origin: lc.origin,
		sections: sections.map((s) => ({
			depth: depthOf(s.row.id),
			printedNumber: s.row.printedNumber,
			title: s.row.title ?? s.row.address,
			titleCitations: s.row.titleCitations ?? [],
			body: s.publishable,
		})),
		derived,
		references,
		loadImage,
	})
	return new Response(file, {
		headers: {
			'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			'content-disposition': `attachment; filename="${document.slug}-draft-edition-${editionNo}.docx"`,
			'cache-control': 'private, no-store',
		},
	})
}

/** The draft's version number: the open draft's, else the next after the latest. */
async function draftEdition(d: Db, documentId: string): Promise<number> {
	const latest = (
		await d
			.select({ versionNo: schema.versions.versionNo, status: schema.versions.status })
			.from(schema.versions)
			.where(eq(schema.versions.documentId, documentId))
			.orderBy(desc(schema.versions.versionNo))
			.limit(1)
	)[0]
	if (!latest) return 1
	return latest.status === 'draft' ? latest.versionNo : latest.versionNo + 1
}

export const Route = createFileRoute('/d/$documentId/draft.docx')({
	server: {
		handlers: {
			GET: serve,
		},
	},
})
