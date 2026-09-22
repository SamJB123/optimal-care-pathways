/**
 * DocumentRoom in the real runtime (a Durable Object over the test D1):
 *   - membership gates every open; the role sets the tier;
 *   - a section is materialised from its D1 row on first open, and reads back the same
 *     body (hydration fidelity);
 *   - a shared section is never live;
 *   - a live edit through a client synced doc folds back into D1 after the debounce.
 */

// biome-ignore lint/correctness/noUnresolvedImports: provided by the vitest workers pool
import { env, runInDurableObject } from 'cloudflare:test'
import type {
	DocFacetCb,
	DocPresenceEntry,
	DocTier,
	DocViewerFacet,
} from '@aicolab/app-kit/doc-room'
import type { DocSink, UpdateSink } from '@aicolab/room-service/doc-sync'
import { createSyncedDoc } from '@aicolab/room-service/doc-sync/client'
import { RpcStub, RpcTarget } from 'capnweb-experimental-hibernation'
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { type JsonNode, parseBody } from '#/content/schema.ts'
import { bodyFromRoot, hydrateRoot } from '#/content/yjs.ts'
import { db, schema } from '#/db/index.ts'
import { type DocumentRoom, documentRoomName } from './document-room.ts'

const ORG = 'org-a'
const DOCUMENT_ID = `doc-${crypto.randomUUID()}`
const OWNED_ID = `sec-${crypto.randomUUID()}`
const SHARED_ID = `sec-${crypto.randomUUID()}`

const body: JsonNode = {
	type: 'doc',
	content: [
		{ type: 'banner', content: [{ type: 'text', text: 'Signs and symptoms' }] },
		{
			type: 'guidance',
			content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Complete the timeframe' }] }],
		},
		{
			type: 'timeframe',
			content: [
				{ type: 'carePoint', content: [{ type: 'text', text: 'Timeframe for treatment' }] },
				{
					type: 'paragraph',
					content: [
						{ type: 'text', text: 'Treatment should start within ' },
						{
							type: 'text',
							text: '[timeframe]',
							marks: [{ type: 'placeholder', attrs: { label: '[timeframe]' } }],
						},
						{ type: 'citation', attrs: { referenceId: 'ref-7' } },
					],
				},
			],
		},
		{
			type: 'list',
			attrs: { kind: 'check', pointOfCare: true },
			content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Refer promptly' }] }],
		},
	],
}

const room = () =>
	env.DOCUMENT_ROOM.get(env.DOCUMENT_ROOM.idFromName(documentRoomName(DOCUMENT_ID)))

const makeFacetCb = () => {
	const tiers: DocTier[] = []
	class Cb extends RpcTarget implements DocFacetCb {
		onRoleChanged(tier: DocTier): void {
			tiers.push(tier)
		}
		onDocPresence(_entries: DocPresenceEntry[]): void {}
	}
	return { stub: new RpcStub<DocFacetCb>(new Cb()), tiers }
}

const makeClientSink = () => {
	const synced = createSyncedDoc({ id: `document-room-test:${crypto.randomUUID()}` })
	class TestSink extends RpcTarget implements DocSink {
		push(update: Uint8Array): void {
			synced.sink.push(update)
		}
		sv(): Uint8Array | Promise<Uint8Array> {
			return synced.sink.sv()
		}
	}
	return { stub: new RpcStub<DocSink>(new TestSink()), synced }
}

async function subscribeBody(facet: DocViewerFacet, sink: ReturnType<typeof makeClientSink>) {
	const stream = await facet.body(sink.stub)
	const writer = stream.writer === null ? null : new RpcStub<UpdateSink>(stream.writer)
	await sink.synced.attach(writer, stream.serverSV)
	return stream.subscription
}

const storedRow = async (sectionId: string) =>
	(
		await db(env.DB)
			.select({ bodyJson: schema.sections.bodyJson, updatedAt: schema.sections.updatedAt })
			.from(schema.sections)
			.where(eq(schema.sections.id, sectionId))
	)[0] ?? null

const storedBody = async (sectionId: string) => (await storedRow(sectionId))?.bodyJson ?? null

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const plain = (node: JsonNode): string => node.text ?? (node.content ?? []).map(plain).join('')

beforeAll(async () => {
	const d = db(env.DB)
	await d
		.insert(schema.templates)
		.values({ id: 'cancer-test', kind: 'cancer', label: 'test', sourceFile: 'test.pdf' })
		.onConflictDoNothing()
	await d.insert(schema.documents).values({
		id: DOCUMENT_ID,
		kind: 'pathway',
		templateId: 'cancer-test',
		orgId: ORG,
		slug: `test-${DOCUMENT_ID}`,
		title: 'Test pathway',
		subject: 'Test cancer',
		audience: 'cancer',
	})
	await d.insert(schema.sections).values([
		{
			id: OWNED_ID,
			documentId: DOCUMENT_ID,
			address: '2.1',
			canonical: true,
			title: 'Signs and symptoms',
			orderIndex: 0,
			ownership: 'owned',
			bodyJson: body,
		},
		{
			id: SHARED_ID,
			documentId: DOCUMENT_ID,
			address: '1',
			canonical: true,
			title: 'Prevention',
			orderIndex: 1,
			ownership: 'shared',
			coreSectionId: 'core-1',
		},
	])
})

describe('DocumentRoom (workerd, real DO over D1)', () => {
	it('refuses a non-member and tiers members by role', async () => {
		await runInDurableObject(room(), async (instance: DocumentRoom) => {
			await instance.ready
			await expect(
				instance.createCapability('nobody').openDoc({ docId: OWNED_ID }, makeFacetCb().stub),
			).rejects.toThrow(/not a member/)
			await expect(
				instance
					.createCapability(`member@other-org`)
					.openDoc({ docId: OWNED_ID }, makeFacetCb().stub),
			).rejects.toThrow(/not a member/)
			const viewer = await instance
				.createCapability(`viewer@${ORG}`)
				.openDoc({ docId: OWNED_ID }, makeFacetCb().stub)
			expect(viewer.role()).toBe('viewer')
			const drafter = await instance
				.createCapability(`member@${ORG}`)
				.openDoc({ docId: OWNED_ID }, makeFacetCb().stub)
			expect(drafter.role()).toBe('editor')
		})
	})

	it('materialises the section from D1 and reads back the same body', async () => {
		await runInDurableObject(room(), async (instance: DocumentRoom) => {
			await instance.ready
			expect((await instance.listDocs()).map((row) => row.id)).toContain(OWNED_ID)
			const folded = await instance.foldSection(OWNED_ID)
			expect(folded).toEqual(parseBody(body).toJSON())
		})
	})

	it('a fold that changes nothing leaves the row alone: last-updated moves only on content', async () => {
		await runInDurableObject(room(), async (instance: DocumentRoom) => {
			await instance.ready
			// The first fold may normalise the seeded JSON into ProseMirror's own shape.
			await instance.foldSection(OWNED_ID)
			const settled = await storedRow(OWNED_ID)
			await sleep(20)
			// The body was touched (folded again) but not changed: no write, same timestamp.
			await instance.foldSection(OWNED_ID, Date.now())
			expect(await storedRow(OWNED_ID)).toEqual(settled)
			// A live open and a subscribe touch the body too — the editor's binding on mount.
			const facet = await instance
				.createCapability(`member@${ORG}`)
				.openDoc({ docId: OWNED_ID }, makeFacetCb().stub)
			const client = makeClientSink()
			const subscription = await subscribeBody(facet, client)
			await sleep(800) // well past the 300 ms projection debounce
			expect(await storedRow(OWNED_ID)).toEqual(settled)
			subscription[Symbol.dispose]()
			facet[Symbol.dispose]()
		})
	})

	it('never makes a shared section live', async () => {
		await runInDurableObject(room(), async (instance: DocumentRoom) => {
			await instance.ready
			await expect(
				instance
					.createCapability(`member@${ORG}`)
					.openDoc({ docId: SHARED_ID }, makeFacetCb().stub),
			).rejects.toThrow(/doc not found/)
			expect((await instance.listDocs()).map((row) => row.id)).not.toContain(SHARED_ID)
		})
	})

	it('folds a live edit back into D1', async () => {
		await runInDurableObject(room(), async (instance: DocumentRoom) => {
			await instance.ready
			const facet = await instance
				.createCapability(`member@${ORG}`)
				.openDoc({ docId: OWNED_ID }, makeFacetCb().stub)
			const client = makeClientSink()
			await subscribeBody(facet, client)
			// A client-side edit: a paragraph inserted at the top of the body.
			client.synced.doc.transact(() => {
				hydrateRoot(client.synced.doc.get(''), {
					type: 'doc',
					content: [
						{ type: 'paragraph', content: [{ type: 'text', text: 'Appended by the test' }] },
					],
				})
			})
			// The projection debounce is 300 ms; the fold follows it.
			const deadline = Date.now() + 5000
			let stored: JsonNode | null = null
			while (Date.now() < deadline) {
				stored = await storedBody(OWNED_ID)
				if (stored && plain(stored).includes('Appended by the test')) break
				await new Promise((resolve) => setTimeout(resolve, 100))
			}
			expect(stored && plain(stored)).toContain('Appended by the test')
			expect(stored && plain(stored)).toContain('Refer promptly')
			expect(stored?.content?.[0]?.type).toBe('paragraph')
		})
	})

	it('a row rewritten behind the room (a reseed) wins: the live doc re-hydrates from it', async () => {
		const reseeded: JsonNode = {
			type: 'doc',
			content: [
				{
					type: 'box',
					attrs: { kind: 'callout', icon: '', family: 'info' },
					content: [
						{ type: 'paragraph', content: [{ type: 'text', text: 'Reseeded by the test' }] },
					],
				},
			],
		}
		await sleep(20)
		await db(env.DB)
			.update(schema.sections)
			.set({ bodyJson: reseeded, updatedAt: new Date() })
			.where(eq(schema.sections.id, OWNED_ID))
		await runInDurableObject(room(), async (instance: DocumentRoom) => {
			await instance.ready
			// The fold finds the row newer than anything this room wrote: it yields.
			const normalised = parseBody(reseeded).toJSON()
			const folded = await instance.foldSection(OWNED_ID)
			expect(folded).toEqual(normalised)
			const storedNow = await storedBody(OWNED_ID)
			expect(storedNow && parseBody(storedNow).toJSON()).toEqual(normalised)
			// A fresh open reads the reseeded body, not the edit the room used to hold.
			const facet = await instance
				.createCapability(`member@${ORG}`)
				.openDoc({ docId: OWNED_ID }, makeFacetCb().stub)
			const client = makeClientSink()
			const subscription = await subscribeBody(facet, client)
			await sleep(800)
			const live = plain(parseBody(await instance.foldSection(OWNED_ID)).toJSON() as JsonNode)
			expect(live).toContain('Reseeded by the test')
			expect(live).not.toContain('Appended by the test')
			const storedAfter = await storedBody(OWNED_ID)
			expect(storedAfter && parseBody(storedAfter).toJSON()).toEqual(normalised)
			subscription[Symbol.dispose]()
			facet[Symbol.dispose]()
		})
	})

	it('opening a section the room holds reconciles it with a row rewritten since (no fold in between)', async () => {
		const reseeded: JsonNode = {
			type: 'doc',
			content: [
				{ type: 'paragraph', content: [{ type: 'text', text: 'Reseeded again by the test' }] },
			],
		}
		await sleep(20)
		await db(env.DB)
			.update(schema.sections)
			.set({ bodyJson: reseeded, updatedAt: new Date() })
			.where(eq(schema.sections.id, OWNED_ID))
		await runInDurableObject(room(), async (instance: DocumentRoom) => {
			await instance.ready
			// No fold, no edit: the open alone must bring the live body to the row's.
			const facet = await instance
				.createCapability(`member@${ORG}`)
				.openDoc({ docId: OWNED_ID }, makeFacetCb().stub)
			const client = makeClientSink()
			const subscription = await subscribeBody(facet, client)
			await sleep(800)
			const live = plain(bodyFromRoot(client.synced.doc.get('')))
			expect(live).toContain('Reseeded again by the test')
			expect(live).not.toContain('Reseeded by the test')
			// The row was the truth; the open wrote nothing over it.
			const stored = await storedBody(OWNED_ID)
			expect(stored && parseBody(stored).toJSON()).toEqual(parseBody(reseeded).toJSON())
			subscription[Symbol.dispose]()
			facet[Symbol.dispose]()
		})
	})
})
