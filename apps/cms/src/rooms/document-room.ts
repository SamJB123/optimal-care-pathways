/**
 * DocumentRoom — one Durable Object per document (a pathway or a core document),
 * hosting one live body per section. The app-kit DocRoom template supplies the
 * mechanism (collections, row-coupled yjs bodies, tiered facets, presence); this class
 * supplies the policy and the bridge to D1.
 *
 * D1 IS THE TRUTH. A section's resting body is `sections.body_json`. This room:
 *   - materialises a section on first open from its D1 row (`materializeDoc`), so a
 *     brand-new room, a purged one or a migrated one rebuilds itself from D1;
 *   - folds every debounced body change back into the D1 row (`onBodyChanged`) and
 *     announces it on the document's sections topic;
 *   - yields to the row when it moved behind the room's back: a fold that finds the
 *     row's `updated_at` later than the last body time this room wrote or hydrated
 *     re-hydrates the live doc FROM the row instead of writing over it (a reseed, a
 *     migration, an admin door — anything that writes D1 without the room). Every open
 *     of a section the room already holds folds first (`onDocOpened`), so an editor
 *     never opens a live body the row has since replaced;
 *   - never creates sections: the outline (D1) does, through the worker's doors.
 *
 * ROLES come from the auth worker live, keyed by the document's organisation: a
 * viewer reads, a drafter or above edits. Nothing durable about roles lives here.
 */

import { DocRoom, type DocRow, type DocTier, type UserProfiles } from '@aicolab/app-kit/doc-room'
import { and, eq } from 'drizzle-orm'
import { publishableHash, publishAsFor } from '#/content/publish.ts'
import { emptyBody, type JsonNode } from '#/content/schema.ts'
import { bodyFromRoot, hydrateRoot, replaceRoot } from '#/content/yjs.ts'
import { db, schema } from '#/db/index.ts'
import { publishSectionRows } from '#/lib/live-publish.ts'
import { type Role, tierForRole } from '#/lib/roles.ts'
import { documentRoleOf } from '#/server/access.ts'

const ROOM_PREFIX = 'document:'

export const documentRoomName = (documentId: string) => `${ROOM_PREFIX}${documentId}`

/** What the room needs of its document: who works on it, and how its bodies publish. */
interface HostedDocument {
	orgId: string
	subject: string
	kind: 'core' | 'pathway'
}

export class DocumentRoom extends DocRoom {
	#documentId: string | null = null
	#document: Promise<HostedDocument> | null = null

	/** The document this room hosts, from the room's own name. */
	documentId(): string {
		if (this.#documentId) return this.#documentId
		const name = this.ctx.id.name
		if (!name?.startsWith(ROOM_PREFIX))
			throw new Error(`[document-room] unexpected room name: ${name ?? '<unnamed>'}`)
		this.#documentId = name.slice(ROOM_PREFIX.length)
		return this.#documentId
	}

	/** The document this room hosts: its organisation, subject and kind. Memoised: none of
	 *  them changes under a live room (a finalised import's organisation is set before any
	 *  member can open it). */
	#hosted(): Promise<HostedDocument> {
		this.#document ??= (async () => {
			const row = (
				await db(this.env.DB)
					.select({
						orgId: schema.documents.orgId,
						subject: schema.documents.subject,
						kind: schema.documents.kind,
					})
					.from(schema.documents)
					.where(eq(schema.documents.id, this.documentId()))
					.limit(1)
			)[0]
			if (!row) throw new Error('[document-room] document not found')
			return row
		})()
		return this.#document
	}

	/** The one access rule (access.ts): the user's role on this document's organisation,
	 *  else a reviewer when they belong to the central organisation. */
	async roleFor(userId: string): Promise<Role | null> {
		return documentRoleOf(this.env.AUTH, db(this.env.DB), userId, (await this.#hosted()).orgId)
	}

	// ---- the seams ----------------------------------------------------------

	async tierFor(userId: string): Promise<DocTier | null> {
		return tierForRole(await this.roleFor(userId))
	}

	async profilesFor(userIds: string[]): Promise<UserProfiles> {
		return this.env.AUTH.getUsersByIds(userIds)
	}

	/** Renaming a section is an outline action (D1), never a room action. */
	protected override async canManageDoc(): Promise<boolean> {
		return false
	}

	/** Sections are created by the outline, in D1, never by the room. */
	override async addDoc(): Promise<string> {
		throw new Error('sections are created from the outline')
	}

	/** First open of a section in this room: its D1 row becomes the room's doc row and
	 *  its resting body becomes the live yjs doc. Only an OWNED section has a body here;
	 *  a shared section renders the core document's published body and is never live. */
	override async materializeDoc(sectionId: string): Promise<DocRow | null> {
		const row = (
			await db(this.env.DB)
				.select()
				.from(schema.sections)
				.where(
					and(eq(schema.sections.id, sectionId), eq(schema.sections.documentId, this.documentId())),
				)
				.limit(1)
		)[0]
		if (row?.ownership !== 'owned') return null
		const inserted = await this.insertDoc({
			id: row.id,
			title: row.title ?? row.address,
			authorId: row.updatedBy ?? 'template',
			authorName: '',
			preview: '',
			createdAt: Date.now(),
			bodyUpdatedAt: 0,
		})
		await this.hydrateBody(row.id, (root) => hydrateRoot(root, row.bodyJson ?? emptyBody()))
		await this.#rememberRowClock(row.id, row.updatedAt)
		return inserted
	}

	/** A section the room already holds is opened: reconcile with its row first, so a
	 *  row rewritten behind the room (a reseed) is what the editor opens. */
	override async onDocOpened(sectionId: string): Promise<void> {
		await this.#fold(sectionId, Date.now())
	}

	/**
	 * The row's `updated_at` as this room last saw it — after hydrating from the row or
	 * writing it. A fold that finds the row at any OTHER time knows D1 moved without the
	 * room (a reseed, a migration, an admin door) and yields to it. Kept in the room's own
	 * storage, beside the collections, so it survives eviction with the live body.
	 */
	#rowClockKey(sectionId: string): string {
		return `row-clock:${sectionId}`
	}

	async #rowClock(sectionId: string): Promise<number | null> {
		return (await this.ctx.storage.get<number>(this.#rowClockKey(sectionId))) ?? null
	}

	async #rememberRowClock(sectionId: string, at: Date | number | null | undefined): Promise<void> {
		const ms = at instanceof Date ? at.getTime() : (at ?? 0)
		await this.ctx.storage.put(this.#rowClockKey(sectionId), ms)
	}

	/** The fold: the live body, as JSON, into the section's D1 row; then the announcement. */
	protected override async onBodyChanged(row: DocRow): Promise<void> {
		await this.foldSection(row.id, row.bodyUpdatedAt || Date.now())
	}

	/**
	 * Write the live body into the row ONLY when its JSON differs from what the row holds.
	 * A body is "touched" without changing — the editor's binding on mount, a snapshot's
	 * pre-fold, a reconnect's re-handshake — and none of those is an edit. The row's
	 * `updated_at` is the section's per-section last-updated, which the published API
	 * serves and Cancer Council keys its display on, so it moves only on content.
	 */
	async #fold(sectionId: string, at: number): Promise<JsonNode> {
		const body = await this.readBody(sectionId, (root) => bodyFromRoot(root))
		const where = and(
			eq(schema.sections.id, sectionId),
			eq(schema.sections.documentId, this.documentId()),
		)
		const current = (
			await db(this.env.DB)
				.select({ bodyJson: schema.sections.bodyJson, updatedAt: schema.sections.updatedAt })
				.from(schema.sections)
				.where(where)
				.limit(1)
		)[0]
		if (!current) return body
		const rowAt = current.updatedAt?.getTime() ?? 0
		const known = await this.#rowClock(sectionId)
		if (JSON.stringify(current.bodyJson) === JSON.stringify(body)) {
			if (known !== rowAt) await this.#rememberRowClock(sectionId, rowAt)
			return body
		}
		// The row is not at the time this room last saw it (or the room never noted one,
		// for a body materialised before this rule): D1 moved without the room, and D1 is
		// the truth. The live doc takes the row's body; the projection this causes folds
		// again, finds the bodies equal, and writes nothing.
		if (known === null || rowAt !== known) {
			const resting = current.bodyJson ?? emptyBody()
			await this.hydrateBody(sectionId, (root) => replaceRoot(root, resting))
			await this.#rememberRowClock(sectionId, rowAt)
			return this.readBody(sectionId, (root) => bodyFromRoot(root))
		}
		const hosted = await this.#hosted()
		const updated = await db(this.env.DB)
			.update(schema.sections)
			.set({
				bodyJson: body,
				draftHash: await publishableHash(body, hosted.subject, publishAsFor(hosted.kind)),
				updatedAt: new Date(at),
			})
			.where(where)
			.returning()
		await this.#rememberRowClock(sectionId, updated[0]?.updatedAt ?? at)
		if (updated.length > 0) void publishSectionRows(this.documentId(), updated)
		return body
	}

	// ---- native workerd-RPC doors (`await this.ready` is load-bearing) --------------------

	/** Fold one section's live body into D1 NOW, ahead of the debounce, and return it.
	 *  A snapshot (review, publish) calls this so it reads the body as it is, not as it
	 *  was a few seconds ago. A section the room has never opened is returned from D1. */
	async foldSection(sectionId: string, at = Date.now()): Promise<JsonNode | null> {
		await this.ready
		if (!this.collections.docs.has(sectionId)) {
			const row = (
				await db(this.env.DB)
					.select({ bodyJson: schema.sections.bodyJson })
					.from(schema.sections)
					.where(
						and(
							eq(schema.sections.id, sectionId),
							eq(schema.sections.documentId, this.documentId()),
						),
					)
					.limit(1)
			)[0]
			return row?.bodyJson ?? null
		}
		return this.#fold(sectionId, at)
	}

	/** Fold every section this room has live. Returns how many. */
	async foldAll(): Promise<number> {
		await this.ready
		const ids = this.collections.docs.toArray.map((row) => row.id)
		for (const id of ids) await this.#fold(id, Date.now())
		return ids.length
	}
}

export type { DocRoomCapability } from '@aicolab/app-kit/doc-room'
