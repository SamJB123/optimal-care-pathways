/**
 * The step page's live editors over the PRODUCTION client stack, in real workerd — the
 * app's presence and hibernation regression suite (the hive's pm-docs-reopen-storm suite,
 * ported).
 *
 * Stack under test (all production code except socket acquisition):
 *   pathwayClientFor → shared socket (#/ws.ts swapped for a SELF.fetch-backed twin) →
 *   /api/ws (serveCapnweb, sealed identity) → CoreRpcRoot.connectSectionsTopic +
 *   connectDocumentRoom (pinned worker→DO tunnels) → DocumentRoom → per-section facets,
 *   cursor presence, the online roster.
 *
 * Every open/close here is the exact OwnedBody/SectionEditor call sequence. What it pins,
 * from the DO's own point of view: one socket, one 'connected' transition, one online row
 * with one connection, one facet per open section, an editor tier for a member, no
 * persistence failure; the same after ten leave-and-return cycles; and the same after a
 * DO eviction under the live page followed by a re-seal, on a fresh room and on a room
 * with history.
 *
 * History matters because of what this suite caught (2026-09-22): capnweb kept a replay
 * record for every body open after the client had released the facet it was made on;
 * the next wake threw restoring one, abandoned the half-restored session without aborting
 * it, and the `joinOnline` it had already replayed leaked a second presence member.
 * Patched in capnweb (patches/capnweb-experimental-hibernation@…). The "after ten
 * mount/leave cycles" variant is that reproduction.
 */

// biome-ignore lint/correctness/noUnresolvedImports: provided by the vitest workers pool
import { env, evictDurableObject, runInDurableObject } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { JsonNode } from '#/content/schema.ts'
import { db, schema } from '#/db/index.ts'
import { type PathwayClient, pathwayClientFor } from '#/lib/ocp-client.ts'
import { dialled, provisionBrowserSockets, sharedSocket } from '../../test/ws-test-socket.ts'
import { type DocumentRoom, documentRoomName } from './document-room.ts'

vi.mock('#/ws.ts', () => import('../../test/ws-test-socket.ts'))

const ORG = 'org-a'
const MEMBER = `member@${ORG}`

const emptyDoc: JsonNode = { type: 'doc', content: [] }
const bodyFor = (address: string): JsonNode => ({
	type: 'doc',
	content: [{ type: 'paragraph', content: [{ type: 'text', text: `Body ${address}` }] }],
})

interface Seeded {
	documentId: string
	owned: { id: string; address: string }[]
}

/** One pathway with a step and three owned sections, in its own room. */
async function seedDocument(label: string): Promise<Seeded> {
	const documentId = `doc-${crypto.randomUUID()}`
	const owned = ['2.1', '2.2', '2.3'].map((address) => ({
		id: `sec-${crypto.randomUUID()}`,
		address,
	}))
	const d = db(env.DB)
	await d
		.insert(schema.templates)
		.values({ id: 'cancer-test', kind: 'cancer', label: 'test', sourceFile: 'test.pdf' })
		.onConflictDoNothing()
	await d.insert(schema.documents).values({
		id: documentId,
		kind: 'pathway',
		templateId: 'cancer-test',
		orgId: ORG,
		slug: `storm-${label}-${documentId}`,
		title: `Storm pathway (${label})`,
		subject: 'Test cancer',
		audience: 'cancer',
	})
	await d.insert(schema.sections).values([
		{
			id: `sec-${crypto.randomUUID()}`,
			documentId,
			address: '2',
			canonical: true,
			title: 'Step 2',
			orderIndex: 0,
			ownership: 'owned',
			bodyJson: emptyDoc,
		},
		...owned.map((s, index) => ({
			id: s.id,
			documentId,
			address: s.address,
			canonical: true,
			title: `Section ${s.address}`,
			orderIndex: index + 1,
			ownership: 'owned' as const,
			bodyJson: bodyFor(s.address),
		})),
	])
	return { documentId, owned }
}

const roomOf = (doc: Seeded) =>
	env.DOCUMENT_ROOM.get(env.DOCUMENT_ROOM.idFromName(documentRoomName(doc.documentId)))

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function eventually(assertion: () => void | Promise<void>, timeoutMs = 5_000): Promise<void> {
	const deadline = Date.now() + timeoutMs
	let lastError: unknown
	while (Date.now() < deadline) {
		try {
			await assertion()
			return
		} catch (error) {
			lastError = error
			await sleep(20)
		}
	}
	throw lastError
}

/** The DO's own view: registered facets per section, the online rows, live members, sockets. */
async function serverView(doc: Seeded) {
	return runInDurableObject(roomOf(doc), async (instance: DocumentRoom, state) => {
		await instance.ready
		return {
			facets: Object.fromEntries(
				doc.owned.map((s) => [s.address, instance.facets.facetsFor(s.id).length]),
			),
			online: [...instance.collections.online.values()].map((row) => ({
				userId: row.userId,
				connections: row.connections,
				place: row.place,
			})),
			members: [...instance.online.caps()].length,
			sockets: state.getWebSockets('capnweb').length,
		}
	})
}

const oneMember = [{ userId: MEMBER, connections: 1, place: null }]
const allOpen = { '2.1': 1, '2.2': 1, '2.3': 1 }
const allClosed = { '2.1': 0, '2.2': 0, '2.3': 0 }

/** What OwnedBody + SectionEditor do when a section mounts on the step page. */
function mountLikeThePage(client: PathwayClient, sectionId: string, withBody = true) {
	const handle = client.room.openDoc(sectionId)
	const roles: string[] = []
	const offRole = handle.onRole((tier) => roles.push(tier))
	const body = withBody ? handle.openBody() : null
	return {
		handle,
		body,
		roles,
		async ready() {
			await handle.ready
			if (body) await body.whenReady
		},
		/** What the page does when the section view unmounts. */
		leave() {
			offRole()
			client.room.setCursor(`doc:${sectionId}`, null)
			body?.close()
			handle.close()
		},
	}
}

const fatal: string[] = []
const originalError = console.error
let page: Seeded

beforeAll(async () => {
	page = await seedDocument('page')
	console.error = (...args: unknown[]) => {
		const line = args.map(String).join(' ')
		if (line.includes('[FATAL]')) fatal.push(line)
		originalError(...args)
	}
})

afterEach(() => {
	fatal.length = 0
})

describe('step page over the production client (real workerd)', () => {
	it('one page load: one socket, one online row, one facet per section, an editor tier, no persistence failure', async () => {
		await provisionBrowserSockets(MEMBER, 1)
		const client = pathwayClientFor(page.documentId)
		const statuses: string[] = []
		const offStatus = client.room.subscribeStatus(() => statuses.push(client.room.status()))
		try {
			await eventually(() => expect(client.ready()).toBe(true))
			expect([...client.sections.values()].map((s) => s.address).sort()).toEqual(
				['2', ...page.owned.map((s) => s.address)].sort(),
			)

			const mounted = page.owned.map((s) => mountLikeThePage(client, s.id))
			await Promise.all(mounted.map((m) => m.ready()))
			await sleep(500)

			const view = await serverView(page)
			expect(fatal).toEqual([])
			expect(mounted.map((m) => m.handle.role())).toEqual(['editor', 'editor', 'editor'])
			expect(view.facets).toEqual(allOpen)
			expect(view.online).toEqual(oneMember)
			expect(view.members).toBe(1)
			expect(view.sockets).toBe(1)
			expect(dialled.length).toBe(1)
			expect(statuses).toEqual(['connected'])

			// Sit on the page: nothing may rejoin, re-insert or flip while it is idle.
			await sleep(3_000)
			expect(fatal).toEqual([])
			expect(statuses).toEqual(['connected'])
			expect(await serverView(page)).toEqual(view)

			for (const m of mounted) m.leave()
			await sleep(500)
			const left = await serverView(page)
			expect(left.facets).toEqual(allClosed)
			expect(left.online).toEqual(oneMember)
		} finally {
			offStatus()
		}
	}, 30_000)

	it('ten mount/ready/leave cycles leave no stray facet and one connection', async () => {
		const client = pathwayClientFor(page.documentId)
		for (let cycle = 1; cycle <= 10; cycle += 1) {
			const mounted = page.owned.map((s) => mountLikeThePage(client, s.id))
			await Promise.all(mounted.map((m) => m.ready()))
			for (const m of mounted) m.leave()
		}
		await sleep(500)
		const view = await serverView(page)
		expect(fatal).toEqual([])
		expect(view.facets).toEqual(allClosed)
		expect(view.online).toEqual(oneMember)
		expect(dialled.length).toBe(1)
	}, 30_000)

	// The production eviction path (hibernatable sockets kept), then the browser socket
	// closes and redials. Each variant runs on its OWN room so nothing leaks between
	// them: what the session carries when the wake replays it is the only difference.
	// A handle without a body never opens its facet (the kit opens the facet lazily,
	// on the first body/attribution/method request), so "facets without bodies" is not
	// a page shape; the page always opens the body. The HISTORY variants are the page's
	// real life: a load, ten leave-and-return cycles, then the eviction.
	for (const variant of [
		{ label: 'facets with body streams', handles: true, cycles: 0, cycleBodies: true },
		{ label: 'nothing open', handles: false, cycles: 0, cycleBodies: true },
		{ label: 'after ten mount/leave cycles', handles: true, cycles: 10, cycleBodies: true },
		{
			label: 'after ten facet-only cycles (no bodies)',
			handles: true,
			cycles: 10,
			cycleBodies: false,
		},
	]) {
		it(`DO eviction under the live page, then a re-seal (${variant.label}): one member, one connection`, async () => {
			const doc = await seedDocument(variant.label.replace(/\W+/g, '-'))
			const client = pathwayClientFor(doc.documentId)
			const transitions: string[] = []
			const offStatus = client.room.session.onStatus((s) => transitions.push(s))
			for (let cycle = 0; cycle < variant.cycles; cycle += 1) {
				const cycled = doc.owned.map((s) => mountLikeThePage(client, s.id, variant.cycleBodies))
				// A facet-only cycle opens the facet through availableMethods() (the kit
				// opens facets lazily on the first body/attribution/method request).
				if (!variant.cycleBodies) await Promise.all(cycled.map((m) => m.handle.availableMethods()))
				await Promise.all(cycled.map((m) => m.ready()))
				for (const m of cycled) m.leave()
				await sleep(150)
			}
			const mounted = variant.handles ? doc.owned.map((s) => mountLikeThePage(client, s.id)) : []
			await Promise.all(mounted.map((m) => m.ready()))
			await eventually(async () => expect((await serverView(doc)).online).toEqual(oneMember))
			await sleep(300)
			transitions.length = 0
			// room-service's own suites yield a tick before evicting (their `hibernate`
			// helper); mirror that so the comparison is like for like.
			await sleep(0)
			await evictDurableObject(roomOf(doc))
			sharedSocket.close()
			await provisionBrowserSockets(MEMBER, 1)
			await sharedSocket.ensure()
			try {
				await eventually(async () => {
					const view = await serverView(doc)
					expect(view.facets).toEqual(variant.handles ? allOpen : allClosed)
					expect(view.online.map((row) => row.userId)).toEqual([MEMBER])
					expect(view.sockets).toBe(1)
				}, 10_000)
				await sleep(3_000)
				const settled = await serverView(doc)
				expect(fatal).toEqual([])
				expect(
					{ transitions, connections: settled.online[0]?.connections, members: settled.members },
					variant.label,
				).toEqual({ transitions: ['lost', 'connecting', 'live'], connections: 1, members: 1 })
			} finally {
				offStatus()
				for (const m of mounted) m.leave()
			}
		}, 30_000)
	}

	it('a stale online row on disk in a fresh incarnation is reconciled away before the first join', async () => {
		const doc = await seedDocument('stale')
		const client = pathwayClientFor(doc.documentId)
		await runInDurableObject(roomOf(doc), async (_instance, state) => {
			state.storage.sql.exec(
				'INSERT OR REPLACE INTO `online` (`user_id`, `place`, `connections`) VALUES (?, NULL, 1)',
				MEMBER,
			)
		})
		await evictDurableObject(roomOf(doc), { webSockets: 'close' })
		const mounted = doc.owned.map((s) => mountLikeThePage(client, s.id))
		await Promise.all(mounted.map((m) => m.ready()))
		await eventually(async () => {
			expect((await serverView(doc)).online).toEqual(oneMember)
		}, 10_000)
		await sleep(2_000)
		expect(fatal).toEqual([])
		for (const m of mounted) m.leave()
	}, 30_000)
})
