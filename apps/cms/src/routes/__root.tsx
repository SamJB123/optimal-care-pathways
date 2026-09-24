// Root route — the HTML shell, the header, and the auth-driven socket singleton.
//
// TanStack Start + Solid 2 shell contract (get it wrong and the page renders but
// never hydrates): `shellComponent` renders <html> directly; route output goes in
// `{props.children}` wrapped in <Loading>; the stylesheet is a static <link>.

import {
	type AuthSession,
	resolveAuthSession,
} from '@aicolab/better-auth/cloudflare/shared/auth-session'
import { ToastHost, themeBootScript } from '@aicolab/ui-solid'
import { Loading } from '@solidjs/web'
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/solid-router'
import { createIsomorphicFn } from '@tanstack/solid-start'
import { getRequest } from '@tanstack/solid-start/server'
import type { ParentProps } from 'solid-js'
import { RouteError } from '#/components/RouteError.tsx'
import { paletteStyle } from '#/lib/palette.ts'
import { startAuthDrivenSocket } from '#/ws.ts'
// biome-ignore lint/correctness/noUnresolvedImports: Vite's ?url import has a default export at build time
import appCss from '../styles.css?url'

if (typeof window !== 'undefined') {
	startAuthDrivenSocket()
}

/** The session for SSR, loaded once at the root so every route renders its real
 *  auth state server-side. Client navigations follow the live better-auth atom. */
const preloadAuthSession = createIsomorphicFn()
	.server(async (): Promise<AuthSession | null> => {
		const cookieHeader = getRequest().headers.get('cookie') ?? ''
		// biome-ignore lint/correctness/noUnresolvedImports: provided by the Workers runtime
		const { env } = await import('cloudflare:workers')
		return resolveAuthSession({ auth: env.AUTH, cookieHeader })
	})
	.client(() => null)

export const Route = createRootRoute({
	loader: async () => ({ authSession: await preloadAuthSession() }),
	shellComponent: RootDocument,
	component: () => <Outlet />,
	errorComponent: RouteError,
})

function RootDocument(props: ParentProps) {
	return (
		<html lang="en-AU" class="ui-theme" style={paletteStyle()}>
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<meta name="color-scheme" content="light dark" />
				<title>Optimal Care Pathways</title>
				{/* The masthead's spine glyph as the tab icon: the SVG where it is understood,
				    a 32 px PNG elsewhere, and the touch icon for a home screen. */}
				<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
				<link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32" />
				<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
				{/* The reader's ground (paper, night) before first paint: no flash. */}
				<script innerHTML={themeBootScript()} />
				<link rel="stylesheet" href={appCss} />
				<HeadContent />
			</head>
			<body>
				<Loading fallback={<p class="ocp-loading">Loading…</p>}>{props.children}</Loading>
				<ToastHost />
				<Scripts />
			</body>
		</html>
	)
}
