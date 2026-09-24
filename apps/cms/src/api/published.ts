/**
 * Reads over the PUBLISHED content (decisions 98, 116, 125): what the public API, the
 * MCP server and the capnweb capability all serve. Everything comes from the
 * `published_versions` / `published_sections` views for the current version, or from
 * `versions` + `version_sections` for an older one; nothing here reads a draft.
 *
 * A document is addressed by its partner slug when Cancer Council has set one, else by
 * our slug. Cross-references stay typed data (a section address the partner maps to its
 * own URLs); citations are numbered in first-cited order across the version and the
 * References list is the union of the rows the bodies cite, wherever those rows live.
 */

import { NotFound } from '@aicolab/app-kit/api'

// Workers Cache (decision 126). Published content changes only at publish, so its public
// responses are cached for a day and tagged; publishing purges the document's tag and the
// tag every published response carries (lists and search span documents).
export const PUBLIC_CACHE_CONTROL = 'public, s-maxage=86400, stale-while-revalidate=3600'
export const PUBLISHED_CACHE_TAG = 'published'
export const cacheTagFor = (slug: string): string => `document-${slug}`

import { and, desc, eq, inArray, or, sql } from 'drizzle-orm'
import {
	citationNumbers,
	citedBody,
	inlineText,
	stepNumberOfAddress,
	walkNodes,
} from '#/content/derived.ts'
import type { JsonNode } from '#/content/schema.ts'
import type { Db } from '#/db/index.ts'
import { inGroups, schema } from '#/db/index.ts'

export interface ApiContext {
	d: Db
	/** Where the public read pages live, for urls in results. */
	origin: string
}

export interface PublishedVersion {
	documentId: string
	slug: string
	kind: 'core' | 'pathway'
	title: string
	subject: string
	audience: 'cancer' | 'population' | 'principles'
	versionId: string
	version: number
	label: string | null
	releaseNotes: string | null
	publishedAt: Date | null
}

const slugOf = (row: { slug: string; partnerSlug: string | null }): string =>
	row.partnerSlug ?? row.slug

export const documentUrl = (origin: string, slug: string): string => `${origin}/p/${slug}`
export const sectionUrl = (origin: string, slug: string, address: string): string =>
	`${origin}/p/${slug}#${encodeURIComponent(address)}`

/** Every document with a published version, newest publish first. */
export async function listPublished(d: Db): Promise<PublishedVersion[]> {
	const rows = await d
		.select()
		.from(schema.publishedVersions)
		.orderBy(desc(schema.publishedVersions.publishedAt))
	return rows.map((r) => ({
		documentId: r.documentId,
		slug: slugOf(r),
		kind: r.kind,
		title: r.title,
		subject: r.subject,
		audience: r.audience,
		versionId: r.versionId,
		version: r.versionNo,
		label: r.label,
		releaseNotes: r.releaseNotes,
		publishedAt: r.publishedAt,
	}))
}

// ---------------------------------------------------------------------------
// An unknown slug: the nearest published documents, as suggestions only
// ---------------------------------------------------------------------------

/** Words people use for a cancer or a group that the documents name differently. Each
 *  entry adds the documents' own words to a query that uses the common one. */
const COMMON_NAMES: [RegExp, string[]][] = [
	[/\bbowel\b/, ['colorectal']],
	[/\bcolon\b|\brectal\b|\brectum\b/, ['colorectal']],
	[/\bskin\b/, ['keratinocyte', 'melanoma']],
	[/\bbcc\b|\bscc\b|\bbasal\b|\bsquamous\b/, ['keratinocyte']],
	[/\bwomb\b|\buterine\b|\buterus\b/, ['endometrial']],
	[/\bbrain\b/, ['glioma']],
	[/\bliver\b/, ['hepatocellular']],
	[/\bbone\b|\bsoft tissue\b/, ['sarcoma']],
	[/\bblood\b/, ['leukaemia', 'lymphoma', 'myeloma']],
	[/\bleukemia\b/, ['leukaemia']],
	[/\bplasma\b/, ['myeloma']],
	[/\bmarrow\b/, ['myelodysplastic', 'myeloproliferative']],
	[/\bthroat\b|\bmouth\b|\boral\b|\blarynx\b/, ['head and neck']],
	[/\bcup\b|\bunknown\b/, ['unknown primary']],
	[/\bteen\w*\b|\byoung\b|\baya\b|\badolescen\w*\b/, ['adolescents and young adults']],
	[/\belderly\b|\baged\b|\bgeriatric\b|\bsenior\w*\b/, ['older people']],
	[/\bindigenous\b|\bfirst nations\b|\bkoori\b/, ['aboriginal and torres strait islander']],
	[/\bnet\b|\bnets\b|\bcarcinoid\b/, ['neuroendocrine']],
	[/\bhodgkin\w*\b|\bdlbcl\b/, ['lymphoma']],
	[/\bcml\b|\bcll\b|\baml\b|\ball\b/, ['leukaemia']],
]

const words = (s: string): string[] =>
	s
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((w) => w.length > 1)

/** Levenshtein distance, for a word typed nearly right. */
function distance(a: string, b: string): number {
	const rows: number[] = Array.from({ length: b.length + 1 }, (_, i) => i)
	for (let i = 1; i <= a.length; i++) {
		let previous = rows[0] ?? 0
		rows[0] = i
		for (let j = 1; j <= b.length; j++) {
			const current = rows[j] ?? 0
			rows[j] = Math.min(
				current + 1,
				(rows[j - 1] ?? 0) + 1,
				previous + (a[i - 1] === b[j - 1] ? 0 : 1),
			)
			previous = current
		}
	}
	return rows[b.length] ?? 0
}

/** The published documents nearest to a slug or name someone asked for that names
 *  nothing: by the words they share with the document's slugs, title and subject, common
 *  names translated, spelling slips forgiven. Suggestions only, never a substitute. */
export async function nearestDocuments(
	d: Db,
	asked: string,
	limit = 3,
): Promise<PublishedVersion[]> {
	const lower = asked.toLowerCase()
	const query = new Set(words(asked))
	for (const [common, own] of COMMON_NAMES)
		if (common.test(lower)) for (const o of own) for (const w of words(o)) query.add(w)
	if (query.size === 0) return []
	const scored = (await listPublished(d)).map((v) => {
		const own = new Set([
			...words(v.slug),
			...words(v.title),
			...words(v.subject),
			...(v.kind === 'core' ? ['core', 'template'] : []),
		])
		let score = 0
		for (const q of query) {
			if (own.has(q)) score += 1
			else if ([...own].some((o) => o.length > 3 && q.length > 3 && distance(q, o) <= 1))
				score += 0.75
			else if ([...own].some((o) => o.length > 4 && (o.startsWith(q) || q.startsWith(o))))
				score += 0.5
		}
		return { v, score }
	})
	return scored
		.filter((s) => s.score > 0)
		.sort((a, b) => b.score - a.score || a.v.title.localeCompare(b.v.title))
		.slice(0, limit)
		.map((s) => s.v)
}

/** The "no such document" refusal, naming the nearest published documents when any come
 *  close. The same text on every door: REST's 404, MCP's tool error, capnweb's rejection. */
export async function noSuchDocument(d: Db, slug: string): Promise<NotFound> {
	const nearest = await nearestDocuments(d, slug)
	const hint =
		nearest.length > 0
			? ` Did you mean ${nearest.map((v) => `"${v.slug}" (${v.title})`).join(', ')}? list_documents gives every slug.`
			: ' list_documents gives every slug.'
	return new NotFound(`No document is published at "${slug}".${hint}`)
}

/** The document a slug names (partner slug first), with its published version — or, when
 *  a version number is given, that published-or-archived version. */
export async function versionOf(
	d: Db,
	slug: string,
	versionNo?: number,
): Promise<PublishedVersion> {
	const document = (
		await d
			.select()
			.from(schema.documents)
			.where(or(eq(schema.documents.partnerSlug, slug), eq(schema.documents.slug, slug)))
			.orderBy(sql`case when ${schema.documents.partnerSlug} = ${slug} then 0 else 1 end`)
			.limit(1)
	)[0]
	if (!document) throw await noSuchDocument(d, slug)
	const version = (
		await d
			.select()
			.from(schema.versions)
			.where(
				and(
					eq(schema.versions.documentId, document.id),
					versionNo === undefined
						? eq(schema.versions.status, 'published')
						: and(
								eq(schema.versions.versionNo, versionNo),
								inArray(schema.versions.status, ['published', 'archived']),
							),
				),
			)
			.limit(1)
	)[0]
	if (!version)
		throw new NotFound(
			versionNo === undefined
				? `"${document.title}" has no published version.`
				: `"${document.title}" has no published version ${versionNo}.`,
		)
	return {
		documentId: document.id,
		slug: slugOf(document),
		kind: document.kind,
		title: document.title,
		subject: document.subject,
		audience: document.audience,
		versionId: version.id,
		version: version.versionNo,
		label: version.label,
		releaseNotes: version.releaseNotes,
		publishedAt: version.publishedAt,
	}
}

export type FrozenSection = typeof schema.versionSections.$inferSelect

/** A point-of-care check list found inside a section that is not itself point of care. */
export interface GuideItem {
	section: FrozenSection
	list: JsonNode
}

/**
 * The quick reference guide of a published version (decisions 4, 28, 152): a DERIVED view
 * — every section flagged point of care, in reading order, plus every check list flagged
 * point of care inside the other sections, each with the section it sits in.
 */
export async function guideOf(
	d: Db,
	versionId: string,
): Promise<{ sections: FrozenSection[]; items: GuideItem[]; all: FrozenSection[] }> {
	const all = await sectionsOf(d, versionId)
	const sections = all.filter((s) => s.pointOfCare)
	const items: GuideItem[] = []
	for (const s of all) {
		if (s.pointOfCare || !s.bodyJson) continue
		walkNodes(s.bodyJson, (n) => {
			if (n.type === 'list' && n.attrs?.kind === 'check' && n.attrs.pointOfCare === true)
				items.push({ section: s, list: n })
		})
	}
	return { sections, items, all }
}

/** The version's sections in reading order, hidden ones left out. */
export async function sectionsOf(d: Db, versionId: string): Promise<FrozenSection[]> {
	const rows = await d
		.select()
		.from(schema.versionSections)
		.where(
			and(
				eq(schema.versionSections.versionId, versionId),
				eq(schema.versionSections.hidden, false),
			),
		)
	return outlineOrder(rows)
}

/** Depth-first reading order over frozen sections, which carry their parent's address. */
function outlineOrder(rows: FrozenSection[]): FrozenSection[] {
	const byParent = new Map<string | null, FrozenSection[]>()
	for (const row of rows) {
		const list = byParent.get(row.parentAddress) ?? []
		list.push(row)
		byParent.set(row.parentAddress, list)
	}
	const out: FrozenSection[] = []
	const walk = (parent: string | null) => {
		for (const row of (byParent.get(parent) ?? []).sort((a, b) => a.orderIndex - b.orderIndex)) {
			out.push(row)
			walk(row.address)
		}
	}
	walk(null)
	// A section whose parent is hidden would be orphaned; append any not reached, in order.
	if (out.length < rows.length) {
		const seen = new Set(out.map((r) => r.sectionId))
		for (const row of rows.sort((a, b) => a.orderIndex - b.orderIndex))
			if (!seen.has(row.sectionId)) out.push(row)
	}
	return out
}

export interface NumberedReference {
	number: number
	id: string
	citation: string
	url: string | null
}

/** The references the sections cite, numbered in first-cited order (decision 15, 118): each
 *  heading's own markers before its body's (`citedBody`). */
export async function referencesFor(
	d: Db,
	sections: Pick<FrozenSection, 'titleCitations' | 'bodyJson'>[],
): Promise<NumberedReference[]> {
	const numbers = citationNumbers(
		sections.map((s) => citedBody(s.titleCitations, s.bodyJson ?? null)),
	)
	const ids = Object.keys(numbers)
	if (ids.length === 0) return []
	const rows = await inGroups(ids, (group) =>
		d.select().from(schema.references).where(inArray(schema.references.id, group)),
	)
	const byId = new Map(rows.map((r) => [r.id, r]))
	return ids
		.map((id) => ({ id, number: numbers[id] ?? 0, row: byId.get(id) }))
		.sort((a, b) => a.number - b.number)
		.map(({ id, number, row }) => ({
			number,
			id,
			citation: row?.citation ?? '(reference missing)',
			url: row?.url ?? null,
		}))
}

// ---------------------------------------------------------------------------
// Parts of a document: front matter, the seven steps, back matter
// ---------------------------------------------------------------------------

export const PARTS = ['front', '1', '2', '3', '4', '5', '6', '7', 'back'] as const
export type Part = (typeof PARTS)[number]

/** Which part each section of a version belongs to, by reading order: everything before
 *  the first step is front matter, a step's sections are the step's (their addresses open
 *  with its number), everything after the last step is back matter. */
export function partsOf(sections: readonly FrozenSection[]): Map<string, Part> {
	const out = new Map<string, Part>()
	let seenStep = false
	for (const s of sections) {
		const n = stepNumberOfAddress(s.address)
		const step = n === null ? undefined : PARTS.find((p) => p === String(n))
		if (step) seenStep = true
		out.set(s.sectionId, step ?? (seenStep ? 'back' : 'front'))
	}
	return out
}

/** The sections of one part, in reading order; every section when no part is asked for. */
export function sectionsInPart(
	sections: readonly FrozenSection[],
	part: Part | undefined,
): FrozenSection[] {
	if (part === undefined) return [...sections]
	const parts = partsOf(sections)
	return sections.filter((s) => parts.get(s.sectionId) === part)
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchHit {
	slug: string
	address: string
	title: string
	documentTitle: string
	/** The words around the match, the matched words marked **like this**. */
	snippet: string
	url: string
}

/** The reader's words as an FTS5 query: each word quoted (the syntax is ours, not
 *  theirs), joined so that every word must appear, or any word when `any`. */
function matchQuery(query: string, any: boolean): string | null {
	const terms = query
		.split(/\s+/)
		.map((w) => w.replace(/["*^():]/g, '').trim())
		.filter((w) => w.length > 0)
		.slice(0, 12)
	return terms.length === 0 ? null : terms.map((w) => `"${w}"`).join(any ? ' OR ' : ' ')
}

interface SearchRow {
	document_id: string
	slug: string
	partner_slug: string | null
	document_title: string
	address: string
	title: string | null
	printed_number: string | null
	snip: string
}

/**
 * Published sections that match the query, ranked (bm25, the title weighted over the
 * body; the stemmer finds "screening" for "screen"), current editions only. Every word
 * must appear; when nothing has them all, any of them. So that one long pathway does not
 * fill the list, at most three hits per document come before any document's fourth.
 */
export async function searchPublished(
	ctx: ApiContext,
	query: string,
	limit: number,
): Promise<SearchHit[]> {
	const run = async (match: string): Promise<SearchRow[]> =>
		ctx.d.all<SearchRow>(
			sql`SELECT published_search.document_id, published_versions.slug, published_versions.partner_slug, published_versions.title AS document_title, version_sections.address, version_sections.title, version_sections.printed_number, snippet(published_search, 4, '**', '**', '…', 24) AS snip FROM published_search JOIN published_versions ON published_versions.version_id = published_search.version_id JOIN version_sections ON version_sections.version_id = published_search.version_id AND version_sections.section_id = published_search.section_id WHERE published_search MATCH ${match} ORDER BY bm25(published_search, 0, 0, 0, 3.0, 1.0) LIMIT ${limit * 4}`,
		)
	const all = matchQuery(query, false)
	if (!all) return []
	let rows = await run(all)
	if (rows.length === 0) {
		const any = matchQuery(query, true)
		if (any && any !== all) rows = await run(any)
	}
	// Three per document first, in rank order; then the rest, in rank order.
	const perDocument = new Map<string, number>()
	const first: SearchRow[] = []
	const rest: SearchRow[] = []
	for (const r of rows) {
		const n = perDocument.get(r.document_id) ?? 0
		perDocument.set(r.document_id, n + 1)
		if (n < 3) first.push(r)
		else rest.push(r)
	}
	return [...first, ...rest].slice(0, limit).map((r) => {
		const slug = r.partner_slug ?? r.slug
		return {
			slug,
			address: r.address,
			title: [r.printed_number, r.title].filter(Boolean).join(' ') || r.address,
			documentTitle: r.document_title,
			snippet: r.snip.replace(/\s+/g, ' ').trim(),
			url: sectionUrl(ctx.origin, slug, r.address),
		}
	})
}

/** A section's plain text, for fetch results. */
export const sectionText = (section: FrozenSection): string =>
	section.markdown ?? (section.bodyJson ? inlineText(section.bodyJson) : '')
