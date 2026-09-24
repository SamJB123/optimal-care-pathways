/**
 * The review and publish lifecycle over the real runtime (test D1 with the migrations
 * applied, the DocumentRoom DO for folds, the auth fixture for roles and mail):
 *   - a review pins the changed sections; decisions roll up in the view; a later request
 *     supersedes; the wrong role is refused;
 *   - the gate blocks on placeholders, on an undecided review and on a stale hash;
 *   - publishing freezes resolved, rendered sections, archives the incumbent and opens
 *     the next draft; the published views answer;
 *   - a pathway's shared section publishes the core's PUBLISHED body and records the
 *     core version; suggestions and diverge/revert behave;
 *   - a draft that only hides sections is reviewed and published (one removal per hidden
 *     subtree), and a change the review never saw blocks the publish.
 */

// biome-ignore lint/correctness/noUnresolvedImports: provided by the vitest workers pool
import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { referencesFor, sectionsOf } from '#/api/published.ts'
import type { JsonNode } from '#/content/schema.ts'
import { db, schema } from '#/db/index.ts'
import { sentMail } from '../../test/worker-runtime-entry.ts'
import * as lc from './lifecycle.ts'

const CENTRAL = 'central'
const PATHWAY_ORG = 'org-p'
const run = crypto.randomUUID().slice(0, 8)
const CORE_ID = `core-${run}`
const PATHWAY_ID = `pathway-${run}`
const S_SHARED = `s-shared-${run}`
const S_OWNED = `s-owned-${run}`
const P_SHARED = `p-shared-${run}`
const P_OWNED = `p-owned-${run}`
const REF = `ref-${run}`

const text = (t: string, marks?: JsonNode['marks']): JsonNode => ({
	type: 'text',
	text: t,
	...(marks ? { marks } : {}),
})
const paragraph = (...content: JsonNode[]): JsonNode => ({ type: 'paragraph', content })
const doc = (...content: JsonNode[]): JsonNode => ({ type: 'doc', content })

const sharedBody = doc(
	paragraph(text('Multidisciplinary care improves outcomes.'), {
		type: 'citation',
		attrs: { referenceId: REF },
	}),
)
const ownedBody = doc(
	{ type: 'guidance', content: [paragraph(text('Complete the box below.'))] },
	paragraph(
		text('Refer people with '),
		text('[cancer type]', [{ type: 'placeholder', attrs: { label: '[cancer type]' } }]),
		text(' promptly.'),
	),
)
const blockedBody = doc(
	paragraph(
		text('Use '),
		text('[insert scale]', [{ type: 'placeholder', attrs: { label: '[insert scale]' } }]),
		text(' here.'),
	),
)

const plain = (node: JsonNode | null): string =>
	node ? (node.text ?? (node.content ?? []).map(plain).join('')) : ''

/** The runtime pool compiles no Solid; the real renderer is proven in
 *  content/render-html.node.test.ts. Here the HTML is the plain text in a div. */
const lifecycle = (): lc.Lifecycle => ({
	d: db(env.DB),
	auth: env.AUTH,
	rooms: env.DOCUMENT_ROOM,
	centralOrgId: async () => CENTRAL,
	origin: 'http://test.local',
	renderHtml: (body) => `<div class="ocp-body">${plain(body)}</div>`,
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
			slug: `core-${run}`,
			title: 'Core content',
			subject: 'cancer',
			audience: 'cancer',
		},
		{
			id: PATHWAY_ID,
			kind: 'pathway',
			templateId: 'cancer-test',
			orgId: PATHWAY_ORG,
			slug: `bc-${run}`,
			title: 'Breast cancer',
			subject: 'breast cancer',
			audience: 'cancer',
		},
	])
	await d
		.insert(schema.references)
		.values({ id: REF, documentId: CORE_ID, citation: 'A reference.', url: null })
	await d.insert(schema.sections).values([
		{
			id: S_SHARED,
			documentId: CORE_ID,
			parentId: null,
			address: '1',
			canonical: true,
			printedNumber: '1',
			title: 'Shared',
			orderIndex: 1,
			ownership: 'owned',
			pathwayOwnership: 'shared',
			bodyJson: sharedBody,
		},
		{
			id: S_OWNED,
			documentId: CORE_ID,
			parentId: null,
			address: '2',
			canonical: true,
			printedNumber: '2',
			title: 'Owned',
			orderIndex: 2,
			ownership: 'owned',
			pathwayOwnership: 'owned',
			bodyJson: ownedBody,
		},
		{
			id: P_SHARED,
			documentId: PATHWAY_ID,
			parentId: null,
			address: '1',
			canonical: true,
			printedNumber: '1',
			title: 'Shared',
			orderIndex: 1,
			ownership: 'shared',
			coreSectionId: S_SHARED,
			bodyJson: null,
		},
		{
			id: P_OWNED,
			documentId: PATHWAY_ID,
			parentId: null,
			address: '2',
			canonical: true,
			printedNumber: '2',
			title: 'Owned',
			orderIndex: 2,
			ownership: 'owned',
			bodyJson: blockedBody,
		},
	])
})

describe('review of the core document', () => {
	let reviewId = ''

	it('pins every section that differs from the (absent) published version', async () => {
		const before = sentMail.length
		const result = await lc.requestReview(lifecycle(), {
			documentId: CORE_ID,
			userId: `member@${CENTRAL}`,
			note: 'First pass',
		})
		reviewId = result.reviewId
		expect(result.sections).toBe(2)
		const pins = await db(env.DB)
			.select()
			.from(schema.reviewSections)
			.where(eq(schema.reviewSections.reviewId, reviewId))
		expect(pins.map((p) => p.sectionId).sort()).toEqual([S_OWNED, S_SHARED].sort())
		expect(pins.every((p) => p.bodyHash.length === 64)).toBe(true)
		expect(sentMail.slice(before).some((m) => m.subject.startsWith('Review requested'))).toBe(true)
	})

	it('shows the open review and wholly-inserted diffs in the document state', async () => {
		const state = await lc.documentState(lifecycle(), CORE_ID, `member@${CENTRAL}`)
		expect(state.draft.versionNo).toBe(1)
		expect(state.published).toBeNull()
		expect(state.review?.reviewId).toBe(reviewId)
		expect(state.review?.decision).toBeNull()
		expect(state.review?.total).toBe(2)
		expect(state.changes.map((c) => c.address).sort()).toEqual(['1', '2'])
		expect(state.changes.every((c) => c.annotated.changed && c.annotated.deleted === 0)).toBe(true)
	})

	it('refuses a decision from a drafter, takes one from a reviewer, rolls up when complete', async () => {
		await expect(
			lc.decideSection(lifecycle(), {
				reviewId,
				sectionId: S_SHARED,
				decision: 'approved',
				note: null,
				userId: `member@${CENTRAL}`,
			}),
		).rejects.toThrow(/reviewer/)
		const partial = await lc.decideSection(lifecycle(), {
			reviewId,
			sectionId: S_SHARED,
			decision: 'approved',
			note: null,
			userId: `admin@${CENTRAL}`,
		})
		expect(partial.decided).toBe(1)
		expect(partial.decision).toBeNull()
		const before = sentMail.length
		const complete = await lc.decideSection(lifecycle(), {
			reviewId,
			sectionId: S_OWNED,
			decision: 'approved',
			note: 'Good',
			userId: `admin@${CENTRAL}`,
		})
		expect(complete.decision).toBe('approved')
		expect(sentMail.slice(before).some((m) => m.subject.startsWith('Review approved'))).toBe(true)
		const events = await db(env.DB)
			.select()
			.from(schema.events)
			.where(eq(schema.events.documentId, CORE_ID))
		expect(events.map((e) => e.kind)).toEqual(
			expect.arrayContaining(['review.requested', 'review.decided']),
		)
	})

	it('reads the gate: a template scaffold’s placeholders and guidance are the pathway’s, review approved', async () => {
		const readiness = await lc.publishReadiness(lifecycle(), CORE_ID, `owner@${CENTRAL}`)
		const byKey = Object.fromEntries(readiness.items.map((i) => [i.key, i]))
		expect(byKey.placeholders?.level).toBe('ok')
		// The owned section is a scaffold pathways write for themselves: its open guidance
		// gates their publish, not the template's.
		expect(byKey.guidance?.level).toBe('ok')
		expect(byKey.review?.level).toBe('ok')
		expect(readiness.blocked).toBe(false)
	})

	it('publishes: frozen rendered sections, incumbent archived, next draft opened, views answer', async () => {
		const result = await lc.publish(lifecycle(), {
			documentId: CORE_ID,
			userId: `owner@${CENTRAL}`,
			label: 'First edition',
			releaseNotes: 'Initial publication.',
		})
		expect(result.versionNo).toBe(1)
		const d = db(env.DB)
		const published = (
			await d
				.select()
				.from(schema.publishedVersions)
				.where(eq(schema.publishedVersions.documentId, CORE_ID))
		)[0]
		expect(published?.versionNo).toBe(1)
		expect(published?.label).toBe('First edition')
		const frozen = await d
			.select()
			.from(schema.publishedSections)
			.where(eq(schema.publishedSections.documentId, CORE_ID))
		const owned = frozen.find((s) => s.sectionId === S_OWNED)
		// A core document IS the template: it publishes as the template prints, its drafting
		// guidance included. A pathway's publish strips it (publish-body tests).
		expect(owned?.bodyJson?.content?.some((n) => n.type === 'guidance')).toBe(true)
		expect(plain(owned?.bodyJson ?? null)).toContain('Refer people with [cancer type] promptly.')
		// The published side of the change hash is written with the body.
		const hashed = await d
			.select({ bodyHash: schema.versionSections.bodyHash })
			.from(schema.versionSections)
			.where(eq(schema.versionSections.sectionId, S_OWNED))
		expect(hashed.every((h) => h.bodyHash?.length === 64)).toBe(true)
		expect(owned?.html).toContain('Refer people with [cancer type] promptly.')
		expect(owned?.markdown).toContain('Refer people with')
		expect(owned?.lastChangedVersionNo).toBe(1)
		const shared = frozen.find((s) => s.sectionId === S_SHARED)
		expect(shared?.markdown).toContain('[^1]')
		const versions = await lc.versionsOf(lifecycle(), CORE_ID)
		expect(versions.map((v) => [v.versionNo, v.status])).toEqual([
			[2, 'draft'],
			[1, 'published'],
		])
		await expect(
			lc.requestReview(lifecycle(), {
				documentId: CORE_ID,
				userId: `member@${CENTRAL}`,
				note: null,
			}),
		).rejects.toThrow(/Nothing has changed/)
	})

	it('a later edit is the only change; approving then editing again makes the review stale', async () => {
		const d = db(env.DB)
		const edited = doc(
			paragraph(text('Multidisciplinary care improves outcomes for everyone.'), {
				type: 'citation',
				attrs: { referenceId: REF },
			}),
		)
		await d
			.update(schema.sections)
			.set({ bodyJson: edited, updatedAt: new Date() })
			.where(eq(schema.sections.id, S_SHARED))
		const changed = await lc.changedSections(lifecycle(), CORE_ID)
		expect(changed.map((s) => s.row.id)).toEqual([S_SHARED])
		const state = await lc.documentState(lifecycle(), CORE_ID, `member@${CENTRAL}`)
		expect(state.changes[0]?.annotated.inserted).toBeGreaterThan(0)
		const review = await lc.requestReview(lifecycle(), {
			documentId: CORE_ID,
			userId: `member@${CENTRAL}`,
			note: null,
		})
		expect(review.sections).toBe(1)
		await lc.decideSection(lifecycle(), {
			reviewId: review.reviewId,
			sectionId: S_SHARED,
			decision: 'approved',
			note: null,
			userId: `admin@${CENTRAL}`,
		})
		await d
			.update(schema.sections)
			.set({ bodyJson: doc(paragraph(text('Changed again after approval.'))) })
			.where(eq(schema.sections.id, S_SHARED))
		const readiness = await lc.publishReadiness(lifecycle(), CORE_ID, `owner@${CENTRAL}`)
		expect(readiness.items.find((i) => i.key === 'review')?.level).toBe('block')
		expect(readiness.items.find((i) => i.key === 'review')?.message).toMatch(
			/changed since the review/,
		)
		// A fresh request supersedes the approved-but-stale one.
		const again = await lc.requestReview(lifecycle(), {
			documentId: CORE_ID,
			userId: `member@${CENTRAL}`,
			note: null,
		})
		await expect(
			lc.decideSection(lifecycle(), {
				reviewId: review.reviewId,
				sectionId: S_SHARED,
				decision: 'approved',
				note: null,
				userId: `admin@${CENTRAL}`,
			}),
		).rejects.toThrow(/later review/)
		await lc.decideSection(lifecycle(), {
			reviewId: again.reviewId,
			sectionId: S_SHARED,
			decision: 'changes_requested',
			note: 'Too broad',
			userId: `admin@${CENTRAL}`,
		})
		const after = await lc.publishReadiness(lifecycle(), CORE_ID, `owner@${CENTRAL}`)
		expect(after.items.find((i) => i.key === 'review')?.message).toMatch(/asked for changes/)
	})
})

describe('the pathway', () => {
	it('resolves its shared section to the core’s published body and blocks on a real placeholder', async () => {
		const resolved = await lc.resolveSections(lifecycle(), PATHWAY_ID)
		const shared = resolved.find((s) => s.row.id === P_SHARED)
		expect(shared?.coreSource).toBe('published')
		expect(plain(shared?.body ?? null)).toBe('Multidisciplinary care improves outcomes.')
		const readiness = await lc.publishReadiness(lifecycle(), PATHWAY_ID, `owner@${CENTRAL}`)
		const placeholders = readiness.items.find((i) => i.key === 'placeholders')
		expect(placeholders?.level).toBe('block')
		expect(placeholders?.sections).toEqual(['2'])
		expect(readiness.items.find((i) => i.key === 'core')?.level).toBe('ok')
	})

	it('does not block on a placeholder in drafting guidance: a pathway publishes without it', async () => {
		await db(env.DB)
			.update(schema.sections)
			.set({
				bodyJson: doc(
					{
						type: 'guidance',
						content: [
							paragraph(
								text('Add sub-categories if required', [
									{ type: 'placeholder', attrs: { label: 'Add sub-categories if required' } },
								]),
							),
						],
					},
					paragraph(text('Use the ECOG scale here.')),
				),
			})
			.where(eq(schema.sections.id, P_OWNED))
		const readiness = await lc.publishReadiness(lifecycle(), PATHWAY_ID, `owner@${CENTRAL}`)
		expect(readiness.items.find((i) => i.key === 'placeholders')?.level).toBe('ok')
		// The guidance itself is still the drafter's to tick done: a warning, not a block.
		expect(readiness.items.find((i) => i.key === 'guidance')?.level).toBe('warn')
	})

	it('warns while the template’s alternatives ("Or" rows) stand unchosen', async () => {
		const d = db(env.DB)
		await d
			.update(schema.sections)
			.set({
				bodyJson: doc({
					type: 'variants',
					content: [
						{ type: 'variant', content: [paragraph(text('Screening is offered from age 50.'))] },
						{ type: 'variant', content: [paragraph(text('Screening is not recommended.'))] },
					],
				}),
			})
			.where(eq(schema.sections.id, P_OWNED))
		const row = (await d.select().from(schema.sections).where(eq(schema.sections.id, P_OWNED)))[0]
		const readiness = await lc.publishReadiness(lifecycle(), PATHWAY_ID, `owner@${CENTRAL}`)
		const choices = readiness.items.find((i) => i.key === 'choices')
		expect(choices?.level).toBe('warn')
		expect(choices?.sections).toEqual([row?.address])
		// One alternative kept: the choice is made.
		await d
			.update(schema.sections)
			.set({ bodyJson: doc(paragraph(text('Screening is not recommended.'))) })
			.where(eq(schema.sections.id, P_OWNED))
		const after = await lc.publishReadiness(lifecycle(), PATHWAY_ID, `owner@${CENTRAL}`)
		expect(after.items.find((i) => i.key === 'choices')?.level).toBe('ok')
	})

	it('publishes once reviewed by its own reviewer, freezing the core body and the core version', async () => {
		const d = db(env.DB)
		await d
			.update(schema.sections)
			.set({ bodyJson: doc(paragraph(text('Use the ECOG scale here.'))) })
			.where(eq(schema.sections.id, P_OWNED))
		const review = await lc.requestReview(lifecycle(), {
			documentId: PATHWAY_ID,
			userId: `member@${PATHWAY_ORG}`,
			note: null,
		})
		expect(review.sections).toBe(2)
		for (const sectionId of [P_SHARED, P_OWNED])
			await lc.decideSection(lifecycle(), {
				reviewId: review.reviewId,
				sectionId,
				decision: 'approved',
				note: null,
				userId: `admin@${PATHWAY_ORG}`,
			})
		await expect(
			lc.publish(lifecycle(), {
				documentId: PATHWAY_ID,
				userId: `owner@${PATHWAY_ORG}`,
				label: null,
				releaseNotes: null,
			}),
		).rejects.toThrow(/central organisation/)
		const result = await lc.publish(lifecycle(), {
			documentId: PATHWAY_ID,
			userId: `owner@${CENTRAL}`,
			label: null,
			releaseNotes: 'First pathway release.',
		})
		expect(result.versionNo).toBe(1)
		const frozen = await d
			.select()
			.from(schema.publishedSections)
			.where(eq(schema.publishedSections.documentId, PATHWAY_ID))
		expect(plain(frozen.find((s) => s.sectionId === P_SHARED)?.bodyJson ?? null)).toBe(
			'Multidisciplinary care improves outcomes.',
		)
		const version = (
			await d
				.select()
				.from(schema.publishedVersions)
				.where(eq(schema.publishedVersions.documentId, PATHWAY_ID))
		)[0]
		const coreVersion = (
			await d
				.select()
				.from(schema.publishedVersions)
				.where(eq(schema.publishedVersions.documentId, CORE_ID))
		)[0]
		expect(version?.coreVersionId).toBe(coreVersion?.versionId)
	})

	it('takes a suggestion on the shared section only, and lists it for the core', async () => {
		await expect(
			lc.addComment(lifecycle(), {
				documentId: PATHWAY_ID,
				sectionId: P_OWNED,
				kind: 'suggestion',
				body: 'x',
				userId: `member@${PATHWAY_ORG}`,
			}),
		).rejects.toThrow(/shared section/)
		const suggestion = await lc.addComment(lifecycle(), {
			documentId: PATHWAY_ID,
			sectionId: P_SHARED,
			kind: 'suggestion',
			body: 'Mention nurse navigators.',
			userId: `member@${PATHWAY_ORG}`,
		})
		const comment = await lc.addComment(lifecycle(), {
			documentId: PATHWAY_ID,
			sectionId: P_OWNED,
			kind: 'comment',
			body: 'Check the scale name.',
			userId: `admin@${PATHWAY_ORG}`,
		})
		const listed = await lc.listComments(lifecycle(), PATHWAY_ID, `member@${PATHWAY_ORG}`)
		expect(listed.map((c) => c.id)).toEqual(expect.arrayContaining([suggestion.id, comment.id]))
		const forCore = await lc.suggestionsForCore(lifecycle(), CORE_ID, `admin@${CENTRAL}`)
		expect(forCore.map((s) => [s.id, s.coreSectionId, s.pathway.title])).toEqual([
			[suggestion.id, S_SHARED, 'Breast cancer'],
		])
		const resolved = await lc.resolveComment(lifecycle(), {
			commentId: comment.id,
			userId: `member@${PATHWAY_ORG}`,
			resolved: true,
		})
		expect(resolved.resolvedBy).toBe(`member@${PATHWAY_ORG}`)
	})

	it('diverges the shared section into an owned copy of the published core body, and reverts', async () => {
		const diverged = await lc.divergeSection(lifecycle(), {
			sectionId: P_SHARED,
			userId: `member@${PATHWAY_ORG}`,
		})
		expect(diverged?.ownership).toBe('owned')
		expect(diverged?.coreSectionId).toBe(S_SHARED)
		expect(plain(diverged?.bodyJson ?? null)).toBe('Multidisciplinary care improves outcomes.')
		await expect(
			lc.divergeSection(lifecycle(), { sectionId: P_SHARED, userId: `member@${PATHWAY_ORG}` }),
		).rejects.toThrow(/already/)
		const reverted = await lc.revertSection(lifecycle(), {
			sectionId: P_SHARED,
			userId: `member@${PATHWAY_ORG}`,
		})
		expect(reverted?.ownership).toBe('shared')
		expect(reverted?.bodyJson).toBeNull()
	})
})

describe('a draft that removes sections', () => {
	const P_CHILD = `p-child-${run}`
	const hide = (ids: string[], hidden: boolean) =>
		Promise.all(
			ids.map((id) =>
				db(env.DB).update(schema.sections).set({ hidden }).where(eq(schema.sections.id, id)),
			),
		)

	it('a hidden subtree is one removal, named by its top section, reviewed and published alone', async () => {
		const d = db(env.DB)
		await d.insert(schema.sections).values({
			id: P_CHILD,
			documentId: PATHWAY_ID,
			parentId: P_OWNED,
			address: '2/team-notes',
			canonical: false,
			added: true,
			title: 'Team notes',
			orderIndex: 1,
			ownership: 'owned',
			bodyJson: doc(paragraph(text('Notes for the team.'))),
		})
		// The added subsection is new text since the published edition: publish it first,
		// so what follows is a removal alone.
		const first = await lc.requestReview(lifecycle(), {
			documentId: PATHWAY_ID,
			userId: `member@${PATHWAY_ORG}`,
			note: null,
		})
		await lc.decideSection(lifecycle(), {
			reviewId: first.reviewId,
			sectionId: P_CHILD,
			decision: 'approved',
			note: null,
			userId: `admin@${PATHWAY_ORG}`,
		})
		await lc.publish(lifecycle(), {
			documentId: PATHWAY_ID,
			userId: `owner@${CENTRAL}`,
			label: null,
			releaseNotes: null,
		})

		// Hiding a section hides everything under it; the review sees one removal.
		await hide([P_OWNED, P_CHILD], true)
		const changes = await lc.reviewableChanges(lifecycle(), PATHWAY_ID)
		expect(changes.text).toEqual([])
		expect(changes.removals.map((s) => s.row.id)).toEqual([P_OWNED])
		expect(
			(await lc.structureChanges(lifecycle(), PATHWAY_ID)).hidden.map((h) => h.sectionId),
		).toEqual([P_OWNED])
		const state = await lc.documentState(lifecycle(), PATHWAY_ID, `member@${PATHWAY_ORG}`)
		expect(state.changes.map((c) => [c.sectionId, c.change])).toEqual([[P_OWNED, 'removal']])
		// A removal shows the text readers lose, struck through.
		expect(state.changes[0]?.annotated.deleted).toBeGreaterThan(0)
		expect(state.changes[0]?.annotated.inserted).toBe(0)

		const before = sentMail.length
		const review = await lc.requestReview(lifecycle(), {
			documentId: PATHWAY_ID,
			userId: `member@${PATHWAY_ORG}`,
			note: null,
		})
		expect(review.sections).toBe(0)
		expect(review.hidden).toBe(1)
		const pins = await d
			.select()
			.from(schema.reviewSections)
			.where(eq(schema.reviewSections.reviewId, review.reviewId))
		expect(pins.map((p) => [p.sectionId, p.change])).toEqual([[P_OWNED, 'removal']])
		const mail = sentMail.slice(before).find((m) => m.subject.startsWith('Review requested'))
		expect(mail?.text).toContain('sections removed only')
		expect(mail?.text).toContain('Sections removed: Owned (2).')
		expect(mail?.text).not.toContain('Team notes')

		await lc.decideSection(lifecycle(), {
			reviewId: review.reviewId,
			sectionId: P_OWNED,
			decision: 'approved',
			note: null,
			userId: `admin@${PATHWAY_ORG}`,
		})
		const ready = await lc.publishReadiness(lifecycle(), PATHWAY_ID, `owner@${CENTRAL}`)
		expect(ready.items.find((i) => i.key === 'changes')?.message).toBe(
			'1 section removed since the published version.',
		)
		expect(ready.blocked).toBe(false)

		// Shown again, the approved removal no longer holds; hidden again, it does.
		await hide([P_OWNED, P_CHILD], false)
		const shown = await lc.publishReadiness(lifecycle(), PATHWAY_ID, `owner@${CENTRAL}`)
		expect(shown.items.find((i) => i.key === 'review')?.message).toMatch(/changed since the review/)
		await hide([P_OWNED, P_CHILD], true)

		const published = await lc.publish(lifecycle(), {
			documentId: PATHWAY_ID,
			userId: `owner@${CENTRAL}`,
			label: null,
			releaseNotes: null,
		})
		const frozen = await d
			.select({
				sectionId: schema.versionSections.sectionId,
				hidden: schema.versionSections.hidden,
			})
			.from(schema.versionSections)
			.where(eq(schema.versionSections.versionId, published.versionId))
		expect(
			frozen
				.filter((f) => f.hidden)
				.map((f) => f.sectionId)
				.sort(),
		).toEqual([P_CHILD, P_OWNED].sort())
		const after = await lc.reviewableChanges(lifecycle(), PATHWAY_ID)
		expect(after.all).toEqual([])
	})

	it('a change the review never saw blocks the publish until it is reviewed', async () => {
		await hide([P_OWNED, P_CHILD], false)
		const review = await lc.requestReview(lifecycle(), {
			documentId: PATHWAY_ID,
			userId: `member@${PATHWAY_ORG}`,
			note: null,
		})
		for (const sectionId of [P_OWNED, P_CHILD])
			await lc.decideSection(lifecycle(), {
				reviewId: review.reviewId,
				sectionId,
				decision: 'approved',
				note: null,
				userId: `admin@${PATHWAY_ORG}`,
			})
		expect((await lc.publishReadiness(lifecycle(), PATHWAY_ID, `owner@${CENTRAL}`)).blocked).toBe(
			false,
		)
		// Hiding the shared section after the request: a removal the review never saw.
		await hide([P_SHARED], true)
		const readiness = await lc.publishReadiness(lifecycle(), PATHWAY_ID, `owner@${CENTRAL}`)
		const item = readiness.items.find((i) => i.key === 'review')
		expect(item?.level).toBe('block')
		expect(item?.message).toMatch(/since the review was requested/)
		expect(item?.sections).toEqual(['1'])
		await hide([P_SHARED], false)
	})

	it('freezes a heading’s own citations and numbers them before its body’s', async () => {
		const d = db(env.DB)
		const cited = `ref-cited-${run}`
		await d
			.insert(schema.references)
			.values({ id: cited, documentId: PATHWAY_ID, citation: 'Cited in the body.', url: null })
		await d
			.update(schema.sections)
			.set({
				titleCitations: [REF],
				bodyJson: doc(
					paragraph(text('Use the ECOG scale here.'), {
						type: 'citation',
						attrs: { referenceId: cited },
					}),
				),
			})
			.where(eq(schema.sections.id, P_OWNED))
		const review = await lc.requestReview(lifecycle(), {
			documentId: PATHWAY_ID,
			userId: `member@${PATHWAY_ORG}`,
			note: null,
		})
		const pins = await d
			.select()
			.from(schema.reviewSections)
			.where(eq(schema.reviewSections.reviewId, review.reviewId))
		for (const pin of pins)
			await lc.decideSection(lifecycle(), {
				reviewId: review.reviewId,
				sectionId: pin.sectionId,
				decision: 'approved',
				note: null,
				userId: `admin@${PATHWAY_ORG}`,
			})
		const published = await lc.publish(lifecycle(), {
			documentId: PATHWAY_ID,
			userId: `owner@${CENTRAL}`,
			label: null,
			releaseNotes: null,
		})
		const frozen = await sectionsOf(d, published.versionId)
		expect(frozen.find((s) => s.sectionId === P_OWNED)?.titleCitations).toEqual([REF])
		const numbered = await referencesFor(d, frozen)
		// Section 1 (shared) cites REF in its body first; section 2's heading cites it again,
		// then its body cites the new one: 1 then 2.
		expect(numbered.map((r) => [r.id, r.number])).toEqual([
			[REF, 1],
			[cited, 2],
		])
		const own = frozen.find((s) => s.sectionId === P_OWNED)
		expect(own?.markdown).toContain('[^2]')
	})
})

describe('answering suggestions, replies and mentions', () => {
	it('the central team answers a suggestion in its own thread, resolving it, and the drafter is emailed', async () => {
		const suggestion = await lc.addComment(lifecycle(), {
			documentId: PATHWAY_ID,
			sectionId: P_SHARED,
			kind: 'suggestion',
			body: 'Name the lead clinician.',
			userId: `member@${PATHWAY_ORG}`,
		})
		// Only the central team answers suggestions.
		await expect(
			lc.replyToSuggestion(lifecycle(), {
				suggestionId: suggestion.id,
				body: 'No.',
				resolve: false,
				userId: `admin@${PATHWAY_ORG}`,
			}),
		).rejects.toThrow(/central organisation/)
		const before = sentMail.length
		const reply = await lc.replyToSuggestion(lifecycle(), {
			suggestionId: suggestion.id,
			body: 'Added to the next edition of the core.',
			resolve: true,
			userId: `admin@${CENTRAL}`,
		})
		expect(reply?.replyTo).toBe(suggestion.id)
		expect(reply?.sectionId).toBe(P_SHARED)
		// The drafter reads it in their margin: the reply is in the pathway section's thread.
		const thread = await lc.listComments(lifecycle(), PATHWAY_ID, `member@${PATHWAY_ORG}`)
		expect(thread.find((c) => c.id === reply?.id)?.replyTo).toBe(suggestion.id)
		expect(thread.find((c) => c.id === suggestion.id)?.resolvedAt).not.toBeNull()
		const mail = sentMail.slice(before).find((m) => m.to.includes(`member@${PATHWAY_ORG}.test`))
		expect(mail?.subject).toMatch(/resolved/)
		expect(mail?.text).toContain('Added to the next edition of the core.')
		// The central team reads it with its reply.
		const forCore = await lc.suggestionsForCore(lifecycle(), CORE_ID, `admin@${CENTRAL}`)
		expect(forCore.find((s) => s.id === suggestion.id)?.replies.map((r) => r.body)).toEqual([
			'Added to the next edition of the core.',
		])
	})

	it('a reply joins its comment’s thread; a mention emails the people who may read the document', async () => {
		const first = await lc.addComment(lifecycle(), {
			documentId: PATHWAY_ID,
			sectionId: P_OWNED,
			kind: 'comment',
			body: 'Is ECOG right here?',
			userId: `member@${PATHWAY_ORG}`,
		})
		// A reply must answer a comment in the same section.
		await expect(
			lc.addComment(lifecycle(), {
				documentId: PATHWAY_ID,
				sectionId: P_SHARED,
				kind: 'comment',
				body: 'x',
				replyTo: first.id,
				userId: `admin@${PATHWAY_ORG}`,
			}),
		).rejects.toThrow(/thread/)
		const before = sentMail.length
		const reply = await lc.addComment(lifecycle(), {
			documentId: PATHWAY_ID,
			sectionId: P_OWNED,
			kind: 'comment',
			body: 'Yes — @member@org-p see the guideline.',
			replyTo: first.id,
			mentions: [`member@${PATHWAY_ORG}`, 'nobody', `admin@${PATHWAY_ORG}`],
			userId: `admin@${PATHWAY_ORG}`,
		})
		expect(reply.replyTo).toBe(first.id)
		const mentioned = sentMail.slice(before).filter((m) => /mentioned you/.test(m.subject))
		// The drafter is named and may read it; "nobody" may not; the author is never mailed.
		expect(mentioned.flatMap((m) => m.to)).toEqual([`member@${PATHWAY_ORG}.test`])
	})
})
