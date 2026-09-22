/**
 * Best-effort live publishing for every write path: this worker is the sole writer to
 * the content database, and each write site calls one of these AFTER its D1 statement
 * commits, publishing committed rows through the bell's worker door (`publishToTopic`:
 * native RPC on the binding, no capnweb session, so rooms, server functions and any
 * future cron publish through the same leg).
 *
 * BEST-EFFORT BY DESIGN: publishes are hints; every topic's snapshot path is
 * correctness. A write never fails, or blocks, because its announcement did. Always
 * publish COMMITTED state (`.returning()` rows), never hopes.
 */

import { publishToTopic } from '@aicolab/room-service/d1-sync'
import {
	documentsTopic,
	documentWireRow,
	sectionsTopic,
	sectionWireRow,
} from '#/lib/live-topics.ts'

type DocumentRow = Parameters<typeof documentWireRow>[0]
type SectionRow = Parameters<typeof sectionWireRow>[0]

type Change = { type: 'insert'; value: Record<string, unknown> } | { type: 'delete'; key: string }

async function publish(topic: string, changes: Change[]): Promise<void> {
	if (changes.length === 0) return
	try {
		// biome-ignore lint/correctness/noUnresolvedImports: provided by the Workers runtime
		const { env } = await import('cloudflare:workers')
		await publishToTopic(env.OCP_BELL, topic, changes)
	} catch (error) {
		console.error(
			`[ocp live] publish to '${topic}' failed (write stands; snapshot is correctness)`,
			error instanceof Error ? error.message : error,
		)
	}
}

/** Announce committed document rows (insert-as-upsert on the wire). */
export function publishDocumentRows(rows: DocumentRow[]): Promise<void> {
	return publish(
		documentsTopic(),
		rows.map((row) => ({ type: 'insert' as const, value: documentWireRow(row) })),
	)
}

/** Announce committed section rows of one document. */
export function publishSectionRows(documentId: string, rows: SectionRow[]): Promise<void> {
	return publish(
		sectionsTopic(documentId),
		rows.map((row) => ({ type: 'insert' as const, value: sectionWireRow(row) })),
	)
}

/** Announce section removals (the wire carries the key only). */
export function publishSectionDeletes(documentId: string, sectionIds: string[]): Promise<void> {
	return publish(
		sectionsTopic(documentId),
		sectionIds.map((key) => ({ type: 'delete' as const, key })),
	)
}
