// Root route — the HTML shell, the header, and the auth-driven socket singleton.
//
// TanStack Start + Solid 2 shell contract (get it wrong and the page renders but
// never hydrates): `shellComponent` renders <html> directly; route output goes in
// `{props.children}` wrapped in <Loading>; the stylesheet is a static <link>.

import {
	type AuthSession,
	resolveAuthSession,
} from '@aicolab/better-auth/cloudflare/shared/auth-session'
import { ButtonLink, Eyebrow, Notice, Panel, ThemeToggle } from '@aicolab/ui-solid'
import { Loading } from '@solidjs/web'
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/solid-router'
import { createIsomorphicFn } from '@tanstack/solid-start'
import { getRequest } from '@tanstack/solid-start/server'
import type { ParentProps } from 'solid-js'
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
			<div class="ocp-route-error">
				<Panel title="Something went wrong" colorBase="error" variant="soft">
					<Notice colorBase="error" variant="text" role="alert">
						{message}
					</Notice>
				</Panel>
			</div>
		)
	},
})

function RootDocument(props: ParentProps) {
	return (
		<html lang="en-AU">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title>Optimal Care Pathways</title>
				<link rel="stylesheet" href={appCss} />
				<HeadContent />
			</head>
			<body>
				<header class="ocp-app-header">
					<nav class="ocp-app-nav" aria-label="Primary navigation">
						<Eyebrow>Optimal Care Pathways</Eyebrow>
						<div class="ocp-app-nav-end">
							<ButtonLink href="/" variant="text">
								Home
							</ButtonLink>
							<ThemeToggle />
						</div>
					</nav>
				</header>
				<main>
					<Loading fallback={<Notice class="ocp-loading">Loading…</Notice>}>
						{props.children}
					</Loading>
				</main>
				<Scripts />
			</body>
		</html>
	)
}
