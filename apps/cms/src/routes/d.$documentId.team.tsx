/**
 * A document's team, on the workspace's stage: who works on the document and in what
 * role, and — for the lead, the reviewers and the central team — the ways to bring people
 * in and to change who does what (components/TeamPanel.tsx).
 */

import { createFileRoute, useNavigate } from '@tanstack/solid-router'
import { TeamPanel } from '#/components/TeamPanel.tsx'
import { documentTeam } from '#/server/team-fns.ts'

export const Route = createFileRoute('/d/$documentId/team')({
	loader: async ({ params }) => documentTeam({ data: { documentId: params.documentId } }),
	component: TeamPage,
})

function TeamPage() {
	const view = Route.useLoaderData()
	const navigate = useNavigate()
	return (
		<div class="ocp-part ocp-team-page">
			<header class="ocp-team-head">
				<p class="ocp-team-kicker">People</p>
				<h1>Team</h1>
			</header>
			<TeamPanel team={view().team} standing={view().standing} members={view().members} onLeft={() => void navigate({ to: '/' })} />
		</div>
	)
}
