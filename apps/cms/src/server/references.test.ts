/**
 * A document's references over the real runtime (test D1 with the migrations applied,
 * the DocumentRoom DO for folds, the auth fixture for roles):
 *   - the list is the cited rows in first-cited order (headings first in their section),
 *     numbered as the page numbers them, then the document's own rows nothing cites;
 *   - a pathway lists the core rows its shared sections cite as not its own, and may not
 *     edit or delete them;
 *   - an edit is in place while no edition cites the row, and copy-on-write once one does:
 *     the edition keeps the old row and its text, the draft names the new row;
 *   - a cited row cannot be deleted; a viewer may read but not add.
 */

// biome-ignore lint/correctness/noUnresolvedImports: provided by the vitest workers pool
import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { referencesFor, sectionsOf } from '#/api/published.ts'
import { citationNumbers } from '#/content/derived.ts'
import type { JsonNode } from '#/content/schema.ts'
import { db, schema } from '#/db/index.ts'
import type * as lc from './lifecycle.ts'
import * as refs from './references.ts'

const CENTRAL = 'central'
const PATHWAY_ORG = 'org-refs'
const run = crypto.randomUUID().slice(0, 8)
const CORE_ID = `rcore-${run}`
const PATHWAY_ID = `rpath-${run}`
const C1 = `rc1-${run}`
const C2 = `rc2-${run}`
const P1 = `rp1-${run}`
const P2 = `rp2-${run}`
const R_A = `ra-${run}`
const R_B = `rb-${run}`
const R_T = `rt-${run}`
const R_CORE_UNUSED = `rcu-${run}`
const R_P = `rp-${run}`
const R_P_UNUSED = `rpu-${run}`
const V_PUBLISHED = `rv1-${run}`

const text = (t: string): JsonNode => ({ type: 'text', text: t })
const cite = (referenceId: string): JsonNode => ({ type: 'citation', attrs: { referenceId } })
const paragraph = (...content: JsonNode[]): JsonNode => ({ type: 'paragraph', content })
const doc = (...content: JsonNode[]): JsonNode => ({ type: 'doc', content })

const c1Body = doc(paragraph(text('Teams meet weekly.'), cite(R_A), cite(R_B)))
const c2Body = doc(paragraph(text('Again the first.'), cite(R_A)))
const p2Body = doc(paragraph(text('Local referral.'), cite(R_P), cite(R_B)))

const citedIds = (node: JsonNode | null): string[] => Object.keys(citationNumbers([node]))

const lifecycle = (): lc.Lifecycle => ({
	d: db(env.DB),
	auth: env.AUTH,
	rooms: env.DOCUMENT_ROOM,
	centralOrgId: async () => CENTRAL,
	origin: 'http://test.local',
	renderHtml: () => '',
})

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
			orgId: CENTRAL,
			slug: `rcore-${run}`,
			title: 'Core content',
			subject: 'cancer',
			audience: 'cancer',
		},
		{
			id: PATHWAY_ID,
			kind: 'pathway',
			templateId: 'cancer-test',
			orgId: PATHWAY_ORG,
			slug: `rpath-${run}`,
			title: 'Lung cancer',
			subject: 'lung cancer',
			audience: 'cancer',
		},
	])
	await d.insert(schema.references).values([
		{ id: R_A, documentId: CORE_ID, citation: 'Smith J. A trial of teams. 2020.', url: null },
		{ id: R_B, documentId: CORE_ID, citation: 'Jones K. Waiting times. 2021.', url: null },
		{ id: R_T, documentId: CORE_ID, citation: 'Heading source. 2019.', url: null },
		{ id: R_CORE_UNUSED, documentId: CORE_ID, citation: 'Never cited. 2018.', url: null },
		{
			id: R_P,
			documentId: PATHWAY_ID,
			citation: 'Lee M. Lung referral audit. 2022.',
			url: 'https://example.org/lee',
		},
		{ id: R_P_UNUSED, documentId: PATHWAY_ID, citation: 'Spare lung source. 2023.', url: null },
	])
	await d.insert(schema.sections).values([
		{
			id: C1,
			documentId: CORE_ID,
			parentId: null,
			address: '1',
			canonical: true,
			printedNumber: '1',
			title: 'Teams',
			orderIndex: 1,
			ownership: 'owned',
			pathwayOwnership: 'shared',
			bodyJson: c1Body,
		},
		{
			id: C2,
			documentId: CORE_ID,
			parentId: null,
			address: '2',
			canonical: true,
			printedNumber: '2',
			title: 'Principles',
			orderIndex: 2,
			ownership: 'owned',
			pathwayOwnership: 'owned',
			titleCitations: [R_T],
			bodyJson: c2Body,
		},
		{
			id: P1,
			documentId: PATHWAY_ID,
			parentId: null,
			address: '1',
			canonical: true,
			printedNumber: '1',
			title: 'Teams',
			orderIndex: 1,
			ownership: 'shared',
			coreSectionId: C1,
			bodyJson: null,
		},
		{
			id: P2,
			documentId: PATHWAY_ID,
			parentId: null,
			address: '2',
			canonical: true,
			printedNumber: '2',
			title: 'Referral',
			orderIndex: 2,
			ownership: 'owned',
			bodyJson: p2Body,
		},
	])
})

describe('the reference list', () => {
	it('numbers the core’s references in first-cited order, a heading’s first, then its unused rows', async () => {
		const list = await refs.listReferences(lifecycle(), {
			documentId: CORE_ID,
			userId: `viewer@${CENTRAL}`,
		})
		const expected = citationNumbers([c1Body, doc(paragraph(cite(R_T)), ...(c2Body.content ?? []))])
		expect(list.numbers).toEqual(expected)
		expect(list.references.map((r) => [r.id, r.number, r.own, r.unused])).toEqual([
			[R_A, 1, true, false],
			[R_B, 2, true, false],
			[R_T, 3, true, false],
			[R_CORE_UNUSED, null, true, true],
		])
		const a = list.references.find((r) => r.id === R_A)
		expect(a?.citedIn.map((s) => s.address)).toEqual(['1', '2'])
		const t = list.references.find((r) => r.id === R_T)
		expect(t?.citedIn).toEqual([
			{ sectionId: C2, address: '2', printedNumber: '2', title: 'Principles' },
		])
		expect(list.references.every((r) => !r.inPublished)).toBe(true)
	})

	it('lists a pathway’s core rows as not its own, through the shared section', async () => {
		const list = await refs.listReferences(lifecycle(), {
			documentId: PATHWAY_ID,
			userId: `viewer@${PATHWAY_ORG}`,
		})
		expect(list.numbers).toEqual(citationNumbers([c1Body, p2Body]))
		expect(list.references.map((r) => [r.id, r.number, r.own, r.unused])).toEqual([
			[R_A, 1, false, false],
			[R_B, 2, false, false],
			[R_P, 3, true, false],
			[R_P_UNUSED, null, true, true],
		])
		expect(list.references.find((r) => r.id === R_B)?.citedIn.map((s) => s.sectionId)).toEqual([
			P1,
			P2,
		])
	})

	it('refuses someone who is not a member', async () => {
		await expect(
			refs.listReferences(lifecycle(), { documentId: PATHWAY_ID, userId: 'member@elsewhere' }),
		).rejects.toThrow(/not a member/)
	})

	it('finds what the pathway can cite by every word of the query, cited ones first', async () => {
		const found = await refs.searchReferences(lifecycle(), {
			documentId: PATHWAY_ID,
			query: 'LUNG',
			userId: `member@${PATHWAY_ORG}`,
		})
		expect(found.map((r) => r.id)).toEqual([R_P, R_P_UNUSED])
		const both = await refs.searchReferences(lifecycle(), {
			documentId: PATHWAY_ID,
			query: 'teams smith',
			userId: `member@${PATHWAY_ORG}`,
		})
		expect(both.map((r) => r.id)).toEqual([R_A])
		// The core's unused row is not the pathway's to cite.
		const none = await refs.searchReferences(lifecycle(), {
			documentId: PATHWAY_ID,
			query: 'never cited',
			userId: `member@${PATHWAY_ORG}`,
		})
		expect(none).toEqual([])
	})
})

describe('adding, editing and deleting', () => {
	it('adds an own reference for a drafter, checking the text and the link, and refuses a viewer', async () => {
		await expect(
			refs.addReference(lifecycle(), {
				documentId: PATHWAY_ID,
				citation: 'A viewer’s source.',
				url: null,
				userId: `viewer@${PATHWAY_ORG}`,
			}),
		).rejects.toThrow(/drafter/)
		await expect(
			refs.addReference(lifecycle(), {
				documentId: PATHWAY_ID,
				citation: '   ',
				url: null,
				userId: `member@${PATHWAY_ORG}`,
			}),
		).rejects.toThrow(/citation/)
		await expect(
			refs.addReference(lifecycle(), {
				documentId: PATHWAY_ID,
				citation: 'Bad link.',
				url: 'javascript:alert(1)',
				userId: `member@${PATHWAY_ORG}`,
			}),
		).rejects.toThrow(/http/)
		const row = await refs.addReference(lifecycle(), {
			documentId: PATHWAY_ID,
			citation: '  New source. 2024.  ',
			url: ' https://example.org/new ',
			userId: `member@${PATHWAY_ORG}`,
		})
		expect(row.citation).toBe('New source. 2024.')
		expect(row.url).toBe('https://example.org/new')
		expect(row.documentId).toBe(PATHWAY_ID)
		expect(row.createdBy).toBe(`member@${PATHWAY_ORG}`)
		const events = await db(env.DB)
			.select()
			.from(schema.events)
			.where(eq(schema.events.documentId, PATHWAY_ID))
		expect(events.some((e) => e.kind === 'reference.added')).toBe(true)
		await refs.deleteReference(lifecycle(), {
			referenceId: row.id,
			documentId: PATHWAY_ID,
			userId: `member@${PATHWAY_ORG}`,
		})
	})

	it('refuses the pathway editing or deleting a core row', async () => {
		await expect(
			refs.editReference(lifecycle(), {
				referenceId: R_A,
				documentId: PATHWAY_ID,
				citation: 'Changed.',
				url: null,
				userId: `member@${PATHWAY_ORG}`,
			}),
		).rejects.toThrow(/core template/)
		await expect(
			refs.deleteReference(lifecycle(), {
				referenceId: R_B,
				documentId: PATHWAY_ID,
				userId: `member@${PATHWAY_ORG}`,
			}),
		).rejects.toThrow(/core template/)
	})

	it('edits in place while no edition cites the row', async () => {
		const result = await refs.editReference(lifecycle(), {
			referenceId: R_P,
			documentId: PATHWAY_ID,
			citation: 'Lee M. Lung referral audit, revised. 2022.',
			url: 'https://example.org/lee',
			userId: `member@${PATHWAY_ORG}`,
		})
		expect(result).toEqual({ id: R_P, copied: false })
		const row = (
			await db(env.DB).select().from(schema.references).where(eq(schema.references.id, R_P))
		)[0]
		expect(row?.citation).toBe('Lee M. Lung referral audit, revised. 2022.')
		const body = (
			await db(env.DB)
				.select({ bodyJson: schema.sections.bodyJson })
				.from(schema.sections)
				.where(eq(schema.sections.id, P2))
		)[0]
		expect(citedIds(body?.bodyJson ?? null)).toEqual([R_P, R_B])
	})

	it('copies on write once a published edition cites the row', async () => {
		const d = db(env.DB)
		// The pathway's first edition, frozen as publish writes it.
		await d.insert(schema.versions).values({
			id: V_PUBLISHED,
			documentId: PATHWAY_ID,
			status: 'published',
			versionNo: 1,
			createdBy: `owner@${CENTRAL}`,
			publishedAt: new Date(),
		})
		await d.insert(schema.versionSections).values({
			versionId: V_PUBLISHED,
			sectionId: P2,
			parentAddress: null,
			address: '2',
			title: 'Referral',
			printedNumber: '2',
			orderIndex: 2,
			ownership: 'owned',
			hidden: false,
			pointOfCare: false,
			bodyJson: p2Body,
			lastChangedVersionNo: 1,
		})
		const before = (
			await d.select().from(schema.sections).where(eq(schema.sections.id, P2))
		)[0]
		const listed = await refs.listReferences(lifecycle(), {
			documentId: PATHWAY_ID,
			userId: `member@${PATHWAY_ORG}`,
		})
		expect(listed.references.find((r) => r.id === R_P)?.inPublished).toBe(true)

		const result = await refs.editReference(lifecycle(), {
			referenceId: R_P,
			documentId: PATHWAY_ID,
			citation: 'Lee M. Lung referral audit, second report. 2025.',
			url: null,
			userId: `member@${PATHWAY_ORG}`,
		})
		expect(result.copied).toBe(true)
		expect(result.id).not.toBe(R_P)

		// The old row is untouched; the new one supersedes it.
		const old = (await d.select().from(schema.references).where(eq(schema.references.id, R_P)))[0]
		expect(old?.citation).toBe('Lee M. Lung referral audit, revised. 2022.')
		const fresh = (
			await d.select().from(schema.references).where(eq(schema.references.id, result.id))
		)[0]
		expect(fresh?.citation).toBe('Lee M. Lung referral audit, second report. 2025.')
		expect(fresh?.supersedes).toBe(R_P)
		expect(fresh?.documentId).toBe(PATHWAY_ID)

		// The draft names the new row; its clock and hash moved so the room follows.
		const after = (await d.select().from(schema.sections).where(eq(schema.sections.id, P2)))[0]
		expect(citedIds(after?.bodyJson ?? null)).toEqual([result.id, R_B])
		expect(after?.updatedAt?.getTime()).not.toBe(before?.updatedAt?.getTime() ?? null)
		expect(after?.draftHash).not.toBe(before?.draftHash)

		// The edition still names the old row, and the public list still prints its text.
		const frozen = await sectionsOf(d, V_PUBLISHED)
		expect(citedIds(frozen[0]?.bodyJson ?? null)).toEqual([R_P, R_B])
		const printed = await referencesFor(d, frozen)
		expect(printed.find((r) => r.id === R_P)?.citation).toBe(
			'Lee M. Lung referral audit, revised. 2022.',
		)

		const events = await d.select().from(schema.events).where(eq(schema.events.documentId, PATHWAY_ID))
		expect(
			events.some(
				(e) =>
					e.kind === 'reference.edited' &&
					JSON.stringify(e.detail).includes(`"to":"${result.id}"`),
			),
		).toBe(true)

		// The list now numbers the new row where the old one stood; the old one is kept,
		// unused by the draft, cited by the edition, replaced.
		const list = await refs.listReferences(lifecycle(), {
			documentId: PATHWAY_ID,
			userId: `member@${PATHWAY_ORG}`,
		})
		expect(list.references.find((r) => r.id === result.id)?.number).toBe(3)
		const kept = list.references.find((r) => r.id === R_P)
		expect([kept?.unused, kept?.inPublished, kept?.supersededBy]).toEqual([true, true, result.id])
		// The finder offers the new wording only.
		const found = await refs.searchReferences(lifecycle(), {
			documentId: PATHWAY_ID,
			query: 'lee',
			userId: `member@${PATHWAY_ORG}`,
		})
		expect(found.map((r) => r.id)).toEqual([result.id])
		// The kept wording cannot be edited again.
		await expect(
			refs.editReference(lifecycle(), {
				referenceId: R_P,
				documentId: PATHWAY_ID,
				citation: 'Another try.',
				url: null,
				userId: `member@${PATHWAY_ORG}`,
			}),
		).rejects.toThrow(/earlier wording/)
	})

	it('refuses deleting a cited row, naming where; deletes an unused one', async () => {
		const list = await refs.listReferences(lifecycle(), {
			documentId: PATHWAY_ID,
			userId: `member@${PATHWAY_ORG}`,
		})
		const current = list.references.find((r) => r.supersedes === R_P)
		expect(current).toBeDefined()
		await expect(
			refs.deleteReference(lifecycle(), {
				referenceId: current?.id ?? '',
				documentId: PATHWAY_ID,
				userId: `member@${PATHWAY_ORG}`,
			}),
		).rejects.toThrow(/section 2 of Lung cancer \(draft\)/)
		await expect(
			refs.deleteReference(lifecycle(), {
				referenceId: R_P,
				documentId: PATHWAY_ID,
				userId: `member@${PATHWAY_ORG}`,
			}),
		).rejects.toThrow(/version 1/)
		await expect(
			refs.deleteReference(lifecycle(), {
				referenceId: R_P_UNUSED,
				documentId: PATHWAY_ID,
				userId: `viewer@${PATHWAY_ORG}`,
			}),
		).rejects.toThrow(/drafter/)
		await refs.deleteReference(lifecycle(), {
			referenceId: R_P_UNUSED,
			documentId: PATHWAY_ID,
			userId: `member@${PATHWAY_ORG}`,
		})
		const gone = await db(env.DB)
			.select()
			.from(schema.references)
			.where(eq(schema.references.id, R_P_UNUSED))
		expect(gone).toEqual([])
	})
})
