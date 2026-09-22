import { createRouter as createTanStackRouter } from '@tanstack/solid-router'
import { routeTree } from './routeTree.gen.ts'

export function getRouter() {
	return createTanStackRouter({
		routeTree,
		scrollRestoration: true,
		defaultPreload: 'intent',
		defaultPreloadStaleTime: 0,
	})
}

// The worker injects per-request server context via `handler.fetch(request,
// { context })`. Both `Register` interfaces must carry the same shape: the
// router's drives the injection call site, Start's drives server-fn middleware.
type RequestContext = {
	/** Server-verified user id, present for requests over the authenticated tunnel. */
	userId?: string
	/** True when the request arrived over the session-verified WebSocket tunnel. */
	viaWsTunnel?: boolean
}

declare module '@tanstack/solid-router' {
	interface Register {
		router: ReturnType<typeof getRouter>
		server: { requestContext: RequestContext }
	}
}

declare module '@tanstack/solid-start' {
	interface Register {
		server: { requestContext: RequestContext }
	}
}
