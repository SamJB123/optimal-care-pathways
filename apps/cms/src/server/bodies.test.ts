/**
 * Resting bodies (server/bodies.ts), over a real D1:
 *   - an owned section rests on its own draft body;
 *   - a shared section rests on its core section's PUBLISHED body, or on the core's
 *     draft while the core has never published that section (decision 98);
 *   - a part is the top-level section and everything under it, hidden rows included,
 *     and a part the document does not have is empty.
 */

// biome-ignore lint/correctness/noUnresolvedImports: provided by the vitest workers pool
import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import type { JsonNode } from '#/content/schema.ts'
import { db, schema } from '#/db/index.ts'
import { partSections, restingBodiesOf } from './bodies.ts'

const run = crypto.randomUUID().slice(0, 8)
const CORE_ID = `bcore-${run}`
const PATHWAY_ID = `bpath-${run}`
const C_PUBLISHED = `bc1-${run}`
const C_DRAFT_ONLY = `bc2-${run}`
const P_SHARED_PUBLISHED = `bp1-${run}`
const P_SHARED_DRAFT = `bp2-${run}`
const P_OWNED = `bp3-${run}`
const P_CHILD_HIDDEN = `bp4-${run}`
const P_OTHER_PART = `bp5-${run}`
const V_PUBLISHED = `bv1-${run}`

const text = (t: string): JsonNode => ({ type: 'text', text: t })
const doc = (t: string): JsonNode => ({
	type: 'doc',
	content: [{ type: 'paragraph', content: [text(t)] }],
})

const corePublishedBody = doc('As published.')
const coreDraftAfterPublish = doc('Edited since publishing.')
const coreNeverPublished = doc('Only a draft so far.')
const ownedBody = doc('Written for this pathway.')

beforeAll(async () => {
	const d = db(env.DB)
	await d
		.insert(schema.templates)
		.values({ id: 'cancer-test', kind: 'cancer', label: 'test', sourceFile: 'test.pdf' })
		.onConflictDoNothing()
	await d.insert(schema.documents).values([
		{
			id: CORE_ID,
			kind: 'core',
			templateId: 'cancer-test',
			orgId: 'central',
			slug: CORE_ID,
			title: 'Core content',
			subject: 'cancer',
			audience: 'cancer',
		},
		{
			id: PATHWAY_ID,
			kind: 'pathway',
			templateId: 'cancer-test',
			orgId: `org-${run}`,
			slug: PATHWAY_ID,
			title: 'Lung cancer',
			subject: 'lung cancer',
			audience: 'cancer',
		},
	])
	await d.insert(schema.sections).values([
		{
			id: C_PUBLISHED,
			documentId: CORE_ID,
			parentId: null,
			address: '1',
			canonical: true,
			printedNumber: '1',
			title: 'Published since',
			orderIndex: 1,
			ownership: 'owned',
			pathwayOwnership: 'shared',
			bodyJson: coreDraftAfterPublish,
		},
		{
			id: C_DRAFT_ONLY,
			documentId: CORE_ID,
			parentId: null,
			address: '2',
			canonical: true,
			printedNumber: '2',
			title: 'Never published',
			orderIndex: 2,
			ownership: 'owned',
			pathwayOwnership: 'shared',
			bodyJson: coreNeverPublished,
		},
		{
			id: P_SHARED_PUBLISHED,
			documentId: PATHWAY_ID,
			parentId: null,
			address: '1',
			canonical: true,
			printedNumber: '1',
			title: 'Published since',
			orderIndex: 1,
			ownership: 'shared',
			coreSectionId: C_PUBLISHED,
			bodyJson: null,
		},
		{
			id: P_CHILD_HIDDEN,
			documentId: PATHWAY_ID,
			parentId: P_SHARED_PUBLISHED,
			address: '1/notes',
			canonical: false,
			title: 'Notes',
			orderIndex: 1,
			ownership: 'owned',
			added: true,
			hidden: true,
			bodyJson: ownedBody,
		},
	])
	// D1 binds at most 100 parameters per statement: the rows go in two groups.
	await d.insert(schema.sections).values([
		{
			id: P_SHARED_DRAFT,
			documentId: PATHWAY_ID,
			parentId: null,
			address: '2',
			canonical: true,
			printedNumber: '2',
			title: 'Never published',
			orderIndex: 2,
			ownership: 'shared',
			coreSectionId: C_DRAFT_ONLY,
			bodyJson: null,
		},
		{
			id: P_OWNED,
			documentId: PATHWAY_ID,
			parentId: P_SHARED_DRAFT,
			address: '2.1',
			canonical: true,
			printedNumber: '2.1',
			title: 'Own words',
			orderIndex: 1,
			ownership: 'owned',
			bodyJson: ownedBody,
		},
		{
			id: P_OTHER_PART,
			documentId: PATHWAY_ID,
			parentId: null,
			address: '3',
			canonical: true,
			printedNumber: '3',
			title: 'Elsewhere',
			orderIndex: 3,
			ownership: 'owned',
			bodyJson: ownedBody,
		},
	])
	await d.insert(schema.versions).values({
		id: V_PUBLISHED,
		documentId: CORE_ID,
		status: 'published',
		versionNo: 1,
		createdBy: 'owner@central',
		publishedAt: new Date(),
	})
	await d.insert(schema.versionSections).values({
		versionId: V_PUBLISHED,
		sectionId: C_PUBLISHED,
		parentAddress: null,
		address: '1',
		title: 'Published since',
		printedNumber: '1',
		orderIndex: 1,
		ownership: 'owned',
		hidden: false,
		pointOfCare: false,
		bodyJson: corePublishedBody,
		lastChangedVersionNo: 1,
	})
})

describe('resting bodies', () => {
	it('an owned section rests on its draft; a shared one on the core as published, else the core draft', async () => {
		const d = db(env.DB)
		const rows = await d.select().from(schema.sections)
		const mine = rows.filter((r) => r.documentId === PATHWAY_ID)
		const found = await restingBodiesOf(d, mine)
		expect(found[P_OWNED]).toEqual({ body: ownedBody, coreSource: null })
		expect(found[P_SHARED_PUBLISHED]).toEqual({ body: corePublishedBody, coreSource: 'published' })
		expect(found[P_SHARED_DRAFT]).toEqual({ body: coreNeverPublished, coreSource: 'draft' })
		expect(Object.keys(found).sort()).toEqual(mine.map((r) => r.id).sort())
	})

	it('one section alone resolves by the same rule', async () => {
		const d = db(env.DB)
		const [row] = await d
			.select()
			.from(schema.sections)
			.where(eq(schema.sections.id, P_SHARED_PUBLISHED))
		if (!row) throw new Error('fixture row missing')
		expect(await restingBodiesOf(d, [row])).toEqual({
			[P_SHARED_PUBLISHED]: { body: corePublishedBody, coreSource: 'published' },
		})
	})

	it('a part is its top-level section and everything under it, hidden rows included', async () => {
		const d = db(env.DB)
		const mine = (await d.select().from(schema.sections)).filter((r) => r.documentId === PATHWAY_ID)
		expect(partSections(mine, '1').map((r) => r.id)).toEqual([P_SHARED_PUBLISHED, P_CHILD_HIDDEN])
		expect(partSections(mine, '2').map((r) => r.id)).toEqual([P_SHARED_DRAFT, P_OWNED])
		expect(partSections(mine, '9')).toEqual([])
		// A child's address never names a part: parts are top-level only.
		expect(partSections(mine, '2.1')).toEqual([])
	})
})
