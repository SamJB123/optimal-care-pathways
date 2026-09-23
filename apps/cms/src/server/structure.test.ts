/**
 * The structure doors over the real runtime (test D1 with the migrations and their
 * triggers applied, the DocumentRoom DO for the review request's fold, the auth fixture
 * for roles and mail):
 *   - hiding takes the whole subtree and showing brings it back; scaffolding and viewers
 *     are refused;
 *   - a numbered section keeps its heading, refused by the door and by the database;
 *   - an added subheading lands where it was asked, under a unique address, indexed for
 *     search; it moves by midpoints, never under itself; it deletes with what hangs under
 *     it, unless something there came from the template;
 *   - the point-of-care flag;
 *   - the structure report is against the published version, and a review request's mail
 *     names what was removed and added.
 */

// biome-ignore lint/correctness/noUnresolvedImports: provided by the vitest workers pool
import { env } from 'cloudflare:test'
import { eq, inArray, sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { emptyBody } from '#/content/schema.ts'
import { db, schema } from '#/db/index.ts'
import { sentMail } from '../../test/worker-runtime-entry.ts'
import * as lc from './lifecycle.ts'
import * as st from './structure.ts'

const CENTRAL = 'central'
const run = crypto.randomUUID().slice(0, 8)
const ORG = `org-s-${run}`
const DOC = `doc-s-${run}`
const REPORT_DOC = `doc-r-${run}`
const MEMBER = `member@${ORG}`
const VIEWER = `viewer@${ORG}`

const id = (name: string) => `${name}-${run}`
const [S1, S11, S111, S12, S2, S2T, APP] = ['s1', 's11', 's111', 's12', 's2', 's2t', 'app'].map(id)
const [P1, P2, P3, P4, Q1, Q2] = ['p1', 'p2', 'p3', 'p4', 'q1', 'q2'].map(id)

const lifecycle = (): lc.Lifecycle => ({
	d: db(env.DB),
	auth: env.AUTH,
	rooms: env.DOCUMENT_ROOM,
	centralOrgId: async () => CENTRAL,
	origin: 'http://test.local',
	renderHtml: () => '<div></div>',
})

const body = emptyBody()

const section = (
	sectionId: string,
	documentId: string,
	fields: Partial<typeof schema.sections.$inferInsert> & { address: string; orderIndex: number },
): typeof schema.sections.$inferInsert => ({
	id: sectionId,
	documentId,
	parentId: null,
	ownership: 'owned',
	bodyJson: body,
	...fields,
})

const rowOf = async (sectionId: string) =>
	(await db(env.DB).select().from(schema.sections).where(eq(schema.sections.id, sectionId)))[0]

const indexed = (sectionId: string) =>
	db(env.DB).all<{ section_id: string; title: string }>(
		sql`SELECT section_id, title FROM section_search WHERE section_id = ${sectionId}`,
	)

beforeAll(async () => {
	const d = db(env.DB)
	await d
		.insert(schema.templates)
		.values({ id: 'cancer-test', kind: 'cancer', label: 'test', sourceFile: 'test.pdf' })
		.onConflictDoNothing()
	await d.insert(schema.documents).values(
		[DOC, REPORT_DOC].map((documentId) => ({
			id: documentId,
			kind: 'pathway' as const,
			templateId: 'cancer-test',
			orgId: ORG,
			slug: documentId,
			title: documentId === DOC ? 'Lung cancer' : 'Bowel cancer',
			subject: 'lung cancer',
			audience: 'cancer' as const,
		})),
	)
	const numbered = { canonical: true, stepNumber: 1 }
	const rows = [
		section(S1, DOC, {
			...numbered,
			address: '1',
			printedNumber: '1',
			title: 'Prevention',
			headingLevel: 1,
			orderIndex: 1,
		}),
		section(S11, DOC, {
			...numbered,
			parentId: S1,
			address: '1.1',
			printedNumber: '1.1',
			title: 'Risk',
			headingLevel: 2,
			orderIndex: 1,
		}),
		section(S111, DOC, {
			...numbered,
			parentId: S11,
			address: '1.1.1',
			printedNumber: '1.1.1',
			title: 'Smoking',
			headingLevel: 3,
			orderIndex: 1,
		}),
		section(S12, DOC, {
			...numbered,
			parentId: S1,
			address: '1.2',
			printedNumber: '1.2',
			title: 'Screening',
			headingLevel: 2,
			orderIndex: 2,
		}),
		section(S2, DOC, {
			canonical: true,
			stepNumber: 2,
			address: '2',
			printedNumber: '2',
			title: 'Presentation',
			headingLevel: 1,
			orderIndex: 2,
		}),
		section(S2T, DOC, {
			stepNumber: 2,
			parentId: S2,
			address: '2/about',
			title: 'About this step',
			headingLevel: 2,
			orderIndex: 1,
		}),
		section(APP, DOC, { apparatus: true, address: 'cover', title: 'Cover', orderIndex: 0 }),
		// The report document: P1 was hidden when published and still is, P2 has been hidden
		// since, P3 is shown, P4 is new since publishing and hidden; Q1 was added before the
		// publish, Q2 after.
		section(P1, REPORT_DOC, {
			canonical: true,
			address: '1',
			printedNumber: '1',
			title: 'One',
			orderIndex: 1,
			hidden: true,
		}),
		section(P2, REPORT_DOC, {
			canonical: true,
			address: '2',
			printedNumber: '2',
			title: 'Two',
			orderIndex: 2,
			hidden: true,
		}),
		section(P3, REPORT_DOC, {
			canonical: true,
			address: '3',
			printedNumber: '3',
			title: 'Three',
			orderIndex: 3,
		}),
		section(P4, REPORT_DOC, {
			canonical: true,
			address: '4',
			printedNumber: '4',
			title: 'Four',
			orderIndex: 4,
			hidden: true,
		}),
		section(Q1, REPORT_DOC, {
			added: true,
			parentId: P3,
			address: '3/earlier',
			title: 'Earlier',
			orderIndex: 1,
		}),
		section(Q2, REPORT_DOC, {
			added: true,
			parentId: P3,
			address: '3/later',
			title: 'Later',
			orderIndex: 2,
		}),
	]
	// D1 binds at most 100 parameters to a statement: a few rows at a time.
	for (let i = 0; i < rows.length; i += 4)
		await d.insert(schema.sections).values(rows.slice(i, i + 4))
	// The report document's published version, as a publish would have frozen it.
	const versionId = id('v1')
	await d.insert(schema.versions).values({
		id: versionId,
		documentId: REPORT_DOC,
		status: 'published',
		versionNo: 1,
		createdBy: MEMBER,
		publishedAt: new Date(),
		publishedBy: `owner@${CENTRAL}`,
	})
	await d.insert(schema.versionSections).values(
		[
			{ sectionId: P1, address: '1', hidden: true },
			{ sectionId: P2, address: '2', hidden: false },
			{ sectionId: P3, address: '3', hidden: false },
			{ sectionId: Q1, address: '3/earlier', hidden: false },
		].map((s, i) => ({
			...s,
			versionId,
			orderIndex: i,
			ownership: 'owned' as const,
			pointOfCare: false,
			bodyJson: body,
			lastChangedVersionNo: 1,
		})),
	)
})

describe('hiding and showing', () => {
	it('hides a section with its whole subtree, and shows it all again', async () => {
		const hidden = await st.setSectionHidden(lifecycle(), {
			sectionId: S1,
			hidden: true,
			userId: MEMBER,
		})
		expect(hidden.sections).toBe(4)
		const d = db(env.DB)
		const rows = await d
			.select({ id: schema.sections.id, hidden: schema.sections.hidden })
			.from(schema.sections)
			.where(inArray(schema.sections.id, [S1, S11, S111, S12, S2]))
		expect(Object.fromEntries(rows.map((r) => [r.id, r.hidden]))).toEqual({
			[S1]: true,
			[S11]: true,
			[S111]: true,
			[S12]: true,
			[S2]: false,
		})
		// Never published: the hidden subtree is reported once, by its top section, and is
		// one removal for the review.
		const state = await lc.documentState(lifecycle(), DOC, MEMBER)
		expect(state.structure.hidden.map((h) => h.address)).toEqual(['1'])
		expect(state.changes.filter((c) => c.change === 'removal').map((c) => c.address)).toEqual(['1'])
		await expect(
			st.setSectionHidden(lifecycle(), { sectionId: S11, hidden: false, userId: MEMBER }),
		).rejects.toThrow(/show that one first/)
		const shown = await st.setSectionHidden(lifecycle(), {
			sectionId: S1,
			hidden: false,
			userId: MEMBER,
		})
		expect(shown.sections).toBe(4)
		expect((await rowOf(S111))?.hidden).toBe(false)
		const events = await d.select().from(schema.events).where(eq(schema.events.documentId, DOC))
		expect(events.map((e) => e.kind)).toEqual(
			expect.arrayContaining(['section.hidden', 'section.shown']),
		)
	})

	it('refuses a viewer, and scaffolding', async () => {
		await expect(
			st.setSectionHidden(lifecycle(), { sectionId: S2, hidden: true, userId: VIEWER }),
		).rejects.toThrow(/drafter or above/)
		await expect(
			st.setSectionHidden(lifecycle(), { sectionId: APP, hidden: true, userId: MEMBER }),
		).rejects.toThrow(/scaffolding/)
		await expect(
			st.setSectionHidden(lifecycle(), { sectionId: 'missing', hidden: true, userId: MEMBER }),
		).rejects.toThrow(/Section not found/)
	})
})

describe('the numbered spine', () => {
	it('refuses renaming a numbered section at the door and in the database', async () => {
		await expect(
			st.renameSection(lifecycle(), { sectionId: S11, title: 'Risk factors', userId: MEMBER }),
		).rejects.toThrow(/numbered by the template/)
		await expect(
			st.renameSection(lifecycle(), { sectionId: S2T, title: 'Intro', userId: MEMBER }),
		).rejects.toThrow(/comes from the template/)
		const d = db(env.DB)
		// Drizzle wraps the database's refusal: the trigger's message is the cause.
		const refusal = async (query: PromiseLike<unknown>): Promise<string> => {
			try {
				await query
				return 'accepted'
			} catch (error) {
				return error instanceof Error && error.cause instanceof Error
					? error.cause.message
					: String(error)
			}
		}
		expect(
			await refusal(
				d.update(schema.sections).set({ title: 'Risk factors' }).where(eq(schema.sections.id, S11)),
			),
		).toMatch(/numbered by the template/)
		expect(
			await refusal(
				d.update(schema.sections).set({ orderIndex: 5 }).where(eq(schema.sections.id, S11)),
			),
		).toMatch(/numbered by the template/)
		// A column outside the spine still changes freely.
		await d.update(schema.sections).set({ pointOfCare: false }).where(eq(schema.sections.id, S11))
		expect((await rowOf(S11))?.title).toBe('Risk')
	})
})

describe('added subheadings', () => {
	let first = ''
	let between = ''
	let last = ''

	it('adds first, between and last, under unique addresses, indexed for search', async () => {
		const a = await st.addSubsection(lifecycle(), {
			parentId: S1,
			title: 'Local services',
			afterId: null,
			userId: MEMBER,
		})
		const b = await st.addSubsection(lifecycle(), {
			parentId: S1,
			title: ' Local services ',
			afterId: S11,
			userId: MEMBER,
		})
		const c = await st.addSubsection(lifecycle(), {
			parentId: S1,
			title: 'Follow-up’s timing',
			afterId: S12,
			userId: MEMBER,
		})
		first = a.id
		between = b.id
		last = c.id
		expect([a.address, b.address, c.address]).toEqual([
			'1/local-services',
			'1/local-services-2',
			'1/follow-ups-timing',
		])
		const [ra, rb, rc] = await Promise.all([rowOf(a.id), rowOf(b.id), rowOf(c.id)])
		expect([ra?.orderIndex, rb?.orderIndex, rc?.orderIndex]).toEqual([0, 1.5, 3])
		expect(rb?.title).toBe('Local services')
		expect(rb).toMatchObject({
			added: true,
			canonical: false,
			printedNumber: null,
			ownership: 'owned',
			headingLevel: 2,
			stepNumber: 1,
			parentId: S1,
			documentId: DOC,
			bodyJson: { type: 'doc', content: [{ type: 'paragraph' }] },
		})
		expect(rb?.draftHash).toHaveLength(64)
		expect((await indexed(b.id)).map((r) => r.title)).toEqual(['Local services'])
		const events = await db(env.DB)
			.select()
			.from(schema.events)
			.where(eq(schema.events.documentId, DOC))
		expect(events.filter((e) => e.kind === 'section.added')).toHaveLength(3)
	})

	it('refuses an empty or overlong title, a sibling from elsewhere, scaffolding and a viewer', async () => {
		await expect(
			st.addSubsection(lifecycle(), { parentId: S1, title: '   ', afterId: null, userId: MEMBER }),
		).rejects.toThrow(/needs a title/)
		await expect(
			st.addSubsection(lifecycle(), {
				parentId: S1,
				title: 'x'.repeat(201),
				afterId: null,
				userId: MEMBER,
			}),
		).rejects.toThrow(/at most 200/)
		await expect(
			st.addSubsection(lifecycle(), {
				parentId: S1,
				title: 'Elsewhere',
				afterId: S2T,
				userId: MEMBER,
			}),
		).rejects.toThrow(/not under this heading/)
		await expect(
			st.addSubsection(lifecycle(), {
				parentId: APP,
				title: 'Cover note',
				afterId: null,
				userId: MEMBER,
			}),
		).rejects.toThrow(/scaffolding/)
		await expect(
			st.addSubsection(lifecycle(), {
				parentId: S1,
				title: 'Viewer note',
				afterId: null,
				userId: VIEWER,
			}),
		).rejects.toThrow(/drafter or above/)
	})

	it('renames an added subheading, keeping its address, and reindexes it', async () => {
		await st.renameSection(lifecycle(), {
			sectionId: between,
			title: 'Services nearby',
			userId: MEMBER,
		})
		const row = await rowOf(between)
		expect(row?.title).toBe('Services nearby')
		expect(row?.address).toBe('1/local-services-2')
		expect((await indexed(between)).map((r) => r.title)).toEqual(['Services nearby'])
	})

	it('moves by midpoints, carries its subtree and the new step, refuses cycles and template sections', async () => {
		const child = await st.addSubsection(lifecycle(), {
			parentId: first,
			title: 'Clinics',
			afterId: null,
			userId: MEMBER,
		})
		expect((await rowOf(child.id))?.headingLevel).toBe(3)
		// Between 1.1 (1) and 1.2 (2), where `between` already sits at 1.5: before 1.2 is the
		// midpoint of 1.5 and 2.
		const moved = await st.moveSection(lifecycle(), {
			sectionId: first,
			parentId: S1,
			beforeId: S12,
			userId: MEMBER,
		})
		expect(moved.orderIndex).toBe(1.75)
		// Under step 2, before its template section: one before it.
		const across = await st.moveSection(lifecycle(), {
			sectionId: first,
			parentId: S2,
			beforeId: S2T,
			userId: MEMBER,
		})
		expect(across.orderIndex).toBe(0)
		const [row, childRow] = await Promise.all([rowOf(first), rowOf(child.id)])
		expect(row).toMatchObject({
			parentId: S2,
			stepNumber: 2,
			headingLevel: 2,
			address: '1/local-services',
		})
		expect(childRow).toMatchObject({ parentId: first, stepNumber: 2, headingLevel: 3 })
		// Last under 1.2, one level deeper: the subtree keeps its shape below it.
		const deeper = await st.moveSection(lifecycle(), {
			sectionId: first,
			parentId: S12,
			beforeId: null,
			userId: MEMBER,
		})
		expect(deeper.orderIndex).toBe(0)
		expect((await rowOf(first))?.headingLevel).toBe(3)
		expect((await rowOf(child.id))?.headingLevel).toBe(4)
		await expect(
			st.moveSection(lifecycle(), {
				sectionId: first,
				parentId: child.id,
				beforeId: null,
				userId: MEMBER,
			}),
		).rejects.toThrow(/under itself/)
		await expect(
			st.moveSection(lifecycle(), {
				sectionId: first,
				parentId: first,
				beforeId: null,
				userId: MEMBER,
			}),
		).rejects.toThrow(/under itself/)
		await expect(
			st.moveSection(lifecycle(), { sectionId: S12, parentId: S2, beforeId: null, userId: MEMBER }),
		).rejects.toThrow(/numbered by the template/)
		await expect(
			st.moveSection(lifecycle(), {
				sectionId: first,
				parentId: P3,
				beforeId: null,
				userId: MEMBER,
			}),
		).rejects.toThrow(/not in this document/)
		await expect(
			st.moveSection(lifecycle(), {
				sectionId: first,
				parentId: S1,
				beforeId: S2T,
				userId: MEMBER,
			}),
		).rejects.toThrow(/not under that heading/)
	})

	it('refuses deleting a subheading holding a template section; deletes one with its own subtree', async () => {
		const d = db(env.DB)
		// A template section under an added one: the doors never make this, an import might.
		const stray = id('stray')
		await d
			.insert(schema.sections)
			.values(
				section(stray, DOC, { parentId: last, address: '1/stray', title: 'Stray', orderIndex: 1 }),
			)
		await expect(
			st.deleteSection(lifecycle(), { sectionId: last, userId: MEMBER }),
		).rejects.toThrow(/Stray.*comes from the template/)
		await expect(st.deleteSection(lifecycle(), { sectionId: S12, userId: MEMBER })).rejects.toThrow(
			/numbered by the template/,
		)
		const child = (
			await d.select().from(schema.sections).where(eq(schema.sections.parentId, first))
		)[0]
		expect(child).toBeDefined()
		const childId = child?.id ?? ''
		await lc.addComment(lifecycle(), {
			documentId: DOC,
			sectionId: childId,
			kind: 'comment',
			body: 'Name the clinics.',
			userId: MEMBER,
		})
		const result = await st.deleteSection(lifecycle(), { sectionId: first, userId: MEMBER })
		expect(result.deleted).toEqual([childId, first])
		expect(await rowOf(first)).toBeUndefined()
		expect(await rowOf(childId)).toBeUndefined()
		expect(
			await d.select().from(schema.comments).where(eq(schema.comments.sectionId, childId)),
		).toEqual([])
		expect(await indexed(first)).toEqual([])
	})
})

describe('the quick reference guide', () => {
	it('marks and unmarks a section', async () => {
		await st.setPointOfCare(lifecycle(), { sectionId: S11, on: true, userId: MEMBER })
		expect((await rowOf(S11))?.pointOfCare).toBe(true)
		await st.setPointOfCare(lifecycle(), { sectionId: S11, on: false, userId: MEMBER })
		expect((await rowOf(S11))?.pointOfCare).toBe(false)
		await expect(
			st.setPointOfCare(lifecycle(), { sectionId: S11, on: true, userId: VIEWER }),
		).rejects.toThrow(/drafter or above/)
	})
})

describe('the structure report', () => {
	it('lists what was hidden and added since the published version', async () => {
		const state = await lc.documentState(lifecycle(), REPORT_DOC, MEMBER)
		expect(state.structure).toEqual({
			hidden: [
				{ sectionId: P2, address: '2', title: 'Two' },
				{ sectionId: P4, address: '4', title: 'Four' },
			],
			added: [{ sectionId: Q2, address: '3/later', title: 'Later' }],
		})
	})

	it('names them in the review request', async () => {
		const before = sentMail.length
		const result = await lc.requestReview(lifecycle(), {
			documentId: REPORT_DOC,
			userId: MEMBER,
			note: null,
		})
		expect(result).toMatchObject({ hidden: 2, added: 1 })
		const mail = sentMail.slice(before).find((m) => m.subject === 'Review requested: Bowel cancer')
		expect(mail?.text).toContain('Sections removed: Two (2); Four (4).')
		expect(mail?.text).toContain('Subheadings added: Later (3/later).')
	})
})
