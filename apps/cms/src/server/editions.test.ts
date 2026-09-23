/**
 * The edition imprint and the comparison over the real runtime (test D1 with the
 * migrations applied, the DocumentRoom DO for the publish folds, the auth fixture for
 * roles), on a pathway taken through two editions and into a third draft:
 *   - edition 1 publishes every section; edition 2 changes one, hides one, adds one;
 *     the draft after it changes one, shows the hidden one again, deletes one;
 *   - comparing 1↔2, 2↔draft and 1↔draft names each difference's kind, groups by the
 *     current spine band and puts the deleted section last, in "No longer in the document";
 *   - the same edition twice, an edition that does not exist, the draft's number and a
 *     stranger are refused; the imprint counts what each edition changed.
 */

// biome-ignore lint/correctness/noUnresolvedImports: provided by the vitest workers pool
import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import type { JsonNode } from '#/content/schema.ts'
import { db, schema } from '#/db/index.ts'
import * as editions from './editions.ts'
import * as lc from './lifecycle.ts'

const CENTRAL = 'central'
const ORG = 'org-e'
const run = crypto.randomUUID().slice(0, 8)
const DOC = `editions-${run}`
const FRONT = `e-front-${run}`
const STEP1 = `e-step1-${run}`
const S11 = `e-1-1-${run}`
const S12 = `e-1-2-${run}`
const S13 = `e-1-new-${run}`
const STEP2 = `e-step2-${run}`
const S21 = `e-2-1-${run}`
const BACK = `e-back-${run}`

const text = (t: string): JsonNode => ({ type: 'text', text: t })
const paragraph = (t: string): JsonNode => ({ type: 'paragraph', content: [text(t)] })
const doc = (t: string): JsonNode => ({ type: 'doc', content: [paragraph(t)] })

const plain = (node: JsonNode | null): string =>
	node ? (node.text ?? (node.content ?? []).map(plain).join('')) : ''

/** As lifecycle.test.ts: the runtime pool compiles no Solid, so the HTML is plain text. */
const lifecycle = (): lc.Lifecycle => ({
	d: db(env.DB),
	auth: env.AUTH,
	rooms: env.DOCUMENT_ROOM,
	centralOrgId: async () => CENTRAL,
	origin: 'http://test.local',
	renderHtml: (body) => `<div class="ocp-body">${plain(body)}</div>`,
})

const MEMBER = `member@${ORG}`

/** Review every changed section, approve it in full, publish as the central team. */
async function publishNow(label: string | null, releaseNotes: string | null) {
	const review = await lc.requestReview(lifecycle(), {
		documentId: DOC,
		userId: MEMBER,
		note: null,
	})
	const pins = await db(env.DB)
		.select()
		.from(schema.reviewSections)
		.where(eq(schema.reviewSections.reviewId, review.reviewId))
	for (const pin of pins)
		await lc.decideSection(lifecycle(), {
			reviewId: review.reviewId,
			sectionId: pin.sectionId,
			decision: 'approved',
			note: null,
			userId: `admin@${ORG}`,
		})
	return lc.publish(lifecycle(), {
		documentId: DOC,
		userId: `owner@${CENTRAL}`,
		label,
		releaseNotes,
	})
}

const compare = (from: editions.EditionRef, to: editions.EditionRef, userId = MEMBER) =>
	editions.compareEditions(lifecycle(), { documentId: DOC, from, to, userId })

/** A comparison as [group key, [section id, kind]…] for assertions. */
const shape = (c: editions.Comparison) =>
	c.groups.map((g) => [g.key, g.entries.map((e) => [e.sectionId, e.kind])])

const section = (
	id: string,
	parentId: string | null,
	address: string,
	orderIndex: number,
	stepNumber: number | null,
	body: string,
) => ({
	id,
	documentId: DOC,
	parentId,
	address,
	canonical: true,
	printedNumber: address.startsWith('step-')
		? `Step ${stepNumber}`
		: /^\d/.test(address)
			? address
			: null,
	title: `Title ${address}`,
	orderIndex,
	stepNumber,
	ownership: 'owned' as const,
	bodyJson: doc(body),
})

beforeAll(async () => {
	const d = db(env.DB)
	await d
		.insert(schema.templates)
		.values({ id: 'cancer-test', kind: 'cancer', label: 'test', sourceFile: 'test.pdf' })
		.onConflictDoNothing()
	await d.insert(schema.documents).values({
		id: DOC,
		kind: 'pathway',
		templateId: 'cancer-test',
		orgId: ORG,
		slug: `editions-${run}`,
		title: 'Lung cancer',
		subject: 'lung cancer',
		audience: 'cancer',
	})
	// One row per statement: D1 caps a statement at 100 bound variables.
	for (const row of [
		section(FRONT, null, 'about', 1, null, 'About this pathway.'),
		section(STEP1, null, 'step-1', 2, 1, 'Prevention.'),
		section(S11, STEP1, '1.1', 1, 1, 'Screening.'),
		section(S12, STEP1, '1.2', 2, 1, 'Risk factors.'),
		section(STEP2, null, 'step-2', 3, 2, 'Presentation.'),
		section(S21, STEP2, '2.1', 1, 2, 'Referral.'),
		section(BACK, null, 'appendix', 4, null, 'Glossary.'),
	])
		await d.insert(schema.sections).values(row)
})

describe('two editions and a draft', () => {
	it('publishes edition 1, then edition 2 with a change, a hidden section and an added one', async () => {
		const d = db(env.DB)
		expect((await publishNow(null, 'First release.')).versionNo).toBe(1)
		await d
			.update(schema.sections)
			.set({ bodyJson: doc('Screening every two years.') })
			.where(eq(schema.sections.id, S11))
		await d.update(schema.sections).set({ hidden: true }).where(eq(schema.sections.id, S12))
		await d.insert(schema.sections).values({
			...section(S13, STEP1, '1/nurse-navigation', 3, 1, 'Nurse navigation.'),
			canonical: false,
			printedNumber: null,
			added: true,
		})
		expect((await publishNow('Second edition', 'Screening interval.')).versionNo).toBe(2)
		// The draft of edition 3: a change, the hidden section shown again, the back matter deleted.
		await d
			.update(schema.sections)
			.set({ bodyJson: doc('Referral within two weeks.') })
			.where(eq(schema.sections.id, S21))
		await d.update(schema.sections).set({ hidden: false }).where(eq(schema.sections.id, S12))
		await d.delete(schema.sections).where(eq(schema.sections.id, BACK))
	})

	it('compares edition 1 with edition 2', async () => {
		const c = await compare(1, 2)
		expect(c.from).toMatchObject({ ref: 1, versionNo: 1, status: 'archived', label: 'Edition 1' })
		expect(c.to).toMatchObject({
			ref: 2,
			versionNo: 2,
			status: 'published',
			label: 'Second edition',
		})
		expect(c.to.publishedAt).toBeGreaterThan(0)
		expect(c.totals).toEqual({ added: 1, removed: 0, changed: 1, hidden: 1, shown: 0 })
		expect(shape(c)).toEqual([
			[
				1,
				[
					[S11, 'changed'],
					[S12, 'hidden'],
					[S13, 'added'],
				],
			],
		])
		expect(c.groups[0]?.label).toBe('Step 1')
		const [changed, hidden, added] = c.groups[0]?.entries ?? []
		expect(changed?.annotated.inserted).toBeGreaterThan(0)
		expect(changed).toMatchObject({
			part: 'step-1',
			address: '1.1',
			printedNumber: '1.1',
			title: 'Title 1.1',
		})
		expect(hidden?.annotated).toMatchObject({ inserted: 0, changed: true })
		expect(hidden?.annotated.deleted).toBeGreaterThan(0)
		expect(added?.annotated).toMatchObject({ deleted: 0, changed: true })
		expect(plain(added?.annotated.body ?? null)).toBe('Nurse navigation.')
	})

	it('compares edition 2 with the draft: shown, changed, and the deleted section last', async () => {
		const c = await compare(2, 'draft')
		expect(c.to).toMatchObject({
			ref: 'draft',
			versionNo: 3,
			status: 'draft',
			label: 'Draft of edition 3',
			publishedAt: null,
		})
		expect(c.totals).toEqual({ added: 0, removed: 1, changed: 1, hidden: 0, shown: 1 })
		expect(shape(c)).toEqual([
			[1, [[S12, 'shown']]],
			[2, [[S21, 'changed']]],
			['gone', [[BACK, 'removed']]],
		])
		const gone = c.groups.at(-1)
		expect(gone?.label).toBe('No longer in the document')
		expect(gone?.entries[0]).toMatchObject({
			part: null,
			address: 'appendix',
			title: 'Title appendix',
		})
	})

	it('compares edition 1 with the draft, and reads the other way round', async () => {
		const c = await compare(1, 'draft')
		// 1.2 was hidden in edition 2 and shown again: it reads as edition 1 had it.
		expect(shape(c)).toEqual([
			[
				1,
				[
					[S11, 'changed'],
					[S13, 'added'],
				],
			],
			[2, [[S21, 'changed']]],
			['gone', [[BACK, 'removed']]],
		])
		const back = await compare('draft', 1)
		expect(back.totals).toEqual({ added: 1, removed: 1, changed: 2, hidden: 0, shown: 0 })
		expect(back.groups.flatMap((g) => g.entries).find((e) => e.sectionId === S13)?.kind).toBe(
			'removed',
		)
		expect(back.groups.flatMap((g) => g.entries).find((e) => e.sectionId === BACK)?.kind).toBe(
			'added',
		)
	})

	it('refuses the same edition twice, a missing edition, the draft by number and a stranger', async () => {
		await expect(compare(2, 2)).rejects.toThrow(/two different editions/)
		await expect(compare('draft', 'draft')).rejects.toThrow(/two different editions/)
		await expect(compare(1, 9)).rejects.toThrow(/no edition 9/)
		await expect(compare(3, 1)).rejects.toThrow(/has not been published/)
		await expect(compare(1, 2, 'nobody')).rejects.toThrow(/not a member/)
		await expect(editions.editionsOf(lifecycle(), DOC, 'nobody')).rejects.toThrow(/not a member/)
	})

	it('lists every version newest first with what each changed and who published it', async () => {
		const list = await editions.editionsOf(lifecycle(), DOC, MEMBER)
		expect(list.map((v) => [v.versionNo, v.status, v.changed])).toEqual([
			// The draft: 2.1 changed and 1.2 shown again against edition 2.
			[3, 'draft', 2],
			// Edition 2 changed 1.1 and added the subsection; the hidden 1.2 is not counted.
			[2, 'published', 2],
			[1, 'archived', 7],
		])
		expect(list[1]).toMatchObject({
			label: 'Second edition',
			releaseNotes: 'Screening interval.',
			publisherName: `owner@${CENTRAL}`,
		})
		expect(list[0]).toMatchObject({ publisherName: null, publishedAt: null })
		expect(list[2]?.publishedAt).toBeGreaterThan(0)
	})
})
