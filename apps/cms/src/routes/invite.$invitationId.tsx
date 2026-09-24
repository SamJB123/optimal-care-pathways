/**
 * /invite/{invitationId} — where an invitation email's link lands. The reader signs in
 * with the address the invitation was sent to (creating their account with it, if they
 * have none), accepts, and lands on the team's document. The auth worker checks the
 * address, the expiry and that the invitation is still open; a refusal says which.
 */

import { SignInPanel } from '@aicolab/better-auth/solid/sign-in'
import { Button, Notice } from '@aicolab/ui-solid'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/solid-router'
import { createSignal, Show } from 'solid-js'
import { Masthead } from '#/components/Masthead.tsx'
import { useAuthSession } from '#/lib/auth-client.ts'
import { homeLink, teamLink } from '#/lib/links.ts'
import { acceptTeamInvitation } from '#/server/team-fns.ts'
import './join.css'

export const Route = createFileRoute('/invite/$invitationId')({
	component: InvitationPage,
})

function InvitationPage() {
	const params = Route.useParams()
	const session = useAuthSession()
	const router = useRouter()
	const navigate = useNavigate()
	const [accepting, setAccepting] = createSignal(false)
	const [error, setError] = createSignal<string | null>(null)

	const accept = () => {
		setAccepting(true)
		setError(null)
		void acceptTeamInvitation({ data: { invitationId: params().invitationId } })
			.then((joined) => {
				if (joined.documentId) void navigate(teamLink(joined.documentId))
				else void navigate({ to: '/admin' })
			})
			.catch((err: unknown) => {
				setError(err instanceof Error ? err.message : 'The invitation could not be accepted.')
				setAccepting(false)
			})
	}

	return (
		<>
			<Masthead crumbs={[{ label: 'Pathways', link: homeLink() }, { label: 'Invitation' }]} />
			<main class="ocp-join">
				<p class="ocp-join-kicker">Invitation</p>
				<h1>You have been invited to a team</h1>
				<p class="ocp-join-lede">Accept to join the team working on an Optimal Care Pathway.</p>
				<Show when={error()}>
					{(text) => (
						<Notice colorBase="error" variant="soft" role="alert">
							{text()}
						</Notice>
					)}
				</Show>
				<Show
					when={session().user}
					fallback={
						<div class="ocp-join-sign-in">
							<p>Sign in with the email address the invitation was sent to.</p>
							<SignInPanel google={false} onSignedIn={() => void router.invalidate()} />
						</div>
					}
				>
					<Button onClick={accept} disabled={accepting()}>
						{accepting() ? 'Accepting…' : 'Accept the invitation'}
					</Button>
				</Show>
			</main>
		</>
	)
}
