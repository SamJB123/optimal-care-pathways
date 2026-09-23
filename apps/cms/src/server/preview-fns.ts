/**
 * The draft as publishing it now would give it, for the preview (/d/{id}/preview) and the
 * draft's PDF, which Browser Run prints from the preview. Read the way `publish` reads it:
 * the room folded first, each live section's publishable body in reading order (guidance
 * and instructions gone from a pathway, its subject filled in), the references numbered
 * as publish numbers them — in the shape the published page reads. Any member of the
 * document.
 */

import { createServerFn } from '@tanstack/solid-start'
import { z } from 'zod'
import { referencesFor } from '#/api/published.ts'
import { documentName } from '#/lib/labels.ts'
import { requireUser } from './env.ts'
import { documentOf, ensureDraft, foldRoom, live, refuse, resolveSections, roleOn } from './lifecycle.ts'
import { lifecycleOf } from './lifecycle-env.ts'

export const draftReading = createServerFn({ method: 'GET' })
	.inputValidator(z.object({ documentId: z.string().min(1).max(64) }))
	.handler(async ({ data, context }) => {
		const userId = requireUser(context.userId)
		const lc = await lifecycleOf()
		const document = await documentOf(lc, data.documentId)
		if (!(await roleOn(lc, userId, document))) refuse('You are not a member of this document.')
		await foldRoom(lc, document.id)
		const [resolved, draft] = await Promise.all([resolveSections(lc, document.id), ensureDraft(lc, document.id, userId)])
		const addressOf = new Map(resolved.map((s) => [s.row.id, s.row.address]))
		const sections = resolved.filter(live)
		return {
			document: {
				id: document.id,
				title: document.title,
				slug: document.slug,
				name: documentName(document),
				accent: document.accent,
				kind: document.kind,
				audience: document.audience,
			},
			editionNo: draft.versionNo,
			sections: sections.map((s) => ({
				address: s.row.address,
				parentAddress: s.row.parentId ? (addressOf.get(s.row.parentId) ?? null) : null,
				printedNumber: s.row.printedNumber,
				title: s.row.title,
				titleCitations: s.row.titleCitations ?? [],
				ownership: s.row.ownership,
				body: s.publishable,
			})),
			references: await referencesFor(
				lc.d,
				sections.map((s) => ({ titleCitations: s.row.titleCitations, bodyJson: s.publishable })),
			),
		}
	})
