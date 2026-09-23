/**
 * A team: its roster, role changes and removals, and every way in (the hive's members
 * panel, named for this application). Used for a pathway's team on /d/{id}/team and for
 * the central team on /admin; it takes the organisation it manages and the reader's
 * standing, and offers only what the reader may do (lib/team-rule.ts; the server and the
 * auth worker enforce the same rule).
 *
 *   - the roster: name, avatar, member tag, role — never an email address; leads, then
 *     reviewers, drafters, viewers, then by name;
 *   - by email: an address with an account is added at once (and emailed); any other is
 *     sent an invitation;
 *   - by member code, from the person's account menu;
 *   - by searching the people already on an OCP team;
 *   - invite links: 14 days, revocable, at a role, with a QR sheet for a workshop.
 *
 * SSR renders the loader's roster; after hydration the team's live topic takes over, so a
 * change anyone makes appears for everyone watching. The reader's own role is read from
 * the live roster, so their standing follows a change made to them.
 */

import { displayNameOf, normalizeMemberCode, userTagOf } from '@aicolab/better-auth/cloudflare/shared/user-tag'
import { Avatar, Button, Chip, EmptyState, Field, RichList, RichListItem, SelectControl, TextInput, toast } from '@aicolab/ui-solid'
import { createEffect, createMemo, createSignal, For, onSettled, Show } from 'solid-js'
import type { Role } from '#/lib/roles.ts'
import { teamClientFor } from '#/lib/team-client.ts'
import {
	compareMembers,
	grantableRoles,
	managesTeam,
	mayChange,
	mayGrant,
	rolesFor,
	type TeamStanding,
} from '#/lib/team-rule.ts'
import { roleName, roleWord } from '#/lib/team-labels.ts'
import type { TeamMemberWireRow } from '#/lib/team-topic.ts'
import type { AddResult, InviteLinkWire, PersonHit, TeamSummary } from '#/server/team.ts'
import {
	addTeamMemberByCode,
	addTeamMemberByEmail,
	addTeamPerson,
	changeTeamMember,
	createTeamInviteLink,
	revokeTeamInviteLink,
	searchTeamPeople,
	teamInviteLinks,
} from '#/server/team-fns.ts'
import { InviteQrSheet } from './InviteQrSheet.tsx'
import './team.css'

const messageOf = (error: unknown, fallback: string): string => (error instanceof Error ? error.message : fallback)
const fail = (error: unknown, fallback: string): void => {
	toast.error(messageOf(error, fallback))
}

const nameOf = (m: { userId: string; name: string }): string => displayNameOf({ id: m.userId, name: m.name })

export function TeamPanel(props: {
	team: TeamSummary
	/** The reader's standing when the page loaded; the live roster moves their own role. */
	standing: TeamStanding
	/** The roster the page loaded, until the live topic lands. */
	members: TeamMemberWireRow[]
	/** The reader left the team (or was removed from it): the page moves on. */
	onLeft?: () => void
}) {
	const [live, setLive] = createSignal<TeamMemberWireRow[] | null>(null)
	const [selfId, setSelfId] = createSignal<string | null>(null)

	// Client-only: effects never run during SSR. The client is cached per organisation; this
	// only subscribes, and unsubscribes on a switch.
	createEffect(
		() => props.team.orgId,
		(orgId) => {
			const next = teamClientFor(orgId)
			const update = () => {
				if (!next.ready()) return
				setLive([...next.members.values()])
				setSelfId(next.selfId())
			}
			update()
			return next.onChange(update)
		},
	)

	const members = createMemo(() =>
		(live() ?? props.members).map((m) => ({ ...m, name: nameOf(m) })).sort(compareMembers),
	)
	const leads = () => members().filter((m) => m.role === 'owner').length
	/** The reader's standing now: a steward stays one; anyone else stands by their own row. */
	const standing = createMemo((): TeamStanding => {
		if (props.standing === 'steward') return 'steward'
		const self = selfId()
		if (!self || !live()) return props.standing
		return members().find((m) => m.userId === self)?.role ?? null
	})
	const manages = () => managesTeam(standing())
	const grantable = () => grantableRoles(standing())
	const label = (role: Role) => roleName(role, props.team.central)
	const word = (role: Role) => roleWord(role, props.team.central)

	// ---- the roster ---------------------------------------------------------------------
	const [confirming, setConfirming] = createSignal<string | null>(null)
	const change = (member: TeamMemberWireRow & { name: string }, role: Role | null) => {
		const leaving = role === null && member.userId === selfId()
		void changeTeamMember({ data: { orgId: props.team.orgId, userId: member.userId, role } })
			.then((done) => {
				setConfirming(null)
				if (leaving) {
					toast.success(`You have left ${props.team.name}.`)
					props.onLeft?.()
				} else if (done.role === null) toast.success(`${done.name} removed from the team.`)
				else toast.success(`${done.name} is now a ${word(done.role)}.`)
			})
			.catch((err: unknown) => {
				setConfirming(null)
				fail(err, 'That change could not be made.')
			})
	}
	const mayRemove = (member: TeamMemberWireRow) =>
		mayChange({ standing: standing(), self: member.userId === selfId(), from: member.role, to: null, leads: leads() }).ok

	// ---- the ways in -------------------------------------------------------------------
	const [joinAs, setJoinAs] = createSignal<Role>('member')
	/** The role the forms bring people in at: the reader's choice, while they may grant it. */
	const role = () => (grantable().includes(joinAs()) ? joinAs() : (grantable().at(-1) ?? 'viewer'))
	const [email, setEmail] = createSignal('')
	const [code, setCode] = createSignal('')
	const [query, setQuery] = createSignal('')
	const [hits, setHits] = createSignal<PersonHit[]>([])
	const [busy, setBusy] = createSignal(false)

	const reported = (result: AddResult) => {
		if (result.kind === 'invited') toast.success(`Invitation emailed to ${result.email}.`)
		else if (result.kind === 'already')
			toast.info(`${result.name} is already on the team${result.role ? ` as a ${word(result.role)}` : ''}.`)
		else toast.success(`${result.name} added as a ${word(result.role)}. ${result.emailed ? 'They have been emailed.' : 'The email to them could not be sent.'}`)
	}
	const run = (work: Promise<AddResult>, then: () => void) => {
		setBusy(true)
		void work
			.then((result) => {
				reported(result)
				then()
			})
			.catch((err: unknown) => fail(err, 'That person could not be added.'))
			.finally(() => setBusy(false))
	}
	const addByEmail = () => {
		const address = email().trim()
		if (address) run(addTeamMemberByEmail({ data: { orgId: props.team.orgId, email: address, role: role() } }), () => setEmail(''))
	}
	const addByCode = () => {
		const value = normalizeMemberCode(code())
		if (value) run(addTeamMemberByCode({ data: { orgId: props.team.orgId, code: value, role: role() } }), () => setCode(''))
	}
	const addPerson = (hit: PersonHit) =>
		run(addTeamPerson({ data: { orgId: props.team.orgId, userId: hit.id, role: role() } }), () => {
			setHits([])
			setQuery('')
		})

	let searchTimer: ReturnType<typeof setTimeout> | undefined
	const search = (raw: string) => {
		setQuery(raw)
		clearTimeout(searchTimer)
		const q = raw.trim()
		if (q.length < 2) {
			setHits([])
			return
		}
		searchTimer = setTimeout(() => {
			void searchTeamPeople({ data: { orgId: props.team.orgId, query: q } })
				.then(setHits)
				.catch(() => setHits([]))
		}, 250)
	}

	// ---- invite links -------------------------------------------------------------------
	const [links, setLinks] = createSignal<InviteLinkWire[]>([])
	const [qr, setQr] = createSignal<InviteLinkWire | null>(null)
	const linkRoles = () => grantable().filter((r) => r !== 'owner')
	const refreshLinks = () => {
		if (!manages()) return
		void teamInviteLinks({ data: { orgId: props.team.orgId } })
			.then(setLinks)
			.catch(() => setLinks([]))
	}
	onSettled(() => {
		refreshLinks()
	})
	const copy = (url: string) =>
		void navigator.clipboard
			.writeText(url)
			.then(() => toast.success('Invite link copied.'))
			.catch(() => toast.error('Could not copy. Select the link and copy it.'))
	const newLink = (linkRole: Role) => {
		if (linkRole === 'owner') return
		void createTeamInviteLink({ data: { orgId: props.team.orgId, role: linkRole } })
			.then((link) => {
				setLinks((all) => [link, ...all])
				copy(link.url)
			})
			.catch((err: unknown) => fail(err, 'The link could not be made.'))
	}
	const revoke = (link: InviteLinkWire) =>
		void revokeTeamInviteLink({ data: { orgId: props.team.orgId, token: link.token } })
			.then(() => {
				setLinks((all) => all.filter((l) => l.token !== link.token))
				toast.success('Invite link revoked.')
			})
			.catch((err: unknown) => fail(err, 'The link could not be revoked.'))

	const standingLine = () => {
		const s = standing()
		if (s === 'steward') return 'You manage this team as a member of Cancer Australia.'
		if (s === null) return 'You are no longer on this team.'
		if (s === 'owner') return `You are the team’s ${word('owner')}${leads() > 1 ? `, one of ${leads()}` : ''}.`
		if (s === 'admin') return 'You are a reviewer: you can bring in and change drafters and viewers.'
		return `You are a ${word(s)}. The ${word('owner')} and the reviewers manage the team.`
	}

	return (
		<div class="ocp-team">
			<p class="ocp-team-standing">{standingLine()}</p>
			<Show
				when={members().length > 0}
				fallback={<EmptyState title="No one is on this team yet" hint={manages() ? 'Bring the first people in below.' : undefined} />}
			>
				<RichList class="ocp-team-roster" label={`${props.team.name} team`} colorBase="neutral">
					<For each={members()}>
						{(member) => (
							<RichListItem
								leading={<Avatar name={member.name} image={member.image ?? undefined} />}
								title={
									<span class="ocp-team-name">
										{member.name}
										<Show when={member.userId === selfId()}>
											<span class="ocp-team-you"> (you)</span>
										</Show>
									</span>
								}
								description={<span class="ocp-team-tag">#{userTagOf(member.userId)}</span>}
								trailing={
									<span class="ocp-team-trailing">
										<Show
											when={rolesFor({ standing: standing(), self: member.userId === selfId(), from: member.role, leads: leads() }).length > 0}
											fallback={
												<Chip variant="soft" colorBase={member.role === 'owner' ? 'primary' : 'neutral'}>
													{label(member.role)}
												</Chip>
											}
										>
											<SelectControl
												aria-label={`Role of ${member.name}`}
												value={member.role}
												onChange={(e) => {
													const to = rolesFor({ standing: standing(), self: member.userId === selfId(), from: member.role, leads: leads() }).find(
														(r) => r === e.currentTarget.value,
													)
													if (to && to !== member.role) change(member, to)
												}}
											>
												{/* `selected`, not only `value`: a select's value does not serialise
												    to HTML, so SSR would first-paint the first option on every row. */}
												<For each={rolesFor({ standing: standing(), self: member.userId === selfId(), from: member.role, leads: leads() }).toReversed()}>
													{(r) => (
														<option value={r} selected={r === member.role}>
															{label(r)}
														</option>
													)}
												</For>
											</SelectControl>
										</Show>
										<Show when={mayRemove(member)}>
											<Button
												variant="text"
												colorBase="error"
												onClick={() => (confirming() === member.userId ? change(member, null) : setConfirming(member.userId))}
												onBlur={() => setConfirming(null)}
											>
												{confirming() === member.userId ? 'Confirm' : member.userId === selfId() ? 'Leave' : 'Remove'}
											</Button>
										</Show>
									</span>
								}
							/>
						)}
					</For>
				</RichList>
			</Show>
			<Show when={!props.team.central}>
				<p class="ocp-team-note">The Cancer Australia team reviews every pathway and publishes it. They are not listed here.</p>
			</Show>

			<Show when={manages()}>
				<section class="ocp-team-in" aria-labelledby="ocp-team-in-heading">
					<h2 id="ocp-team-in-heading">Bring people in</h2>
					<Field label="Join as">
						<SelectControl value={role()} onChange={(e) => setJoinAs(grantable().find((r) => r === e.currentTarget.value) ?? role())}>
							<For each={grantable().toReversed()}>
								{(r) => (
									<option value={r} selected={r === role()}>
										{label(r)}
									</option>
								)}
							</For>
						</SelectControl>
					</Field>

					<div class="ocp-team-ways">
						<form
							class="ocp-team-way"
							onSubmit={(e) => {
								e.preventDefault()
								addByEmail()
							}}
						>
							<Field label="By email">
								<TextInput type="email" placeholder="name@example.org" value={email()} onInput={(e) => setEmail(e.currentTarget.value)} />
							</Field>
							<Button type="submit" variant="outline" disabled={busy()}>
								Add
							</Button>
							<p class="ocp-team-hint">Someone new is sent an invitation to sign in and join.</p>
						</form>

						<form
							class="ocp-team-way"
							onSubmit={(e) => {
								e.preventDefault()
								addByCode()
							}}
						>
							<Field label="By member code">
								<TextInput placeholder="#k3v7q2xd" value={code()} onInput={(e) => setCode(e.currentTarget.value)} />
							</Field>
							<Button type="submit" variant="outline" disabled={busy()}>
								Add
							</Button>
							<p class="ocp-team-hint">Everyone’s member code is in their account menu.</p>
						</form>

						<div class="ocp-team-way ocp-team-search">
							<Field label="People on other OCP teams">
								<TextInput type="search" placeholder="Search by name or email" value={query()} onInput={(e) => search(e.currentTarget.value)} />
							</Field>
							<Show when={hits().length > 0}>
								<RichList class="ocp-team-hits" label="People found" colorBase="neutral">
									<For each={hits()}>
										{(hit) => (
											<RichListItem
												leading={<Avatar name={hit.name} image={hit.image ?? undefined} size="28px" />}
												title={hit.name}
												description={<span class="ocp-team-tag">#{userTagOf(hit.id)}</span>}
												trailing={
													<Button variant="outline" disabled={busy()} onClick={() => addPerson(hit)}>
														Add
													</Button>
												}
											/>
										)}
									</For>
								</RichList>
							</Show>
						</div>
					</div>

					<div class="ocp-team-links">
						<h3>Invite links</h3>
						<p class="ocp-team-hint">Anyone who opens a link and signs in joins at its role. Links work for 14 days.</p>
						<For each={links()}>
							{(link) => (
								<div class="ocp-team-link">
									<Chip variant="soft" colorBase={link.role === 'viewer' ? 'neutral' : 'secondary'}>
										{label(link.role)}
									</Chip>
									<code class="ocp-team-link-url">{link.url}</code>
									<span class="ocp-team-link-actions">
										<Button variant="text" onClick={() => copy(link.url)}>
											Copy
										</Button>
										<Button variant="text" onClick={() => setQr(link)}>
											QR
										</Button>
										<Show when={mayGrant(standing(), link.role).ok}>
											<Button variant="text" colorBase="error" onClick={() => revoke(link)}>
												Revoke
											</Button>
										</Show>
									</span>
								</div>
							)}
						</For>
						<div class="ocp-team-link-new">
							<For each={linkRoles().toReversed()}>
								{(r) => (
									<Button variant="outline" onClick={() => newLink(r)}>
										New {word(r)} link
									</Button>
								)}
							</For>
						</div>
					</div>
				</section>
			</Show>

			<Show when={qr()}>
				{(link) => <InviteQrSheet link={link()} teamName={props.team.name} central={props.team.central} onDismiss={() => setQr(null)} />}
			</Show>
		</div>
	)
}
