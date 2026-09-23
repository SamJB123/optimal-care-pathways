/**
 * Server functions for the public read page (/p/{slug}): the published document in
 * full, through the same operation the API serves, with each body checked against the
 * content schema so the page renders typed nodes. No identity: published content.
 */

import { createServerFn } from '@tanstack/solid-start'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { contentNode } from '#/content/schema.ts'
import { schema } from '#/db/index.ts'
import { envOf } from '#/server/env.ts'
import { getDocumentFull, getQuickReferenceGuide, listVersions } from './operations.ts'
import { apiContext } from './server.ts'

/** The derived quick reference guide for /p/{slug}/quick-reference-guide. */
export const publishedGuide = createServerFn({ method: 'GET' })
	.inputValidator(
		z.object({ slug: z.string().min(1).max(120), version: z.number().int().positive().optional() }),
	)
	.handler(async ({ data }) => {
		const { env } = await envOf()
		const ctx = apiContext(env)
		const guide = await getQuickReferenceGuide.handler(data, ctx)
		const row = await ctx.d
			.select({ accent: schema.documents.accent })
			.from(schema.documents)
			.where(eq(schema.documents.slug, guide.document.slug))
			.limit(1)
		return {
			...guide,
			sections: guide.sections.map((section) => ({ ...section, body: contentNode(section.body) })),
			items: guide.items.map((item) => ({ ...item, list: contentNode(item.list) })),
			accent: row[0]?.accent ?? null,
		}
	})

/** The published page (/p/{slug}, and /p/{slug}/v/{n} for an earlier edition): the document
 *  in full at that version, its family colour, and every edition readers can open, for the
 *  imprint's list. */
export const publishedDocumentFull = createServerFn({ method: 'GET' })
	.inputValidator(
		z.object({ slug: z.string().min(1).max(120), version: z.number().int().positive().optional() }),
	)
	.handler(async ({ data }) => {
		const { env } = await envOf()
		const ctx = apiContext(env)
		const full = await getDocumentFull.handler(data, ctx)
		const [versions, row] = await Promise.all([
			listVersions.handler({ slug: full.document.slug }, ctx),
			ctx.d
				.select({ accent: schema.documents.accent })
				.from(schema.documents)
				.where(eq(schema.documents.slug, full.document.slug))
				.limit(1),
		])
		return {
			...full,
			sections: full.sections.map((section) => ({ ...section, body: contentNode(section.body) })),
			accent: row[0]?.accent ?? null,
			editions: versions.versions.filter((v) => v.status !== 'draft'),
		}
	})
