// Root route — the HTML shell, the header, and the auth-driven socket singleton.
//
// TanStack Start + Solid 2 shell contract (get it wrong and the page renders but
// never hydrates): `shellComponent` renders <html> directly; route output goes in
// `{props.children}` wrapped in <Loading>; the stylesheet is a static <link>.

import {
	type AuthSession,
	resolveAuthSession,
} from '@aicolab/better-auth/cloudflare/shared/auth-session'
import { Notice, Panel, themeBootScript, ToastHost } from '@aicolab/ui-solid'
import { Loading } from '@solidjs/web'
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/solid-router'
import { createIsomorphicFn } from '@tanstack/solid-start'
import { getRequest } from '@tanstack/solid-start/server'
import type { ParentProps } from 'solid-js'
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
	errorComponent: (props: { error: unknown }) => {
		console.error('[root]', props.error)
		const error = props.error
		const message = error instanceof Error ? error.message : String(error)
		return (
			<main class="ocp-route-error">
				<Panel title="This page could not be shown" colorBase="error" variant="soft">
					<Notice colorBase="error" variant="text" role="alert">
						{message}
					</Notice>
					<p>
						<a href="/">Back to the pathways</a>
					</p>
				</Panel>
			</main>
		)
	},
})

function RootDocument(props: ParentProps) {
	return (
		<html lang="en-AU" class="ui-theme" style={paletteStyle()}>
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<meta name="color-scheme" content="light dark" />
				<title>Optimal Care Pathways</title>
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
