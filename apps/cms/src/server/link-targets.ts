/**
 * Where the Link tool can point beyond the document in hand: the sections of the
 * Principles for Optimal Cancer Care (linked on its published page by section address)
 * and every published pathway. Signed-in only: the tool is a drafter's.
 */

import { createServerFn } from '@tanstack/solid-start'
import { and, eq } from 'drizzle-orm'
import { schema } from '#/db/index.ts'
import { documentName } from '#/lib/labels.ts'
import { outlineOrder } from '#/lib/outline.ts'
import { envOf, requireUser } from './env.ts'

export interface LinkTargetSection {
	address: string
	printedNumber: string | null
	title: string | null
}

export interface LinkTargets {
	/** The Principles document and its readable sections, in reading order. */
	principles: { slug: string; sections: LinkTargetSection[] } | null
	/** Every published pathway, by name. */
	pathways: { slug: string; name: string }[]
}

export const linkTargets = createServerFn({ method: 'GET' }).handler(async ({ context }): Promise<LinkTargets> => {
	requireUser(context.userId)
	const { d } = await envOf()
	const [principlesDoc, published] = await Promise.all([
		d
			.select({ id: schema.documents.id, slug: schema.documents.slug })
			.from(schema.documents)
			.where(and(eq(schema.documents.kind, 'core'), eq(schema.documents.audience, 'principles')))
			.limit(1),
		d
			.select({
				slug: schema.publishedVersions.slug,
				kind: schema.publishedVersions.kind,
				audience: schema.publishedVersions.audience,
				subject: schema.publishedVersions.subject,
			})
			.from(schema.publishedVersions)
			.where(eq(schema.publishedVersions.kind, 'pathway')),
	])
	const core = principlesDoc[0]
	const sections = core
		? await d
				.select({
					id: schema.sections.id,
					parentId: schema.sections.parentId,
					orderIndex: schema.sections.orderIndex,
					address: schema.sections.address,
					printedNumber: schema.sections.printedNumber,
					title: schema.sections.title,
					hidden: schema.sections.hidden,
					apparatus: schema.sections.apparatus,
				})
				.from(schema.sections)
				.where(eq(schema.sections.documentId, core.id))
		: []
	const pathways = published
		.map((p) => ({ slug: p.slug, name: documentName(p) }))
		.sort((a, b) => a.name.localeCompare(b.name, 'en-AU'))
	// A hidden or apparatus section takes its subtree with it: the published page shows none.
	const left = new Set<string>()
	const readable = outlineOrder(sections).filter((s) => {
		const out = s.hidden || s.apparatus || (s.parentId !== null && left.has(s.parentId))
		if (out) left.add(s.id)
		return !out
	})
	return {
		principles: core
			? {
					slug: core.slug,
					sections: readable.map((s) => ({ address: s.address, printedNumber: s.printedNumber, title: s.title })),
				}
			: null,
		pathways,
	}
})
