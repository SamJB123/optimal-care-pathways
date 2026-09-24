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
import {
	citationNumbers,
	citedBody,
	type DerivedView,
	stepNumberOfAddress,
	timeframeRows,
} from '#/content/derived.ts'
import { bodyToMarkdown } from '#/content/markdown.ts'
import { renderBodyHtml } from '#/content/render-html.tsx'
import type { JsonNode } from '#/content/schema.ts'
import { schema } from '#/db/index.ts'
import {
	type ApiContext,
	documentUrl,
	type FrozenSection,
	guideOf,
	listPublished,
	PARTS,
	type PublishedVersion,
	referencesFor,
	searchPublished,
	sectionsInPart,
	sectionsOf,
	sectionText,
	sectionUrl,
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
	titleCitations: z
		.array(z.string())
		.describe('Reference ids the heading itself cites, numbered before the body’s citations'),
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

/** One form per call, the same on every door: Markdown unless asked otherwise. */
const FORMATS = ['markdown', 'html', 'json'] as const
const format = z
	.enum(FORMATS)
	.default('markdown')
	.describe(
		'The form each section body is returned in: markdown (the default, for reading), html (rendered as the site renders it), or json (the content-schema document node, for tools that walk the structure)',
	)
type Format = (typeof FORMATS)[number]
const formatOut = z.enum(FORMATS).describe('The form the bodies are in')

/** One part of a document, so a reader need not take the whole: the front matter (title
 *  page to the last section before Step 1), one of the seven steps, or the back matter
 *  (everything after Step 7: Find out more, appendices, references). */
const part = z
	.enum(PARTS)
	.optional()
	.describe(
		'One part of the document: "front" (before Step 1), a step "1"–"7", or "back" (after Step 7). Omitted: the whole document.',
	)
const partOut = z.enum(PARTS).nullable().describe('The part returned; null for the whole document')

/** The body in the requested form: text for markdown and html, the doc node for json;
 *  null when the section has no body of its own. */
const content = z
	.union([z.string(), body])
	.nullable()
	.describe(
		'The body in the requested format: a string for markdown and html, the content-schema doc node for json; null where the section has no body',
	)

const define = operationsFor<ApiContext>()

const section = outlineEntry.extend({ content })

/** A frozen section's body in one form. */
const contentIn = (s: Pick<FrozenSection, 'bodyJson' | 'html' | 'markdown'>, form: Format) =>
	form === 'json' ? wireBody(s.bodyJson ?? null) : form === 'html' ? s.html : s.markdown

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
	titleCitations: s.titleCitations ?? [],
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
	form: Format,
): z.output<typeof section> => ({
	...outlineOf(ctx, slugValue, s),
	content: contentIn(s, form),
})

/** What rendering a body of a published version needs beyond the body: the document's
 *  citation numbers and its timeframe boxes, as the publisher derived them. */
const derivedFor = (all: FrozenSection[]): DerivedView => ({
	referenceNumbers: citationNumbers(
		all.map((s) => citedBody(s.titleCitations, s.bodyJson ?? null)),
	),
	timeframes: timeframeRows(
		all.map((s) => ({
			stepNumber: stepNumberOfAddress(s.address),
			address: s.address,
			printedNumber: s.printedNumber,
			title: s.title,
			body: s.bodyJson ?? null,
		})),
	),
	map: null,
})

/** The references a set of sections cites, numbered as the WHOLE document numbers them:
 *  a part or a section keeps the numbers a reader sees in the full document. */
const referencesCitedBy = async (
	ctx: ApiContext,
	all: FrozenSection[],
	chosen: FrozenSection[],
) => {
	const numbered = await referencesFor(ctx.d, all)
	if (chosen.length === all.length) return numbered
	const cited = new Set(
		Object.keys(
			citationNumbers(chosen.map((s) => citedBody(s.titleCitations, s.bodyJson ?? null))),
		),
	)
	return numbered.filter((r) => cited.has(r.id))
}

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
			references: await referencesFor(ctx.d, sections),
		}
	},
})

export const getSection = define({
	name: 'get_section',
	summary: 'Get one section',
	description:
		'One section of a published document by its address: the body in one form (Markdown unless `format` says html or json), plus the references it cites numbered as the whole document numbers them. Cross-references to other sections are typed links carrying the target address.',
	tags: ['sections'],
	input: z.object({ slug, address, version, format }),
	output: z.object({
		document: documentSummary,
		format: formatOut,
		section,
		references: z.array(reference),
	}),
	rest: { method: 'GET', path: '/documents/{slug}/sections/{address+}' },
	handler: async (
		{ slug: slugValue, address: addressValue, version: versionNo, format: form },
		ctx,
	) => {
		const v = await versionOf(ctx.d, slugValue, versionNo)
		const sections = await sectionsOf(ctx.d, v.versionId)
		const found = sections.find((s) => s.address === addressValue)
		if (!found) throw new NotFound(`"${v.title}" has no section "${addressValue}".`)
		return {
			document: summaryOf(ctx, v),
			format: form,
			section: sectionOf(ctx, v.slug, found, form),
			references: await referencesCitedBy(ctx, sections, [found]),
		}
	},
})

export const getDocumentFull = define({
	name: 'get_document_full',
	summary: 'Get a whole document, or one part of it',
	description:
		'A published document with its sections in reading order, each body in one form (Markdown unless `format` says html or json), and the References list numbered as the whole document numbers it. Pass `part` to take one part at a time — "front", a step "1" to "7", or "back" — with only the references that part cites; omit it for everything. A whole pathway is long: prefer a part, or get_document plus get_section, when you need less.',
	tags: ['documents'],
	input: z.object({ slug, version, format, part }),
	output: z.object({
		document: documentSummary,
		format: formatOut,
		part: partOut,
		sections: z.array(section),
		references: z.array(reference),
	}),
	rest: { method: 'GET', path: '/documents/{slug}/full' },
	handler: async ({ slug: slugValue, version: versionNo, format: form, part: partValue }, ctx) => {
		const v = await versionOf(ctx.d, slugValue, versionNo)
		const all = await sectionsOf(ctx.d, v.versionId)
		const chosen = sectionsInPart(all, partValue)
		return {
			document: summaryOf(ctx, v),
			format: form,
			part: partValue ?? null,
			sections: chosen.map((s) => sectionOf(ctx, v.slug, s, form)),
			references: await referencesCitedBy(ctx, all, chosen),
		}
	},
})

const guideItem = z.object({
	address: z.string().describe('The section the check list sits in'),
	title: z.string().nullable(),
	printedNumber: z.string().nullable(),
	url: z.string(),
	content: content.describe(
		'The check list, its items flagged point of care, in the requested format',
	),
})

export const getQuickReferenceGuide = define({
	name: 'get_quick_reference_guide',
	summary: 'Get a document’s quick reference guide',
	description:
		'The quick reference guide of a published document, derived from the pathway itself: every section flagged for use at point of care, in reading order and with its body in one form (Markdown unless `format` says html or json), then every point-of-care check list found in the other sections with the section it belongs to, and the references the guide cites numbered as the whole document numbers them. Also available as a page at /p/{slug}/quick-reference-guide and as a PDF.',
	tags: ['documents'],
	input: z.object({ slug, version, format }),
	output: z.object({
		document: documentSummary,
		format: formatOut,
		sections: z.array(
			section.extend({
				step: z
					.object({ address: z.string(), title: z.string().nullable() })
					.nullable()
					.describe('The pathway step the section belongs to, which the guide is arranged by'),
			}),
		),
		items: z.array(guideItem),
		references: z.array(reference),
	}),
	rest: { method: 'GET', path: '/documents/{slug}/quick-reference-guide' },
	handler: async ({ slug: slugValue, version: versionNo, format: form }, ctx) => {
		const v = await versionOf(ctx.d, slugValue, versionNo)
		const guide = await guideOf(ctx.d, v.versionId)
		const all = await referencesFor(ctx.d, guide.all)
		const cited = new Set(
			Object.keys(
				citationNumbers([
					...guide.sections.map((s) => citedBody(s.titleCitations, s.bodyJson ?? null)),
					...guide.items.map((i) => i.list),
				]),
			),
		)
		// A step section's address is its number ("2"); its parts' addresses open with it
		// ("2.3.1", "2/quick-reference-guide").
		const stepOf = (address: string) => {
			const n = stepNumberOfAddress(address)
			const step = n !== null ? guide.all.find((s) => s.address === String(n)) : undefined
			return step ? { address: step.address, title: step.title } : null
		}
		// A check list on its own is rendered as a one-node document, numbered as the
		// document numbers its citations.
		const derived = derivedFor(guide.all)
		const listIn = (list: JsonNode) => {
			const node: JsonNode = { type: 'doc', content: [list] }
			return form === 'json'
				? wireBody(node)
				: form === 'html'
					? renderBodyHtml(node, derived)
					: bodyToMarkdown(node, derived)
		}
		return {
			document: summaryOf(ctx, v),
			format: form,
			sections: guide.sections.map((s) => ({
				...sectionOf(ctx, v.slug, s, form),
				step: stepOf(s.address),
			})),
			items: guide.items.map((i) => ({
				address: i.section.address,
				title: i.section.title,
				printedNumber: i.section.printedNumber,
				url: sectionUrl(ctx.origin, v.slug, i.section.address),
				content: listIn(i.list),
			})),
			references: all.filter((r) => cited.has(r.id)),
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
		'The cancer-type pathway and the population-group pathway read together (decision 14): the cancer pathway’s sections in order, each followed by the population pathway’s own section at the same address when it has one; shared core content appears once. Population sections with no cancer counterpart come last. Bodies come in one form (Markdown unless `format` says html or json); pass `part` for one part of both documents, omit it for everything.',
	tags: ['documents'],
	input: z.object({
		cancer: slug.describe('The cancer-type pathway’s slug'),
		population: slug.describe('The population-group pathway’s slug'),
		format,
		part,
	}),
	output: z.object({
		cancer: documentSummary,
		population: documentSummary,
		format: formatOut,
		part: partOut,
		sections: z.array(composedSection),
		references: z.array(reference),
	}),
	rest: { method: 'GET', path: '/composed/{cancer}/{population}' },
	handler: async ({ cancer, population, format: form, part: partValue }, ctx) => {
		const c = await versionOf(ctx.d, cancer)
		const p = await versionOf(ctx.d, population)
		const cAll = await sectionsOf(ctx.d, c.versionId)
		const pAll = await sectionsOf(ctx.d, p.versionId)
		const cs = sectionsInPart(cAll, partValue)
		const ps = sectionsInPart(pAll, partValue)
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
		// Numbered across the whole composed reading, filtered to the part when one is asked.
		const wholeReading = [...cAll, ...pAll.filter((s) => s.ownership === 'owned')]
		return {
			cancer: summaryOf(ctx, c),
			population: summaryOf(ctx, p),
			format: form,
			part: partValue ?? null,
			sections: ordered.map((o) => ({
				...sectionOf(ctx, o.slug, o.section, form),
				source: o.source,
			})),
			references: await referencesCitedBy(
				ctx,
				wholeReading,
				ordered.map((o) => o.section),
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
		'Full-text search over the published documents, ranked by relevance with titles weighted over bodies; word stems match ("screen" finds "screening"). Every word must appear, or any word when nothing has them all. At most three hits per document come before any document’s fourth, so one long pathway does not fill the list. Returns an id for fetch, the section and document titles, a snippet with the matched words marked **like this**, and a citation url.',
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
	getQuickReferenceGuide,
	listVersions,
	getComposed,
	search,
	fetchItem,
] as const
