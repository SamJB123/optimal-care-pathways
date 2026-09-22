/**
 * Server functions for the public read page (/p/{slug}): the published document in
 * full, through the same operation the API serves, with each body checked against the
 * content schema so the page renders typed nodes. No identity: published content.
 */

import { createServerFn } from '@tanstack/solid-start'
import { z } from 'zod'
import { contentNode } from '#/content/schema.ts'
import { envOf } from '#/server/env.ts'
import { getDocumentFull } from './operations.ts'
import { apiContext } from './server.ts'

export const publishedDocumentFull = createServerFn({ method: 'GET' })
	.inputValidator(
		z.object({ slug: z.string().min(1).max(120), version: z.number().int().positive().optional() }),
	)
	.handler(async ({ data }) => {
		const { env } = await envOf()
		const full = await getDocumentFull.handler(data, apiContext(env))
		return {
			...full,
			sections: full.sections.map((section) => ({ ...section, body: contentNode(section.body) })),
		}
	})
