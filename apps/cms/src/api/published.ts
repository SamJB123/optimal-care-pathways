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
import { and, desc, eq, inArray, like, or, sql } from 'drizzle-orm'
import { citationNumbers, citedBody, inlineText, walkNodes } from '#/content/derived.ts'
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
	if (!document) throw new NotFound(`No document is published at "${slug}".`)
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

export interface SearchHit {
	slug: string
	address: string
	title: string
	documentTitle: string
	snippet: string
	url: string
}

/** Published sections whose text contains the query (case-insensitive), current versions only. */
export async function searchPublished(
	ctx: ApiContext,
	query: string,
	limit: number,
): Promise<SearchHit[]> {
	const needle = query.trim().toLowerCase()
	if (needle.length === 0) return []
	const rows = await ctx.d
		.select({
			slug: schema.publishedVersions.slug,
			partnerSlug: schema.publishedVersions.partnerSlug,
			documentTitle: schema.publishedVersions.title,
			address: schema.publishedSections.address,
			title: schema.publishedSections.title,
			printedNumber: schema.publishedSections.printedNumber,
			markdown: schema.publishedSections.markdown,
		})
		.from(schema.publishedSections)
		.innerJoin(
			schema.publishedVersions,
			eq(schema.publishedVersions.versionId, schema.publishedSections.versionId),
		)
		.where(
			or(
				like(sql`lower(${schema.publishedSections.markdown})`, `%${needle}%`),
				like(sql`lower(${schema.publishedSections.title})`, `%${needle}%`),
			),
		)
		.limit(limit)
	return rows.map((r) => {
		const slug = r.partnerSlug ?? r.slug
		const text = r.markdown ?? ''
		const at = text.toLowerCase().indexOf(needle)
		const start = Math.max(0, at - 80)
		const snippet = (at < 0 ? text.slice(0, 200) : text.slice(start, at + needle.length + 120))
			.replace(/\s+/g, ' ')
			.trim()
		return {
			slug,
			address: r.address,
			title: [r.printedNumber, r.title].filter(Boolean).join(' ') || r.address,
			documentTitle: r.documentTitle,
			snippet,
			url: sectionUrl(ctx.origin, slug, r.address),
		}
	})
}

/** A section's plain text, for fetch results. */
export const sectionText = (section: FrozenSection): string =>
	section.markdown ?? (section.bodyJson ? inlineText(section.bodyJson) : '')
