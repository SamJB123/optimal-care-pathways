/**
 * The front door (decisions S1, U1): a signed-in member lands on the atlas of the
 * documents they work on; a visitor who is not signed in lands on the public library of
 * published pathways. Both render from the loader on the server, so either page is whole
 * on first paint.
 */

import { createFileRoute } from '@tanstack/solid-router'
import { createSignal, Show } from 'solid-js'
import { Atlas } from '#/components/Atlas.tsx'
import { Library } from '#/components/Library.tsx'
import { Masthead } from '#/components/Masthead.tsx'
import { NewPathwaySheet } from '#/components/NewPathway.tsx'
import { useAuthSession } from '#/lib/auth-client.ts'
import { atlasSnapshot, publicLibrary } from '#/server/atlas.ts'
import './index.css'

export const Route = createFileRoute('/')({
	loader: async () => {
		const [library, atlas] = await Promise.all([publicLibrary(), atlasSnapshot().catch(() => null)])
		return { library, atlas }
	},
	component: Home,
})

function Home() {
	const session = useAuthSession()
	const data = Route.useLoaderData()
	const [creating, setCreating] = createSignal(false)
	return (
		<Show
			when={session().user ? data().atlas : null}
			fallback={
				<>
					<Masthead />
					<main>
						<Library entries={data().library} />
					</main>
				</>
			}
		>
			{(snapshot) => (
				<>
					<Masthead
						crumbs={[{ label: 'Pathways' }]}
						central={snapshot().central}
						links={[{ label: 'Published library', href: '/library' }]}
					/>
					<main>
						<Show when={snapshot().setUp || (snapshot().central && snapshot().pending > 0)}>
							<p class="ocp-home-notice" role="status">
								{snapshot().setUp
									? 'This deployment has no central organisation yet, so the core templates have no owner.'
									: `${snapshot().pending} imported ${snapshot().pending === 1 ? 'pathway is' : 'pathways are'} waiting for ${snapshot().pending === 1 ? 'its organisation' : 'their organisations'}.`}{' '}
								<a href="/admin">Administration</a>
							</p>
						</Show>
						<Show
							when={snapshot().rows.length > 0}
							fallback={
								<section class="ocp-home-empty">
									<h1>You are not on a pathway team yet</h1>
									<p>
										A pathway's lead or the central team adds people to its team. Your member code,
										which they can use to add you, is in the account menu at the top right.
									</p>
									<p>
										<a href="/library">Read the published pathways</a>
									</p>
								</section>
							}
						>
							<Atlas
								snapshot={snapshot()}
								onNew={snapshot().central ? () => setCreating(true) : undefined}
							/>
						</Show>
						<Show when={snapshot().central}>
							<NewPathwaySheet open={creating()} onDismiss={() => setCreating(false)} />
						</Show>
					</main>
				</>
			)}
		</Show>
	)
}
