/**
 * Cloudflare Worker entry — the request front door for the application.
 *
 * The capnweb host, the `/api/ws` upgrade, the `/api/auth/*` proxy to the AUTH
 * service and the TanStack Start fallback all come from
 * `@aicolab/room-service/base-worker`. The application's own classes live in
 * `lib/rpc-root.ts` (the root and the bell) and `rooms/document-room.ts` (one Durable
 * Object per document); this file only exports them for the runtime.
 *
 * IDENTITY is the server-attested signed-in user: `serveCapnweb` verifies the
 * session cookie once at the same-origin-checked `/api/ws` upgrade and seals the
 * id into `CoreRpcRoot`. The browser never sends an id.
 */

import { serveCapnweb } from '@aicolab/room-service/base-worker'
import handler from '@tanstack/solid-start/server-entry'
import { CoreRpcRoot, OcpBell } from '#/lib/rpc-root.ts'
import { DocumentRoom } from '#/rooms/document-room.ts'

// The browser types its capnweb socket against this class (`import type` only).
export type { CoreRpcRoot }
// Durable Object classes, by the names wrangler.jsonc binds.
export { DocumentRoom, OcpBell }

export default {
	async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
		return serveCapnweb({ request, env, ctx, Root: CoreRpcRoot, handler })
	},
} satisfies ExportedHandler<Cloudflare.Env>
