/**
 * Cloudflare Worker entry — the request front door for the application.
 *
 * The capnweb host, the `/api/ws` upgrade, the `/api/auth/*` proxy to the AUTH
 * service and the TanStack Start fallback all come from
 * `@aicolab/room-service/base-worker`. This file adds only what is specific to
 * this application: the room connector methods, once the section rooms exist.
 *
 * IDENTITY is the server-attested signed-in user: `serveCapnweb` verifies the
 * session cookie once at the same-origin-checked `/api/ws` upgrade and seals the
 * id into `CoreRpcRoot`. The browser never sends an id.
 */

import { serveCapnweb, CoreRpcRoot as WorkerRoot } from '@aicolab/room-service/base-worker'
import handler from '@tanstack/solid-start/server-entry'

// The browser types its capnweb socket against this class (`import type` only).
export type { CoreRpcRoot }

/** Browser-facing RPC root, one per `/api/ws` connection. */
class CoreRpcRoot extends WorkerRoot<Cloudflare.Env> {}

export default {
	async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
		return serveCapnweb({ request, env, ctx, Root: CoreRpcRoot, handler })
	},
} satisfies ExportedHandler<Cloudflare.Env>
