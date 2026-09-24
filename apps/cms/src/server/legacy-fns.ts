/**
 * Server functions over the legacy import (decisions 129–140): what the previous
 * edition said for a section (the inspector's provenance panel), a legacy document for
 * the /legacy reader, and the admin door that finishes an import — the seed cannot reach
 * the auth worker or render HTML, so each imported pathway waits with a placeholder
 * organisation and an unrendered published version until a central member runs this.
 */

import { createServerFn } from '@tanstack/solid-start'
import { and, eq, isNull, like } from 'drizzle-orm'
import { z } from 'zod'
import { sectionsOf } from '#/api/published.ts'
import {
	citationNumbers,
	type DerivedView,
	stepNumberOfAddress,
	timeframeRows,
} from '#/content/derived.ts'
import { bodyToMarkdown } from '#/content/markdown.ts'
import { renderBodyHtml } from '#/content/render-html.tsx'
import type { JsonNode } from '#/content/schema.ts'
import { schema } from '#/db/index.ts'
import { OCP_NAMESPACE, organisationNameOf } from '#/lib/roles.ts'
import { documentRoleOf, isCentralMember } from './access.ts'
import { envOf, requireUser } from './env.ts'
import { indexedPublishedVersions, indexPublishedVersion } from './search-index.ts'
import { outlineOrder } from '#/lib/outline.ts'

export interface LegacyOrigin {
	id: string
	key: string | null
	heading: string | null
	body: JsonNode | null
	/** Characters this legacy section contributed to the draft section. */
	chars: number
}

/** The legacy sections a draft section's body came from, with their text as printed. */
export const legacyOriginsOf = createServerFn({ method: 'GET' })
	.inputValidator(z.object({ sectionId: z.string().min(1).max(64) }))
	.handler(
		async ({
			data,
			context,
		}): Promise<{
			legacySlug: string | null
			legacyTitle: string | null
			origins: LegacyOrigin[]
		}> => {
			const userId = requireUser(context.userId)
			const { env, d } = await envOf()
			const section = (
				await d
					.select({ documentId: schema.sections.documentId, orgId: schema.documents.orgId })
					.from(schema.sections)
					.innerJoin(schema.documents, eq(schema.documents.id, schema.sections.documentId))
					.where(eq(schema.sections.id, data.sectionId))
					.limit(1)
			)[0]
			if (!section) throw new Error('Section not found.')
			if (!(await documentRoleOf(env.AUTH, d, userId, section.orgId)))
				throw new Error('You are not a member of this document.')
			const rows = await d
				.select({
					id: schema.legacySections.id,
					key: schema.legacySections.key,
					heading: schema.legacySections.heading,
					body: schema.legacySections.bodyJson,
					chars: schema.sectionOrigins.chars,
					orderIndex: schema.legacySections.orderIndex,
					legacySlug: schema.legacyDocuments.slug,
					legacyTitle: schema.legacyDocuments.title,
				})
				.from(schema.sectionOrigins)
				.innerJoin(
					schema.legacySections,
					eq(schema.legacySections.id, schema.sectionOrigins.legacySectionId),
				)
				.innerJoin(
					schema.legacyDocuments,
					eq(schema.legacyDocuments.id, schema.legacySections.documentId),
				)
				.where(eq(schema.sectionOrigins.sectionId, data.sectionId))
			rows.sort((a, b) => a.orderIndex - b.orderIndex)
			return {
				legacySlug: rows[0]?.legacySlug ?? null,
				legacyTitle: rows[0]?.legacyTitle ?? null,
				origins: rows.map((r) => ({
					id: r.id,
					key: r.key,
					heading: r.heading,
					body: r.body ?? null,
					chars: r.chars,
				})),
			}
		},
	)

export interface LegacySectionWire {
	id: string
	parentId: string | null
	level: number
	heading: string | null
	key: string | null
	body: JsonNode | null
}

/** A legacy document as printed, for the public /legacy/{slug} reader. */
export const legacyDocumentBySlug = createServerFn({ method: 'GET' })
	.inputValidator(z.object({ slug: z.string().min(1).max(160) }))
	.handler(async ({ data }) => {
		const { d } = await envOf()
		const document = (
			await d
				.select()
				.from(schema.legacyDocuments)
				.where(eq(schema.legacyDocuments.slug, data.slug))
				.limit(1)
		)[0]
		if (!document) throw new Error('No legacy document with that name.')
		const rows = await d
			.select()
			.from(schema.legacySections)
			.where(eq(schema.legacySections.documentId, document.id))
		const sections: LegacySectionWire[] = outlineOrder(rows).map((r) => ({
			id: r.id,
			parentId: r.parentId,
			level: r.level,
			heading: r.heading,
			key: r.key,
			body: r.bodyJson ?? null,
		}))
		// The pathway this edition became: the document whose sections came from its own.
		const successor = (
			await d
				.select({
					id: schema.documents.id,
					slug: schema.documents.slug,
					title: schema.documents.title,
					accent: schema.documents.accent,
				})
				.from(schema.sectionOrigins)
				.innerJoin(
					schema.legacySections,
					eq(schema.legacySections.id, schema.sectionOrigins.legacySectionId),
				)
				.innerJoin(schema.sections, eq(schema.sections.id, schema.sectionOrigins.sectionId))
				.innerJoin(schema.documents, eq(schema.documents.id, schema.sections.documentId))
				.where(eq(schema.legacySections.documentId, document.id))
				.limit(1)
		)[0]
		const published = successor
			? (
					await d
						.select({ versionNo: schema.publishedVersions.versionNo })
						.from(schema.publishedVersions)
						.where(eq(schema.publishedVersions.documentId, successor.id))
						.limit(1)
				)[0]
			: undefined
		return {
			document: {
				id: document.id,
				slug: document.slug,
				title: document.title,
				audience: document.audience,
				edition: document.edition,
				publicationDate: document.publicationDate,
				// Served from the files bucket, like an uploaded image (routes/files.$.ts).
				pdfUrl: document.pdfKey ? `/files/${document.pdfKey}` : null,
			},
			/** The pathway it became; `published` when readers can open its current edition. */
			pathway: successor
				? {
						slug: successor.slug,
						title: successor.title,
						accent: successor.accent,
						published: published !== undefined,
					}
				: null,
			sections,
		}
	})

const PENDING = 'pending:%'

/**
 * Finish every waiting import: give each pathway its organisation (the caller becomes
 * its owner — decision 138), and render the published edition's HTML and Markdown, which
 * the seed left empty. Idempotent: a pathway with a real organisation and rendered
 * sections is untouched.
 */
export const finaliseLegacyImports = createServerFn({ method: 'POST' }).handler(
	async ({ context }) => {
		const userId = requireUser(context.userId)
		const { env, d } = await envOf()
		if (!(await isCentralMember(env.AUTH, d, userId)))
			throw new Error('Only members of the central organisation may do that.')
		const actor = await env.AUTH.getUserById(userId)
		const pending = await d
			.select()
			.from(schema.documents)
			.where(like(schema.documents.orgId, PENDING))
		const finalised: { slug: string; organizationId: string }[] = []
		const errors: string[] = []
		for (const document of pending) {
			const created = await env.AUTH.createOrganizationForUser(userId, {
				name: organisationNameOf(document.title),
				slug: document.slug,
				namespace: OCP_NAMESPACE,
			})
			// A re-seed puts a finalised pathway back to its placeholder while its organisation
			// stays: the organisation with its slug is adopted when the caller owns it and no
			// other document belongs to it.
			let organizationId = created.ok ? created.organizationId : null
			if (!created.ok && created.error === 'slug-taken') {
				const membership = await env.AUTH.getOrgMembership(userId, document.slug, OCP_NAMESPACE)
				const claimed = membership
					? (
							await d
								.select({ id: schema.documents.id })
								.from(schema.documents)
								.where(eq(schema.documents.orgId, membership.organizationId))
								.limit(1)
						)[0]
					: undefined
				if (membership?.role === 'owner' && !claimed) organizationId = membership.organizationId
			}
			if (!organizationId) {
				errors.push(`${document.slug}: ${created.ok ? 'no organisation' : created.error}`)
				continue
			}
			await d
				.update(schema.documents)
				.set({ orgId: organizationId })
				.where(eq(schema.documents.id, document.id))
			await d.insert(schema.events).values({
				id: crypto.randomUUID(),
				documentId: document.id,
				kind: 'document.imported',
				actorId: userId,
				actorName: actor?.name ?? userId,
				detail: { organizationId, slug: document.slug },
			})
			finalised.push({ slug: document.slug, organizationId })
		}

		// Published sections the seed wrote without HTML: render them now, numbering
		// citations across the version as the publisher does.
		const unrendered = await d
			.select({ versionId: schema.versionSections.versionId })
			.from(schema.versionSections)
			.innerJoin(schema.versions, eq(schema.versions.id, schema.versionSections.versionId))
			.where(and(isNull(schema.versionSections.html), eq(schema.versions.status, 'published')))
		let rendered = 0
		for (const versionId of new Set(unrendered.map((r) => r.versionId))) {
			const rows = await d
				.select()
				.from(schema.versionSections)
				.where(eq(schema.versionSections.versionId, versionId))
			// Numbered in reading order, as the page and the publisher number them; the snapshot
			// drawn from the version's own timeframe boxes.
			const ordered = await sectionsOf(d, versionId)
			const derived: DerivedView = {
				referenceNumbers: citationNumbers(ordered.map((r) => r.bodyJson ?? null)),
				timeframes: timeframeRows(
					ordered.map((r) => ({
						stepNumber: stepNumberOfAddress(r.address),
						address: r.address,
						printedNumber: r.printedNumber,
						title: r.title,
						body: r.bodyJson ?? null,
					})),
				),
				map: null,
			}
			const todo = rows.filter((r) => r.html === null && r.bodyJson)
			for (let i = 0; i < todo.length; i += 20) {
				const group = todo.slice(i, i + 20)
				const [first, ...rest] = group.map((r) =>
					d
						.update(schema.versionSections)
						.set({
							html: r.bodyJson ? renderBodyHtml(r.bodyJson, derived) : null,
							markdown: r.bodyJson ? bodyToMarkdown(r.bodyJson, derived) : null,
						})
						.where(
							and(
								eq(schema.versionSections.versionId, versionId),
								eq(schema.versionSections.sectionId, r.sectionId),
							),
						),
				)
				if (first) await d.batch([first, ...rest])
				rendered += group.length
			}
		}
		// Published editions the public search index does not hold yet (a seed writes no
		// index rows): indexed now, whether or not they needed rendering.
		const indexed = await indexedPublishedVersions(d)
		const published = await d
			.select({ documentId: schema.versions.documentId, versionId: schema.versions.id })
			.from(schema.versions)
			.where(eq(schema.versions.status, 'published'))
		let indexedNow = 0
		for (const v of published) {
			if (indexed.has(v.versionId)) continue
			const rows = await d
				.select({
					sectionId: schema.versionSections.sectionId,
					title: schema.versionSections.title,
					printedNumber: schema.versionSections.printedNumber,
					bodyJson: schema.versionSections.bodyJson,
					hidden: schema.versionSections.hidden,
				})
				.from(schema.versionSections)
				.where(eq(schema.versionSections.versionId, v.versionId))
			await indexPublishedVersion(d, v.documentId, v.versionId, rows)
			indexedNow++
		}
		// Documents whose organisation now exists but whose published version was rendered
		// earlier are reported too, so the caller sees the whole state.
		const stillPending = await d
			.select({ slug: schema.documents.slug })
			.from(schema.documents)
			.where(like(schema.documents.orgId, PENDING))
		return {
			finalised,
			rendered,
			indexed: indexedNow,
			errors,
			stillPending: stillPending.map((r) => r.slug),
		}
	},
)
