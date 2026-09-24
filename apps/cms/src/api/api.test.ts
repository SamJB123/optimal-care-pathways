/**
 * The public API over the real runtime: a core document and two pathways are seeded and
 * PUBLISHED through the lifecycle, then the one operation table is exercised on its
 * three surfaces — the handlers directly, REST through the Hono app chanfana serves
 * (JSON, OpenAPI document, Scalar page, 404s), and the MCP handler (tools listed and
 * called, resources listed and read) — against the same rows.
 */

// biome-ignore lint/correctness/noUnresolvedImports: provided by the vitest workers pool
import { env } from 'cloudflare:test'
import { callOperation } from '@aicolab/app-kit/api'
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { JsonNode } from '#/content/schema.ts'
import { db, schema } from '#/db/index.ts'
import * as lc from '#/server/lifecycle.ts'
import {
	fetchItem,
	getComposed,
	getDocument,
	getDocumentFull,
	getSection,
	listDocuments,
	listVersions,
	search,
} from './operations.ts'
import type { ApiContext } from './published.ts'
import { createApiApp, createMcpServer, mcpHandler } from './server.ts'

const CENTRAL = 'central'
const run = crypto.randomUUID().slice(0, 8)
const CORE_ID = `api-core-${run}`
const CANCER_ID = `api-cancer-${run}`
const POPULATION_ID = `api-population-${run}`
const S_SHARED = `api-s-shared-${run}`
const S_OWNED = `api-s-owned-${run}`
const C_SHARED = `api-c-shared-${run}`
const C_OWNED = `api-c-owned-${run}`
const P_SHARED = `api-p-shared-${run}`
const P_OWNED = `api-p-owned-${run}`
const REF = `api-ref-${run}`
const CANCER_SLUG = `breast-cancer-${run}`
const PARTNER_SLUG = `ocp-breast-${run}`
const POPULATION_SLUG = `older-people-${run}`
const ORIGIN = 'https://pathways.test'

const text = (t: string): JsonNode => ({ type: 'text', text: t })
const paragraph = (...content: JsonNode[]): JsonNode => ({ type: 'paragraph', content })
const doc = (...content: JsonNode[]): JsonNode => ({ type: 'doc', content })

/** The text of a node or of loose node JSON from the wire. */
const plain = (node: unknown): string => {
	if (typeof node !== 'object' || node === null) return ''
	const record: Record<string, unknown> = { ...node }
	if (typeof record.text === 'string') return record.text
	return Array.isArray(record.content) ? record.content.map(plain).join('') : ''
}

const lifecycle = (): lc.Lifecycle => ({
	d: db(env.DB),
	auth: env.AUTH,
	rooms: env.DOCUMENT_ROOM,
	centralOrgId: async () => CENTRAL,
	origin: ORIGIN,
	renderHtml: (body) => `<div class="ocp-body">${plain(body)}</div>`,
})

const ctx = (): ApiContext => ({ d: db(env.DB), origin: ORIGIN })

async function publish(documentId: string, org: string) {
	await lc.requestReview(lifecycle(), { documentId, userId: `member@${org}`, note: null })
	const state = await lc.documentState(lifecycle(), documentId, `admin@${org}`)
	if (!state.review) throw new Error('no review')
	for (const change of state.changes)
		await lc.decideSection(lifecycle(), {
			reviewId: state.review.reviewId,
			sectionId: change.sectionId,
			decision: 'approved',
			note: null,
			userId: `admin@${org}`,
		})
	return lc.publish(lifecycle(), {
		documentId,
		userId: `owner@${CENTRAL}`,
		label: 'First edition',
		releaseNotes: 'Initial.',
	})
}

beforeAll(async () => {
	const d = db(env.DB)
	await d
		.insert(schema.templates)
		.values({ id: 'cancer-test', kind: 'cancer', label: 'test', sourceFile: 'test.pdf' })
		.onConflictDoNothing()
	await d.insert(schema.documents).values([
		{
			id: CORE_ID,
			kind: 'core',
			templateId: 'cancer-test',
			orgId: CENTRAL,
			slug: `core-${run}`,
			title: 'Core content',
			subject: 'cancer',
			audience: 'cancer',
		},
		{
			id: CANCER_ID,
			kind: 'pathway',
			templateId: 'cancer-test',
			orgId: 'org-c',
			slug: CANCER_SLUG,
			partnerSlug: PARTNER_SLUG,
			title: 'Breast cancer',
			subject: 'breast cancer',
			audience: 'cancer',
		},
		{
			id: POPULATION_ID,
			kind: 'pathway',
			templateId: 'cancer-test',
			orgId: 'org-p',
			slug: POPULATION_SLUG,
			title: 'Older people',
			subject: 'older people',
			audience: 'population',
		},
	])
	await d.insert(schema.references).values({
		id: REF,
		documentId: CORE_ID,
		citation: 'Smith J. A reference. 2026.',
		url: 'https://example.org/ref',
	})
	const sharedBody = doc(
		paragraph(text('Multidisciplinary care improves outcomes.'), {
			type: 'citation',
			attrs: { referenceId: REF },
		}),
	)
	await d.insert(schema.sections).values([
		{
			id: S_SHARED,
			documentId: CORE_ID,
			parentId: null,
			address: '1',
			canonical: true,
			printedNumber: '1',
			title: 'Principles',
			orderIndex: 1,
			ownership: 'owned',
			pathwayOwnership: 'shared',
			bodyJson: sharedBody,
		},
		{
			id: S_OWNED,
			documentId: CORE_ID,
			parentId: null,
			address: '2',
			canonical: true,
			printedNumber: '2',
			title: 'Referral',
			orderIndex: 2,
			ownership: 'owned',
			pathwayOwnership: 'owned',
			bodyJson: doc(paragraph(text('Core referral text.'))),
		},
		{
			id: C_SHARED,
			documentId: CANCER_ID,
			parentId: null,
			address: '1',
			canonical: true,
			printedNumber: '1',
			title: 'Principles',
			orderIndex: 1,
			ownership: 'shared',
			coreSectionId: S_SHARED,
			bodyJson: null,
		},
		{
			id: C_OWNED,
			documentId: CANCER_ID,
			parentId: null,
			address: '2',
			canonical: true,
			printedNumber: '2',
			title: 'Referral',
			orderIndex: 2,
			ownership: 'owned',
			bodyJson: doc(
				paragraph(text('Refer people with breast cancer to a breast surgeon promptly.')),
			),
		},
		{
			id: P_SHARED,
			documentId: POPULATION_ID,
			parentId: null,
			address: '1',
			canonical: true,
			printedNumber: '1',
			title: 'Principles',
			orderIndex: 1,
			ownership: 'shared',
			coreSectionId: S_SHARED,
			bodyJson: null,
		},
		{
			id: P_OWNED,
			documentId: POPULATION_ID,
			parentId: null,
			address: '2',
			canonical: true,
			printedNumber: '2',
			title: 'Referral',
			orderIndex: 2,
			ownership: 'owned',
			bodyJson: doc(paragraph(text('Consider frailty when referring older people.'))),
		},
	])
	await publish(CORE_ID, CENTRAL)
	await publish(CANCER_ID, 'org-c')
	await publish(POPULATION_ID, 'org-p')
})

describe('the operation table', () => {
	it('lists documents by partner slug, newest publish first', async () => {
		const { documents } = await listDocuments.handler({}, ctx())
		const ours = documents.filter((d) => d.slug.endsWith(run))
		expect(ours.map((d) => d.slug)).toEqual([POPULATION_SLUG, PARTNER_SLUG, `core-${run}`])
		expect(ours[1]?.url).toBe(`${ORIGIN}/p/${PARTNER_SLUG}`)
		expect(ours[1]?.version).toBe(1)
		expect(ours[1]?.label).toBe('First edition')
	})

	it('gets a document’s outline and numbered references, by partner slug or our slug', async () => {
		const byPartner = await getDocument.handler({ slug: PARTNER_SLUG }, ctx())
		const byOwn = await getDocument.handler({ slug: CANCER_SLUG }, ctx())
		expect(byOwn.document.slug).toBe(PARTNER_SLUG)
		expect(byPartner.outline.map((s) => [s.address, s.ownership])).toEqual([
			['1', 'shared'],
			['2', 'owned'],
		])
		expect(byPartner.references).toEqual([
			{
				number: 1,
				id: REF,
				citation: 'Smith J. A reference. 2026.',
				url: 'https://example.org/ref',
			},
		])
	})

	it('gets a section in one form per call, Markdown unless asked, with only its own references', async () => {
		// The door's own validation fills the default: Markdown.
		const shared = await callOperation(getSection, { slug: PARTNER_SLUG, address: '1' }, ctx())
		expect(shared.format).toBe('markdown')
		expect(shared.section.content).toContain('[^1]')
		expect(shared.references.map((r) => r.number)).toEqual([1])
		const html = await callOperation(
			getSection,
			{ slug: PARTNER_SLUG, address: '1', format: 'html' },
			ctx(),
		)
		expect(html.section.content).toContain('Multidisciplinary')
		expect(html.section.content).toContain('<')
		const json = await callOperation(
			getSection,
			{ slug: PARTNER_SLUG, address: '1', format: 'json' },
			ctx(),
		)
		expect(plain(json.section.content)).toBe('Multidisciplinary care improves outcomes.')
		const own = await callOperation(getSection, { slug: PARTNER_SLUG, address: '2' }, ctx())
		expect(own.references).toEqual([])
		await expect(
			callOperation(getSection, { slug: PARTNER_SLUG, address: '9' }, ctx()),
		).rejects.toThrow(/no section/)
	})

	it('names the nearest published documents when a slug names nothing, on every door', async () => {
		// "older people" is the population pathway's title; the slug carries the run suffix.
		await expect(callOperation(getDocument, { slug: 'older-people' }, ctx())).rejects.toThrow(
			new RegExp(`Did you mean .*"${POPULATION_SLUG}" \\(Older people\\)`),
		)
		// A common name for a cancer the documents call something else.
		await expect(callOperation(getDocument, { slug: 'brest' }, ctx())).rejects.toThrow(
			new RegExp(`Did you mean .*"${PARTNER_SLUG}" \\(Breast cancer\\)`),
		)
		await expect(callOperation(getDocument, { slug: 'zzzz-qqqq' }, ctx())).rejects.toThrow(
			/No document is published at "zzzz-qqqq"\. list_documents/,
		)
	})

	it('returns the whole document, or one part of it, lists versions and reads an archived version by number', async () => {
		const full = await callOperation(getDocumentFull, { slug: PARTNER_SLUG }, ctx())
		expect(full.sections.map((s) => s.address)).toEqual(['1', '2'])
		expect(full.part).toBeNull()
		expect(full.format).toBe('markdown')
		expect(typeof full.sections[0]?.content).toBe('string')
		// The test document's sections are Step 1 and Step 2: a part takes one of them, with
		// only the references that part cites, numbered as the whole document numbers them.
		const step2 = await callOperation(getDocumentFull, { slug: PARTNER_SLUG, part: '2' }, ctx())
		expect(step2.sections.map((s) => s.address)).toEqual(['2'])
		expect(step2.references).toEqual([])
		const step1 = await callOperation(getDocumentFull, { slug: PARTNER_SLUG, part: '1' }, ctx())
		expect(step1.sections.map((s) => s.address)).toEqual(['1'])
		expect(step1.references.map((r) => r.number)).toEqual([1])
		const front = await callOperation(getDocumentFull, { slug: PARTNER_SLUG, part: 'front' }, ctx())
		expect(front.sections).toEqual([])
		const versions = await listVersions.handler({ slug: PARTNER_SLUG }, ctx())
		expect(versions.versions.map((v) => [v.version, v.status])).toEqual([
			[2, 'draft'],
			[1, 'published'],
		])
		const v1 = await getDocument.handler({ slug: PARTNER_SLUG, version: 1 }, ctx())
		expect(v1.document.version).toBe(1)
		await expect(getDocument.handler({ slug: PARTNER_SLUG, version: 7 }, ctx())).rejects.toThrow(
			/version 7/,
		)
	})

	it('composes a cancer pathway with a population pathway, shared content once', async () => {
		const composed = await callOperation(
			getComposed,
			{ cancer: PARTNER_SLUG, population: POPULATION_SLUG },
			ctx(),
		)
		expect(composed.sections.map((s) => [s.address, s.source])).toEqual([
			['1', 'shared'],
			['2', 'cancer'],
			['2', 'population'],
		])
		expect(composed.references.map((r) => r.number)).toEqual([1])
		expect(composed.format).toBe('markdown')
		const step2 = await callOperation(
			getComposed,
			{ cancer: PARTNER_SLUG, population: POPULATION_SLUG, part: '2', format: 'json' },
			ctx(),
		)
		expect(step2.sections.map((s) => [s.address, s.source])).toEqual([
			['2', 'cancer'],
			['2', 'population'],
		])
		expect(plain(step2.sections[1]?.content)).toContain('frailty')
		expect(step2.references).toEqual([])
	})

	it('searches published text (stemmed, ranked, marked) and fetches an item by id', async () => {
		const hits = await search.handler({ query: 'frailty', limit: 10 }, ctx())
		expect(hits.results.map((h) => h.id)).toEqual([`${POPULATION_SLUG}#2`])
		expect(hits.results[0]?.url).toBe(`${ORIGIN}/p/${POPULATION_SLUG}#2`)
		expect(hits.results[0]?.snippet).toContain('**frailty**')
		// A stem finds its inflections; a word from the title ranks its section first.
		const stemmed = await search.handler({ query: 'referring older', limit: 10 }, ctx())
		expect(stemmed.results.map((h) => h.id)).toEqual([`${POPULATION_SLUG}#2`])
		// Nothing has every word: any word will do.
		const any = await search.handler({ query: 'frailty nonexistentword', limit: 10 }, ctx())
		expect(any.results.map((h) => h.id)).toEqual([`${POPULATION_SLUG}#2`])
		const item = await fetchItem.handler({ id: `${POPULATION_SLUG}#2` }, ctx())
		expect(item.text).toContain('frailty')
		expect(item.metadata?.version).toBe('1')
		await expect(fetchItem.handler({ id: 'nonsense' }, ctx())).rejects.toThrow(/item id/)
	})
})

describe('REST through chanfana', () => {
	const app = createApiApp()
	const call = (path: string) => app.fetch(new Request(`${ORIGIN}${path}`), env)

	it('serves JSON from the same handlers, with 404s for missing things', async () => {
		const list = await call('/api/v1/documents')
		expect(list.status).toBe(200)
		const body = z
			.object({ documents: z.array(z.object({ slug: z.string() })) })
			.parse(await list.json())
		expect(body.documents.some((d) => d.slug === PARTNER_SLUG)).toBe(true)
		const section = await call(`/api/v1/documents/${PARTNER_SLUG}/sections/1`)
		expect(section.status).toBe(200)
		expect(
			z
				.object({ format: z.string(), section: z.object({ content: z.string() }) })
				.parse(await section.json()),
		).toMatchObject({ format: 'markdown' })
		const asHtml = await call(`/api/v1/documents/${PARTNER_SLUG}/sections/1?format=html`)
		expect(
			z.object({ section: z.object({ content: z.string() }) }).parse(await asHtml.json()).section
				.content,
		).toContain('<')
		const part = await call(`/api/v1/documents/${PARTNER_SLUG}/full?part=2`)
		expect(
			z
				.object({ part: z.string(), sections: z.array(z.object({ address: z.string() })) })
				.parse(await part.json()),
		).toEqual({ part: '2', sections: [{ address: '2' }] })
		const nowhereNear = await call('/api/v1/documents/older-people')
		expect(nowhereNear.status).toBe(404)
		expect(
			z
				.object({ errors: z.array(z.object({ message: z.string() })) })
				.parse(await nowhereNear.json()).errors[0]?.message,
		).toContain(`"${POPULATION_SLUG}" (Older people)`)
		const missing = await call(`/api/v1/documents/${PARTNER_SLUG}/sections/9`)
		expect(missing.status).toBe(404)
		const nowhere = await call('/api/v1/documents/no-such-document')
		expect(nowhere.status).toBe(404)
		const searched = await call('/api/v1/search?query=frailty&limit=5')
		expect(
			z.object({ results: z.array(z.unknown()) }).parse(await searched.json()).results,
		).toHaveLength(1)
	})

	it('routes "<slug>.pdf" to the PDF, not to the document named "<slug>.pdf"', async () => {
		// The test runtime has no Browser Run binding, so the PDF route cannot render here;
		// what matters is that it is the route that answers. Before the fix the REST
		// operation `/documents/:slug` did, with a 404 for a document called "<slug>.pdf".
		for (const path of [
			`/api/v1/documents/${PARTNER_SLUG}.pdf`,
			`/api/v1/documents/${PARTNER_SLUG}-quick-reference-guide.pdf`,
		]) {
			const response = await call(path)
			const text = await response.text()
			expect(text).not.toContain('No document is published')
			expect(response.status).not.toBe(404)
		}
	})

	it('publishes an OpenAPI 3.1 document naming every operation, and a Scalar page', async () => {
		const spec = await call('/api/v1/openapi.json')
		expect(spec.status).toBe(200)
		const json = z
			.object({
				openapi: z.string(),
				paths: z.record(
					z.string(),
					z.record(z.string(), z.looseObject({ operationId: z.string().optional() })),
				),
			})
			.parse(await spec.json())
		expect(json.openapi.startsWith('3.1')).toBe(true)
		const operationIds = Object.values(json.paths).flatMap((methods) =>
			Object.values(methods).map((op) => op.operationId),
		)
		expect(operationIds).toEqual(
			expect.arrayContaining([
				'list_documents',
				'get_document',
				'get_section',
				'get_document_full',
				'list_versions',
				'get_composed',
				'search',
				'fetch',
			]),
		)
		const docs = await call('/api/v1/docs')
		expect(docs.status).toBe(200)
		expect(await docs.text()).toContain('Scalar.createApiReference')
	})
})

describe('MCP', () => {
	it('registers a tool per operation and the two resource templates', async () => {
		const server = createMcpServer(ctx())
		// The SDK's server keeps its registry private; a modern request lists what it holds.
		const handler = mcpHandler(env)
		const list = await handler.fetch(
			new Request(`${ORIGIN}/mcp`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					accept: 'application/json, text/event-stream',
					'mcp-protocol-version': '2025-06-18',
				},
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
			}),
		)
		expect(list.status).toBe(200)
		const payload = await responseJson(list)
		const names = z
			.object({ tools: z.array(z.object({ name: z.string() })) })
			.parse(payload.result)
			.tools.map((t) => t.name)
			.sort()
		expect(names).toEqual(
			[
				'fetch',
				'get_composed',
				'get_document',
				'get_document_full',
				'get_quick_reference_guide',
				'get_section',
				'list_documents',
				'list_versions',
				'search',
			].sort(),
		)
		expect(server).toBeDefined()
	})

	it('calls a tool and returns structured content beside the JSON text', async () => {
		const handler = mcpHandler(env)
		const response = await handler.fetch(
			new Request(`${ORIGIN}/mcp`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					accept: 'application/json, text/event-stream',
					'mcp-protocol-version': '2025-06-18',
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 2,
					method: 'tools/call',
					params: { name: 'get_section', arguments: { slug: PARTNER_SLUG, address: '1' } },
				}),
			}),
		)
		expect(response.status).toBe(200)
		const payload = await responseJson(response)
		const result = z
			.object({
				structuredContent: z.object({ section: z.object({ address: z.string() }) }),
				content: z.array(z.object({ type: z.string(), text: z.string() })),
			})
			.parse(payload.result)
		expect(result.structuredContent.section.address).toBe('1')
		expect(result.content[0]?.text).toContain('"address":"1"')
		// Markdown by default here too: one form, the same on every door.
		expect(result.content[0]?.text).toContain('"format":"markdown"')
		expect(result.content[0]?.text).not.toContain('"html":')
	})

	it('answers an unknown slug with the nearest documents, as a tool error', async () => {
		const handler = mcpHandler(env)
		const response = await handler.fetch(
			new Request(`${ORIGIN}/mcp`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					accept: 'application/json, text/event-stream',
					'mcp-protocol-version': '2025-06-18',
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 3,
					method: 'tools/call',
					params: { name: 'get_document', arguments: { slug: 'older-people' } },
				}),
			}),
		)
		const payload = await responseJson(response)
		const result = z
			.object({ isError: z.boolean(), content: z.array(z.object({ text: z.string() })) })
			.parse(payload.result)
		expect(result.isError).toBe(true)
		expect(result.content[0]?.text).toContain(`"${POPULATION_SLUG}" (Older people)`)
	})
})

/** The handler answers JSON or SSE by client preference; read whichever came back. */
const rpcReply = z.object({ result: z.unknown().optional(), error: z.unknown().optional() })

async function responseJson(response: Response): Promise<z.infer<typeof rpcReply>> {
	const type = response.headers.get('content-type') ?? ''
	const body = await response.text()
	if (type.includes('text/event-stream')) {
		const data = body
			.split('\n')
			.filter((line) => line.startsWith('data:'))
			.map((line) => line.slice(5).trim())
			.at(-1)
		return rpcReply.parse(JSON.parse(data ?? '{}'))
	}
	return rpcReply.parse(JSON.parse(body))
}

// Keep the reference row queryable by id in the assertions above.
void eq
