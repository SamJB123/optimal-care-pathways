/**
 * The page a route shows when it cannot be shown: what went wrong, in the refusal's own
 * words ("You are not a member of this document."), and the way back. It is the router's
 * default error component (router.tsx) as well as the root's: TanStack Router gives a
 * route without its own error component the router's default, never its parent's.
 */

import { Notice, Panel } from '@aicolab/ui-solid'

export function RouteError(props: { error: unknown }) {
	console.error('[route]', props.error)
	const message = () => (props.error instanceof Error ? props.error.message : String(props.error))
	return (
		<main class="ocp-route-error">
			<Panel title="This page could not be shown" colorBase="error" variant="soft">
				<Notice colorBase="error" variant="text" role="alert">
					{message()}
				</Notice>
				<p>
					<a href="/">Back to the pathways</a>
				</p>
			</Panel>
		</main>
	)
}
