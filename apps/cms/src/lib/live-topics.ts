/**
 * Reactive-D1 topics: D1 is the sole source of truth, `OcpBell` is data-less fan-out
 * (room-service d1-sync). Every list the interface shows live comes from here.
 *
 *   documents           ONE topic, scoped per session: a member sees the documents of
 *                       their organisations; a member of the central organisation
 *                       sees every document.
 *   sections:{docId}    the outline of one document: every section row WITHOUT its
 *                       body (bodies are opened one at a time through the room).
 *                       Authorised at the door: the root checks membership before
 *                       minting the capability, so within the topic every subscriber
 *                       sees every row.
 *
 * WIRE ROWS are the one shape shared by the snapshot path (querySnapshot) and the
 * increment path (live-publish.ts): one mapper per table, so the two cannot drift.
 * Plain JSON; timestamps as epoch ms.
 *
 * Server-only (imports capnweb via d1-sync); clients import only the wire-row types.
 */

import type { BellCapability, ScopedWriter, WriterScope } from '@aicolab/room-service/d1-sync'
import { D1TopicCapability } from '@aicolab/room-service/d1-sync'
import type { RpcStub } from 'capnweb-experimental-hibernation'
import { eq } from 'drizzle-orm'
import { db, schema } from '#/db/index.ts'
import { OCP_NAMESPACE } from '#/lib/roles.ts'

export const documentsTopic = () => 'documents'
export const sectionsTopic = (documentId: string) => `sections:${documentId}`

type DocumentRow = typeof schema.documents.$inferSelect
type SectionRow = typeof schema.sections.$inferSelect

/** What a topic needs from its hosting root. */
export interface LiveTopicHost {
	connectBell(topic: string, sink?: ScopedWriter): Promise<RpcStub<BellCapability>>
	readonly liveDb: D1Database
	readonly auth: {
		listUserOrgs(userId: string, namespace?: string): Promise<{ organizationId: string }[]>
	}
}

/** Type aliases, not interfaces: the writer scope wants an index signature. */
export type DocumentWireRow = {
	id: string
	kind: DocumentRow['kind']
	templateId: string
	orgId: string
	slug: string
	partnerSlug: string | null
	title: string
	subject: string
	audience: DocumentRow['audience']
	/** The family colour (#rrggbb), or null for the neutral core documents. */
	accent: string | null
	/** Who has the document open (its room's roster, as last announced). */
	present: { id: string; name: string }[]
	createdAt: number
	updatedAt: number | null
}

export function documentWireRow(row: DocumentRow): DocumentWireRow {
	return {
		id: row.id,
		kind: row.kind,
		templateId: row.templateId,
		orgId: row.orgId,
		slug: row.slug,
		partnerSlug: row.partnerSlug,
		title: row.title,
		subject: row.subject,
		audience: row.audience,
		accent: row.accent,
		present: row.present ?? [],
		createdAt: row.createdAt.getTime(),
		updatedAt: row.updatedAt?.getTime() ?? null,
	}
}

/** A section as the outline carries it: everything but the body. */
export type SectionWireRow = {
	id: string
	documentId: string
	parentId: string | null
	address: string
	canonical: boolean
	printedNumber: string | null
	title: string | null
	headingLevel: number | null
	orderIndex: number
	stepNumber: number | null
	ownership: SectionRow['ownership']
	coreSectionId: string | null
	pathwayOwnership: SectionRow['pathwayOwnership']
	apparatus: boolean
	instructions: boolean
	added: boolean
	hidden: boolean
	pointOfCare: boolean
	sourcePages: string | null
	icon: string | null
	titleCitations: string[]
	/** The legacy import's flag on a section whose place the template did not declare. */
	migrationNote: string | null
	updatedAt: number | null
	updatedBy: string | null
}

export function sectionWireRow(row: SectionRow): SectionWireRow {
	return {
		id: row.id,
		documentId: row.documentId,
		parentId: row.parentId,
		address: row.address,
		canonical: row.canonical,
		printedNumber: row.printedNumber,
		title: row.title,
		headingLevel: row.headingLevel,
		orderIndex: row.orderIndex,
		stepNumber: row.stepNumber,
		ownership: row.ownership,
		coreSectionId: row.coreSectionId,
		pathwayOwnership: row.pathwayOwnership,
		apparatus: row.apparatus,
		instructions: row.instructions,
		added: row.added,
		hidden: row.hidden,
		pointOfCare: row.pointOfCare,
		sourcePages: row.sourcePages,
		icon: row.icon,
		titleCitations: row.titleCitations ?? [],
		migrationNote: row.migrationNote,
		updatedAt: row.updatedAt?.getTime() ?? null,
		updatedBy: row.updatedBy,
	}
}

interface DocumentVisibility {
	orgIds: ReadonlySet<string>
	/** A member of the central organisation (the owner of core content) sees everything. */
	central: boolean
}

/** The sealed user's documents. One topic for everyone; the scope is the view. */
export class DocumentsLiveTopic extends D1TopicCapability {
	readonly #host: LiveTopicHost
	readonly #userId: string
	#visibility: DocumentVisibility | null = null

	constructor(host: LiveTopicHost, userId: string) {
		super()
		this.#host = host
		this.#userId = userId
	}

	protected bell(sink?: ScopedWriter): Promise<RpcStub<BellCapability>> {
		return this.#host.connectBell(documentsTopic(), sink)
	}

	/** The view is resolved BEFORE the scope is built (the base subscribes sink-first,
	 *  synchronously reading `scope()`), once per subscription; a membership change is a
	 *  fresh subscription. */
	override async subscribe(writer: Parameters<D1TopicCapability['subscribe']>[0]): Promise<void> {
		const memberships = await this.#host.auth.listUserOrgs(this.#userId, OCP_NAMESPACE)
		const orgIds = new Set(memberships.map((m) => m.organizationId))
		const core = await db(this.#host.liveDb)
			.select({ orgId: schema.documents.orgId })
			.from(schema.documents)
			.where(eq(schema.documents.kind, 'core'))
			.limit(1)
		this.#visibility = { orgIds, central: core[0] ? orgIds.has(core[0].orgId) : false }
		return super.subscribe(writer)
	}

	protected async querySnapshot(): Promise<readonly Record<string, unknown>[]> {
		const rows = await db(this.#host.liveDb).select().from(schema.documents)
		return rows.map(documentWireRow)
	}

	protected scope(): WriterScope<DocumentWireRow> {
		const visibility = this.#visibility
		if (!visibility) throw new Error('[ocp] documents topic scoped before subscribe')
		return {
			keyOf: (row) => row.id,
			visible: (row) => visibility.central || visibility.orgIds.has(row.orgId),
		}
	}
}

/** The outline of one document, for everyone the door let in. */
export class SectionsLiveTopic extends D1TopicCapability {
	readonly #host: LiveTopicHost
	readonly #documentId: string

	constructor(host: LiveTopicHost, documentId: string) {
		super()
		this.#host = host
		this.#documentId = documentId
	}

	protected bell(sink?: ScopedWriter): Promise<RpcStub<BellCapability>> {
		return this.#host.connectBell(sectionsTopic(this.#documentId), sink)
	}

	protected async querySnapshot(): Promise<readonly Record<string, unknown>[]> {
		const rows = await db(this.#host.liveDb)
			.select()
			.from(schema.sections)
			.where(eq(schema.sections.documentId, this.#documentId))
		return rows.map(sectionWireRow)
	}

	protected scope(): WriterScope<SectionWireRow> {
		return { keyOf: (row) => row.id }
	}
}
