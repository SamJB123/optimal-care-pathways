/**
 * Server functions over the legacy import (decisions 129–140): what the previous
 * edition said for a section (the inspector's provenance panel), a legacy document for
 * the /legacy reader, and the admin door that finishes an import — the seed cannot reach
 * the auth worker or render HTML, so each imported pathway waits with a placeholder
 * organisation and an unrendered published version until a central member runs this.
 */

import { createServerFn } from '@tanstack/solid-start'
import { and, eq, inArray, isNull, like } from 'drizzle-orm'
import { z } from 'zod'
import { citationNumbers, type DerivedView } from '#/content/derived.ts'
import { bodyToMarkdown } from '#/content/markdown.ts'
import { renderBodyHtml } from '#/content/render-html.tsx'
import type { JsonNode } from '#/content/schema.ts'
import { schema } from '#/db/index.ts'
import { OCP_NAMESPACE } from '#/lib/roles.ts'
import { outlineOrder } from './lifecycle.ts'
import { requireCentralMember, roleOn } from './documents.ts'
import { envOf, requireUser } from './env.ts'

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
	.handler(async ({ data, context }): Promise<{ legacySlug: string | null; legacyTitle: string | null; origins: LegacyOrigin[] }> => {
		const userId = requireUser(context.userId)
		const { d } = await envOf()
		const section = (
			await d
				.select({ documentId: schema.sections.documentId, orgId: schema.documents.orgId })
				.from(schema.sections)
				.innerJoin(schema.documents, eq(schema.documents.id, schema.sections.documentId))
				.where(eq(schema.sections.id, data.sectionId))
				.limit(1)
		)[0]
		if (!section) throw new Error('Section not found.')
		if (!(await roleOn(userId, section.orgId))) throw new Error('You are not a member of this document.')
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
			.innerJoin(schema.legacySections, eq(schema.legacySections.id, schema.sectionOrigins.legacySectionId))
			.innerJoin(schema.legacyDocuments, eq(schema.legacyDocuments.id, schema.legacySections.documentId))
			.where(eq(schema.sectionOrigins.sectionId, data.sectionId))
		rows.sort((a, b) => a.orderIndex - b.orderIndex)
		return {
			legacySlug: rows[0]?.legacySlug ?? null,
			legacyTitle: rows[0]?.legacyTitle ?? null,
			origins: rows.map((r) => ({ id: r.id, key: r.key, heading: r.heading, body: r.body ?? null, chars: r.chars })),
		}
	})

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
		const document = (await d.select().from(schema.legacyDocuments).where(eq(schema.legacyDocuments.slug, data.slug)).limit(1))[0]
		if (!document) throw new Error('No legacy document with that name.')
		const rows = await d.select().from(schema.legacySections).where(eq(schema.legacySections.documentId, document.id))
		const sections: LegacySectionWire[] = outlineOrder(rows).map((r) => ({
			id: r.id,
			parentId: r.parentId,
			level: r.level,
			heading: r.heading,
			key: r.key,
			body: r.bodyJson ?? null,
		}))
		return {
			document: {
				id: document.id,
				slug: document.slug,
				title: document.title,
				audience: document.audience,
				edition: document.edition,
				publicationDate: document.publicationDate,
				pdfUrl: document.pdfKey ? `/${document.pdfKey}` : null,
			},
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
export const finaliseLegacyImports = createServerFn({ method: 'POST' }).handler(async ({ context }) => {
	const userId = requireUser(context.userId)
	await requireCentralMember(userId)
	const { env, d } = await envOf()
	const actor = await env.AUTH.getUserById(userId)
	const pending = await d.select().from(schema.documents).where(like(schema.documents.orgId, PENDING))
	const finalised: { slug: string; organizationId: string }[] = []
	const errors: string[] = []
	for (const document of pending) {
		const created = await env.AUTH.createOrganizationForUser(userId, {
			name: document.title,
			slug: document.slug,
			namespace: OCP_NAMESPACE,
		})
		if (!created.ok) {
			errors.push(`${document.slug}: ${created.error}`)
			continue
		}
		await d.update(schema.documents).set({ orgId: created.organizationId }).where(eq(schema.documents.id, document.id))
		await d.insert(schema.events).values({
			id: crypto.randomUUID(),
			documentId: document.id,
			kind: 'document.imported',
			actorId: userId,
			actorName: actor?.name ?? userId,
			detail: { organizationId: created.organizationId, slug: document.slug },
		})
		finalised.push({ slug: document.slug, organizationId: created.organizationId })
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
		const rows = await d.select().from(schema.versionSections).where(eq(schema.versionSections.versionId, versionId))
		const derived: DerivedView = {
			referenceNumbers: citationNumbers(rows.filter((r) => !r.hidden).map((r) => r.bodyJson ?? null)),
			timeframes: [],
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
					.where(and(eq(schema.versionSections.versionId, versionId), eq(schema.versionSections.sectionId, r.sectionId))),
			)
			if (first) await d.batch([first, ...rest])
			rendered += group.length
		}
	}
	// Documents whose organisation now exists but whose published version was rendered
	// earlier are reported too, so the caller sees the whole state.
	const stillPending = await d.select({ slug: schema.documents.slug }).from(schema.documents).where(like(schema.documents.orgId, PENDING))
	void inArray
	return { finalised, rendered, errors, stillPending: stillPending.map((r) => r.slug) }
})
