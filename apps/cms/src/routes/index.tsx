import { Notice, PageHero, Section } from '@aicolab/ui-solid'
import { createFileRoute } from '@tanstack/solid-router'
import { Show } from 'solid-js'
import { useAuthSession } from '#/lib/auth-client.ts'
import './index.css'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
	const session = useAuthSession()
	return (
		<div class="ocp-home">
			<PageHero
				eyebrow="Cancer Australia"
				title="Optimal Care Pathways"
				lede="Draft, review and publish the national standards for cancer care, one pathway at a time."
			/>
			<Section center>
				<Notice
					class="ocp-home-session"
					colorBase={session().user ? 'success' : 'info'}
					variant="soft"
				>
					<Show when={session().user} fallback={<>Not signed in.</>}>
						{(user) => <>Signed in as {(user() as { email?: string }).email ?? 'a user'}.</>}
					</Show>
				</Notice>
			</Section>
		</div>
	)
}
