/**
 * THE operation table for published content (decisions 122, 125): each read declared
 * once, served over REST (chanfana), MCP (SDK v2 tools) and capnweb. Public: published
 * versions only, no drafts, no identity.
 *
 * Identifiers: a document by slug (Cancer Council's partner slug when set); a section by
 * its canonical address within the document ("3.1", "2/supportive-care"); an item, for
 * search and fetch, as `slug#address`.
 */

import { NotFound, operationsFor } from '@aicolab/app-kit/api'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { citationNumbers } from '#/content/derived.ts'
import type { JsonNode } from '#/content/schema.ts'
import { schema } from '#/db/index.ts'
import {
	type ApiContext,
	documentUrl,
	type FrozenSection,
	listPublished,
	type PublishedVersion,
	referencesFor,
	searchPublished,
	sectionText,
	sectionUrl,
	sectionsOf,
	versionOf,
} from './published.ts'

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

const slug = z
	.string()
	.min(1)
	.max(120)
	.describe('The document slug (the partner slug when one is set)')
const address = z
	.string()
	.min(1)
	.max(200)
	.describe('The section address within the document, e.g. "3.1" or "2/supportive-care"')
const version = z.coerce
	.number()
	.int()
	.positive()
	.optional()
	.describe('A version number; the current published version when omitted')

const documentSummary = z.object({
	slug: z.string(),
	title: z.string(),
	kind: z.enum(['core', 'pathway']),
	audience: z.enum(['cancer', 'population', 'principles']),
	subject: z.string(),
	version: z.number().int(),
	label: z.string().nullable(),
	releaseNotes: z.string().nullable(),
	publishedAt: z.string().nullable().describe('ISO 8601'),
	url: z.string(),
})

const outlineEntry = z.object({
	address: z.string(),
	parentAddress: z.string().nullable(),
	title: z.string().nullable(),
	printedNumber: z.string().nullable(),
	ownership: z
		.enum(['shared', 'owned'])
		.describe('shared = the core document’s content, rendered by reference'),
	pointOfCare: z.boolean(),
	lastChangedVersion: z
		.number()
		.int()
		.describe('The version in which this section’s content last changed'),
	url: z.string(),
})

/** A body is ProseMirror JSON in the content schema (src/content/schema.ts): a `doc` node
 *  whose `content` holds the template's block nodes. The content schema is the contract;
 *  on the wire the API describes the node shape loosely (a typed node with any further
 *  fields) so both OpenAPI and MCP's JSON Schema can state it, and readers validate
 *  against the real schema (`parseBody`). */
const body = z
	.looseObject({ type: z.string().describe('The node type, "doc" at the top') })
	.nullable()
	.describe('The section body as ProseMirror JSON in the content schema')

/** A frozen body as the API carries it: the same JSON, typed as the wire shape. */
const wireBody = (node: JsonNode | null): z.output<typeof body> => (node ? { ...node } : null)

const define = operationsFor<ApiContext>()

const section = outlineEntry.extend({
	body,
	html: z.string().nullable(),
	markdown: z.string().nullable(),
})

const reference = z.object({
	number: z.number().int(),
	id: z.string(),
	citation: z.string(),
	url: z.string().nullable(),
})

const versionEntry = z.object({
	version: z.number().int(),
	status: z.enum(['draft', 'published', 'archived']),
	label: z.string().nullable(),
	releaseNotes: z.string().nullable(),
	publishedAt: z.string().nullable(),
})

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

const iso = (date: Date | null): string | null => date?.toISOString() ?? null

const summaryOf = (ctx: ApiContext, v: PublishedVersion): z.output<typeof documentSummary> => ({
	slug: v.slug,
	title: v.title,
	kind: v.kind,
	audience: v.audience,
	subject: v.subject,
	version: v.version,
	label: v.label,
	releaseNotes: v.releaseNotes,
	publishedAt: iso(v.publishedAt),
	url: documentUrl(ctx.origin, v.slug),
})

const outlineOf = (
	ctx: ApiContext,
	slugValue: string,
	s: FrozenSection,
): z.output<typeof outlineEntry> => ({
	address: s.address,
	parentAddress: s.parentAddress,
	title: s.title,
	printedNumber: s.printedNumber,
	ownership: s.ownership,
	pointOfCare: s.pointOfCare,
	lastChangedVersion: s.lastChangedVersionNo,
	url: sectionUrl(ctx.origin, slugValue, s.address),
})

const sectionOf = (
	ctx: ApiContext,
	slugValue: string,
	s: FrozenSection,
): z.output<typeof section> => ({
	...outlineOf(ctx, slugValue, s),
	body: wireBody(s.bodyJson ?? null),
	html: s.html,
	markdown: s.markdown,
})

const ITEM = /^([^#]+)#(.+)$/

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

export const listDocuments = define({
	name: 'list_documents',
	summary: 'List the published documents',
	description:
		'Every Optimal Care Pathway and core-content document that has a published version, with its slug, current version, label, release notes and publish date. Call this first to find a slug.',
	tags: ['documents'],
	input: z.object({}),
	output: z.object({ documents: z.array(documentSummary) }),
	rest: { method: 'GET', path: '/documents' },
	handler: async (_input, ctx) => ({
		documents: (await listPublished(ctx.d)).map((v) => summaryOf(ctx, v)),
	}),
})

export const getDocument = define({
	name: 'get_document',
	summary: 'Get a document’s outline and references',
	description:
		'One published document: its summary, the outline of its sections in reading order (addresses, titles, which are shared core content, per-section last-changed version) and its numbered References list. Bodies are not included; use get_section or get_document_full.',
	tags: ['documents'],
	input: z.object({ slug, version }),
	output: z.object({
		document: documentSummary,
		outline: z.array(outlineEntry),
		references: z.array(reference),
	}),
	rest: { method: 'GET', path: '/documents/{slug}' },
	handler: async ({ slug: slugValue, version: versionNo }, ctx) => {
		const v = await versionOf(ctx.d, slugValue, versionNo)
		const sections = await sectionsOf(ctx.d, v.versionId)
		return {
			document: summaryOf(ctx, v),
			outline: sections.map((s) => outlineOf(ctx, v.slug, s)),
			references: await referencesFor(
				ctx.d,
				sections.map((s) => s.bodyJson ?? null),
			),
		}
	},
})

export const getSection = define({
	name: 'get_section',
	summary: 'Get one section',
	description:
		'One section of a published document by its address: the body as content-schema JSON, as HTML and as Markdown, plus the references it cites numbered as the whole document numbers them. Cross-references to other sections are typed links carrying the target address.',
	tags: ['sections'],
	input: z.object({ slug, address, version }),
	output: z.object({
		document: documentSummary,
		section,
		references: z.array(reference),
	}),
	rest: { method: 'GET', path: '/documents/{slug}/sections/{address+}' },
	handler: async ({ slug: slugValue, address: addressValue, version: versionNo }, ctx) => {
		const v = await versionOf(ctx.d, slugValue, versionNo)
		const sections = await sectionsOf(ctx.d, v.versionId)
		const found = sections.find((s) => s.address === addressValue)
		if (!found) throw new NotFound(`"${v.title}" has no section "${addressValue}".`)
		// Numbered as the whole document numbers them, filtered to what this section cites.
		const all = await referencesFor(
			ctx.d,
			sections.map((s) => s.bodyJson ?? null),
		)
		const cited = new Set(Object.keys(citationNumbers([found.bodyJson ?? null])))
		return {
			document: summaryOf(ctx, v),
			section: sectionOf(ctx, v.slug, found),
			references: all.filter((r) => cited.has(r.id)),
		}
	},
})

export const getDocumentFull = define({
	name: 'get_document_full',
	summary: 'Get a whole document',
	description:
		'A published document with every section in reading order, each with its body as JSON, HTML and Markdown, and the numbered References list. Large; prefer get_document plus get_section when you need one part.',
	tags: ['documents'],
	input: z.object({ slug, version }),
	output: z.object({
		document: documentSummary,
		sections: z.array(section),
		references: z.array(reference),
	}),
	rest: { method: 'GET', path: '/documents/{slug}/full' },
	handler: async ({ slug: slugValue, version: versionNo }, ctx) => {
		const v = await versionOf(ctx.d, slugValue, versionNo)
		const sections = await sectionsOf(ctx.d, v.versionId)
		return {
			document: summaryOf(ctx, v),
			sections: sections.map((s) => sectionOf(ctx, v.slug, s)),
			references: await referencesFor(
				ctx.d,
				sections.map((s) => s.bodyJson ?? null),
			),
		}
	},
})

export const listVersions = define({
	name: 'list_versions',
	summary: 'List a document’s versions',
	description:
		'Every version of a document, newest first: the draft in progress, the published one and the archived ones, with labels, release notes and publish dates. Pass a version number to get_document, get_section or get_document_full to read an archived version.',
	tags: ['documents'],
	input: z.object({ slug }),
	output: z.object({ document: documentSummary, versions: z.array(versionEntry) }),
	rest: { method: 'GET', path: '/documents/{slug}/versions' },
	handler: async ({ slug: slugValue }, ctx) => {
		const v = await versionOf(ctx.d, slugValue)
		const rows = await ctx.d
			.select()
			.from(schema.versions)
			.where(eq(schema.versions.documentId, v.documentId))
			.orderBy(desc(schema.versions.versionNo))
		return {
			document: summaryOf(ctx, v),
			versions: rows.map((r) => ({
				version: r.versionNo,
				status: r.status,
				label: r.label,
				releaseNotes: r.releaseNotes,
				publishedAt: iso(r.publishedAt),
			})),
		}
	},
})

const composedSection = section.extend({
	source: z
		.enum(['shared', 'cancer', 'population'])
		.describe(
			'shared = core content both pathways render; cancer/population = that pathway’s own section',
		),
})

export const getComposed = define({
	name: 'get_composed',
	summary: 'Compose a cancer pathway with a population pathway',
	description:
		'The cancer-type pathway and the population-group pathway read together (decision 14): the cancer pathway’s sections in order, each followed by the population pathway’s own section at the same address when it has one; shared core content appears once. Population sections with no cancer counterpart come last.',
	tags: ['documents'],
	input: z.object({
		cancer: slug.describe('The cancer-type pathway’s slug'),
		population: slug.describe('The population-group pathway’s slug'),
	}),
	output: z.object({
		cancer: documentSummary,
		population: documentSummary,
		sections: z.array(composedSection),
		references: z.array(reference),
	}),
	rest: { method: 'GET', path: '/composed/{cancer}/{population}' },
	handler: async ({ cancer, population }, ctx) => {
		const c = await versionOf(ctx.d, cancer)
		const p = await versionOf(ctx.d, population)
		const cs = await sectionsOf(ctx.d, c.versionId)
		const ps = await sectionsOf(ctx.d, p.versionId)
		const populationOwned = new Map(
			ps.filter((s) => s.ownership === 'owned').map((s) => [s.address, s]),
		)
		const ordered: {
			section: FrozenSection
			slug: string
			source: 'shared' | 'cancer' | 'population'
		}[] = []
		for (const s of cs) {
			ordered.push({
				section: s,
				slug: c.slug,
				source: s.ownership === 'shared' ? 'shared' : 'cancer',
			})
			const own = populationOwned.get(s.address)
			if (own) {
				ordered.push({ section: own, slug: p.slug, source: 'population' })
				populationOwned.delete(s.address)
			}
		}
		for (const own of populationOwned.values())
			ordered.push({ section: own, slug: p.slug, source: 'population' })
		return {
			cancer: summaryOf(ctx, c),
			population: summaryOf(ctx, p),
			sections: ordered.map((o) => ({ ...sectionOf(ctx, o.slug, o.section), source: o.source })),
			references: await referencesFor(
				ctx.d,
				ordered.map((o) => o.section.bodyJson ?? null),
			),
		}
	},
})

const searchHit = z.object({
	id: z.string().describe('Pass to fetch: "slug#address"'),
	slug: z.string(),
	address: z.string(),
	title: z.string(),
	documentTitle: z.string(),
	snippet: z.string(),
	url: z.string(),
})

export const search = define({
	name: 'search',
	summary: 'Search the published text',
	description:
		'Find sections of published documents whose text or title contains the query. Returns an id for fetch, the section and document titles, a snippet and a citation url.',
	tags: ['search'],
	input: z.object({
		query: z.string().min(1).max(200).describe('What to look for'),
		limit: z.coerce
			.number()
			.int()
			.min(1)
			.max(50)
			.optional()
			.describe('At most this many results (default 20)'),
	}),
	output: z.object({ results: z.array(searchHit) }),
	rest: { method: 'GET', path: '/search' },
	handler: async ({ query, limit }, ctx) => ({
		results: (await searchPublished(ctx, query, limit ?? 20)).map((hit) => ({
			id: `${hit.slug}#${hit.address}`,
			...hit,
		})),
	}),
})

export const fetchItem = define({
	name: 'fetch',
	summary: 'Fetch one item by id',
	description:
		'The full text of one published section by the id a search returned ("slug#address"): title, plain text, citation url and metadata.',
	tags: ['search'],
	input: z.object({ id: z.string().min(3).max(320).describe('"slug#address", from search') }),
	output: z.object({
		id: z.string(),
		title: z.string(),
		text: z.string(),
		url: z.string(),
		metadata: z.record(z.string(), z.string()).optional(),
	}),
	rest: { method: 'GET', path: '/items/{id+}' },
	handler: async ({ id }, ctx) => {
		const match = ITEM.exec(id)
		if (!match) throw new NotFound(`"${id}" is not an item id ("slug#address").`)
		const [, slugValue = '', addressValue = ''] = match
		const v = await versionOf(ctx.d, slugValue)
		const found = (await sectionsOf(ctx.d, v.versionId)).find((s) => s.address === addressValue)
		if (!found) throw new NotFound(`"${v.title}" has no section "${addressValue}".`)
		return {
			id,
			title: `${[found.printedNumber, found.title].filter(Boolean).join(' ') || found.address} — ${v.title}`,
			text: sectionText(found),
			url: sectionUrl(ctx.origin, v.slug, found.address),
			metadata: {
				document: v.title,
				slug: v.slug,
				address: found.address,
				version: String(v.version),
				lastChangedVersion: String(found.lastChangedVersionNo),
			},
		}
	},
})

/** The table, in the order the reference lists it. */
export const operations = [
	listDocuments,
	getDocument,
	getSection,
	getDocumentFull,
	listVersions,
	getComposed,
	search,
	fetchItem,
] as const
