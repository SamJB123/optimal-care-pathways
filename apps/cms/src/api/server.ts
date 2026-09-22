/**
 * The public API's three servers, built from the one operation table (decision 122):
 * the Hono app chanfana serves REST + OpenAPI + Scalar from, the MCP handler, and the
 * context every handler runs with. The routes under `routes/` only mount these.
 *
 * Also here: the PDF of a published version (decision 126) — not a table operation,
 * because it is a binary the browser renders from the public read page, cached by
 * Workers Cache under a per-document tag that publishing purges.
 */

import { registerMcpTools, registerRest } from '@aicolab/app-kit/api'
import { createMcpHandler, McpServer, type McpHttpHandler, ResourceTemplate } from '@modelcontextprotocol/server'
import { Hono } from 'hono'
import { db } from '#/db/index.ts'
import { listDocuments, operations } from './operations.ts'
import { type ApiContext, documentUrl, listPublished, sectionsOf, sectionText, versionOf } from './published.ts'

export const API_BASE = '/api/v1'
export const API_TITLE = 'Optimal Care Pathways — published content'

/** The tag a document's cached responses carry; publishing purges it. */
export const cacheTagFor = (slug: string): string => `document-${slug}`

export const apiContext = (env: Cloudflare.Env): ApiContext => ({
	d: db(env.DB),
	origin: env.PUBLIC_ORIGIN,
})

type Bindings = { Bindings: Cloudflare.Env }

/** REST + OpenAPI + Scalar + the PDF, on one Hono app under /api/v1. */
export function createApiApp(): Hono<Bindings> {
	const app = new Hono<Bindings>()
	registerRest(app, {
		base: API_BASE,
		title: API_TITLE,
		docsPath: '/docs',
		operations,
		context: (c) => apiContext(c.env),
		schema: {
			info: {
				title: API_TITLE,
				version: '1',
				description:
					'Read the published versions of the Optimal Care Pathways and their core content: documents, outlines, sections as JSON, HTML and Markdown, numbered references, versions, a composed cancer-plus-population view and search. The same operations are available as MCP tools at /mcp.',
			},
		},
	})

	// The PDF of the current published version, rendered by Browser Run from the public
	// read page and cached until the document is next published.
	app.get(`${API_BASE}/documents/:slug{[a-zA-Z0-9-]+}.pdf`, async (c) => {
		const slug = c.req.param('slug')
		const ctx = apiContext(c.env)
		const v = await versionOf(ctx.d, slug)
		const rendered = await c.env.BROWSER.quickAction('pdf', {
			url: documentUrl(ctx.origin, v.slug),
			pdfOptions: {
				format: 'a4',
				printBackground: true,
				margin: { top: '18mm', right: '16mm', bottom: '18mm', left: '16mm' },
			},
			gotoOptions: { waitUntil: 'networkidle0' },
		})
		if (!rendered.ok) return c.text(`The PDF could not be rendered (${rendered.status}).`, 502)
		return new Response(rendered.body, {
			headers: {
				'content-type': 'application/pdf',
				'content-disposition': `inline; filename="${v.slug}-v${v.version}.pdf"`,
				'cache-control': 'public, max-age=86400, stale-while-revalidate=3600',
				'cache-tag': cacheTagFor(v.slug),
			},
		})
	})

	return app
}

/**
 * The MCP server for one request (decision 124): every operation as a tool, plus
 * resources for the documents and sections so hosts that let people pick context can
 * offer them. Stateless per the 2026-07-28 spec; 2025-era clients are served statelessly
 * from the same factory.
 */
export function createMcpServer(ctx: ApiContext): McpServer {
	const server = new McpServer({ name: 'optimal-care-pathways', version: '1.0.0' })
	registerMcpTools(server, operations, ctx)
	const cacheHint = { ttlMs: 5 * 60_000, cacheScope: 'public' as const }
	server.registerResource(
		'document',
		new ResourceTemplate('ocp://{slug}', {
			list: async () => ({
				resources: (await listPublished(ctx.d)).map((v) => ({
					uri: `ocp://${v.slug}`,
					name: v.title,
					description: `Version ${v.version}${v.label ? ` (${v.label})` : ''}, published content as Markdown`,
					mimeType: 'text/markdown',
				})),
			}),
		}),
		{ description: 'A published document as Markdown, every section in order.', mimeType: 'text/markdown', cacheHint },
		async (uri, { slug }) => {
			const v = await versionOf(ctx.d, String(slug))
			const sections = await sectionsOf(ctx.d, v.versionId)
			const text = [
				`# ${v.title}`,
				`Version ${v.version}${v.label ? ` — ${v.label}` : ''}`,
				...sections.map((s) => `## ${[s.printedNumber, s.title].filter(Boolean).join(' ') || s.address}\n\n${sectionText(s)}`),
			].join('\n\n')
			return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] }
		},
	)
	server.registerResource(
		'section',
		new ResourceTemplate('ocp://{slug}/{+address}', { list: undefined }),
		{ description: 'One section of a published document as Markdown.', mimeType: 'text/markdown', cacheHint },
		async (uri, { slug, address }) => {
			const v = await versionOf(ctx.d, String(slug))
			const found = (await sectionsOf(ctx.d, v.versionId)).find((s) => s.address === String(address))
			if (!found) return { contents: [] }
			return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: sectionText(found) }] }
		},
	)
	return server
}

let handler: McpHttpHandler | null = null

/** The MCP HTTP handler, one per isolate; a fresh server per request. */
export function mcpHandler(env: Cloudflare.Env): McpHttpHandler {
	// One JSON body per call: nothing here notifies mid-call, and JSON is the shape a
	// public read endpoint is cached and debugged in.
	handler ??= createMcpHandler(() => createMcpServer(apiContext(env)), {
		legacy: 'stateless',
		responseMode: 'json',
	})
	return handler
}

/** What the reference lists first: the discovery operation's name. */
export const FIRST_CALL = listDocuments.name
