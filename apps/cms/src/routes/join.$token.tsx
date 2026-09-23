/**
 * /join/{token} — an invite link. Says which team it joins and at what role; the reader
 * signs in (or creates their account) here, then joins in one step and lands on the
 * team's document. A revoked or expired link says so.
 */

import { SignInPanel } from '@aicolab/better-auth/solid/sign-in'
import { Button, Chip, EmptyState, Notice } from '@aicolab/ui-solid'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/solid-router'
import { createMemo, createSignal, Show } from 'solid-js'
import { Masthead } from '#/components/Masthead.tsx'
import { useAuthSession } from '#/lib/auth-client.ts'
import { teamHref } from '#/lib/links.ts'
import { roleWord } from '#/lib/team-labels.ts'
import { inviteLinkInfo, redeemInviteLink } from '#/server/team-fns.ts'
import './join.css'

export const Route = createFileRoute('/join/$token')({
	loader: async ({ params }) => inviteLinkInfo({ data: { token: params.token } }),
	component: JoinPage,
})

function JoinPage() {
	const params = Route.useParams()
	const info = Route.useLoaderData()
	const session = useAuthSession()
	const router = useRouter()
	const navigate = useNavigate()
	const [joining, setJoining] = createSignal(false)
	const [error, setError] = createSignal<string | null>(null)
	/** The link, when it still works. */
	const live = createMemo(() => {
		const i = info()
		return i.valid ? i : null
	})

	const join = () => {
		setJoining(true)
		setError(null)
		void redeemInviteLink({ data: { token: params().token } })
			.then((joined) => {
				if (joined.documentId) void navigate({ href: teamHref(joined.documentId) })
				else void navigate({ to: '/admin' })
			})
			.catch((err: unknown) => {
				setError(err instanceof Error ? err.message : 'The link could not be used.')
				setJoining(false)
			})
	}

	return (
		<>
			<Masthead crumbs={[{ label: 'Pathways', href: '/' }, { label: 'Invitation' }]} />
			<main class="ocp-join">
				<Show
					when={live()}
					fallback={<EmptyState title="This invite link no longer works" hint="It has expired or been revoked. Ask the team for a fresh one." />}
				>
					{(valid) => (
						<>
							<p class="ocp-join-kicker">Invite link</p>
							<h1>Join {valid().teamName}</h1>
							<p class="ocp-join-lede">
								You will join the team as a{' '}
								<Chip variant="soft" colorBase="primary">
									{roleWord(valid().role, valid().central)}
								</Chip>
								.
							</p>
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
										<p>Sign in, or create your account with your email address, to join.</p>
										<SignInPanel google={false} onSignedIn={() => void router.invalidate()} />
									</div>
								}
							>
								<Button onClick={join} disabled={joining()}>
									{joining() ? 'Joining…' : 'Join the team'}
								</Button>
							</Show>
						</>
					)}
				</Show>
			</main>
		</>
	)
}
