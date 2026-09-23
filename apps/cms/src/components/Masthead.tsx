/**
 * The masthead (decision U12): one slim line naming where the reader is, with the
 * published view one link away, the jump (⌘K), who else is here, and the account corner.
 * Every top-level layout renders it with its own crumbs and contributions, so what it
 * says is always the page's own truth, on the server as on the client.
 *
 * The wordmark carries the seven-step spine (decision U18) as its glyph: seven short
 * rules, the same marks the atlas columns and the published step index are built on.
 */

import { AccountMenu, accountMenuItemClass } from '@aicolab/better-auth/solid/account-menu'
import { setThemeMode, storedThemeMode, type ThemeMode } from '@aicolab/ui-solid'
import { useRouter } from '@tanstack/solid-router'
import type { JSX } from '@solidjs/web'
import { children, createSignal, For, onSettled, Show } from 'solid-js'
import { useAuthSession } from '#/lib/auth-client.ts'
import { familyStyle } from '#/lib/family.ts'
import { Jump, type JumpContribution } from './Jump.tsx'
import './masthead.css'

export interface Crumb {
	label: string
	href?: string
	/** A document's family colour: the crumb reads in it. */
	accent?: string | null
}

export interface MastheadProps extends JumpContribution {
	crumbs?: readonly Crumb[]
	/** Links at the masthead's end: the published view, the draft preview. */
	links?: readonly { label: string; href: string; title?: string }[]
	/** Who else is here (the document's presence). */
	presence?: JSX.Element
	/** Central members get the administration door in their account menu. */
	central?: boolean
}

/** The spine glyph: seven rules, the fourth (treatment) the tallest, as the steps run. */
export function SpineGlyph(props: { class?: string }) {
	const heights = [7, 9, 11, 13, 11, 9, 7]
	return (
		<svg class={['ocp-spine-glyph', props.class]} viewBox="0 0 26 14" aria-hidden="true">
			<For each={heights}>
				{(h, i) => <rect x={i() * 3.7 + 0.6} y={14 - h} width="1.4" height={h} rx="0.5" />}
			</For>
		</svg>
	)
}

const THEMES: { mode: ThemeMode; label: string }[] = [
	{ mode: 'light', label: 'Paper' },
	{ mode: 'dark', label: 'Night' },
	{ mode: 'auto', label: 'Follow the system' },
]

export function Masthead(props: MastheadProps) {
	const session = useAuthSession()
	const router = useRouter()
	const [theme, setTheme] = createSignal<ThemeMode>('auto')
	const presence = children(() => props.presence)
	onSettled(() => {
		setTheme(storedThemeMode())
	})
	const choose = (mode: ThemeMode) => {
		setThemeMode(mode)
		setTheme(mode)
	}
	return (
		<header class="ocp-mast">
			<a class="ocp-mast-mark" href="/" aria-label="Optimal Care Pathways, home">
				<SpineGlyph />
				<span class="ocp-mast-word">Optimal Care Pathways</span>
			</a>
			<Show when={(props.crumbs?.length ?? 0) > 0}>
				<nav class="ocp-mast-crumbs" aria-label="Where you are">
					<ol>
						<For each={props.crumbs}>
							{(crumb, i) => (
								<li
									style={familyStyle(crumb.accent)}
									data-family={crumb.accent ? '' : undefined}
									data-last={i() === (props.crumbs?.length ?? 0) - 1 ? '' : undefined}
								>
									<Show when={crumb.href} fallback={<span aria-current="page">{crumb.label}</span>}>
										{(href) => <a href={href()}>{crumb.label}</a>}
									</Show>
								</li>
							)}
						</For>
					</ol>
				</nav>
			</Show>
			<div class="ocp-mast-end">
				<For each={props.links ?? []}>
					{(link) => (
						<a class="ocp-mast-link" href={link.href} title={link.title}>
							{link.label}
						</a>
					)}
				</For>
				<Show when={presence()}>
					<div class="ocp-mast-presence">{presence()}</div>
				</Show>
				<Jump sections={props.sections} actions={props.actions} search={props.search} />
				<AccountMenu
					session={session}
					google={false}
					onSignedIn={() => void router.invalidate()}
					onSignedOut={() => void router.invalidate()}
				>
					{/* biome-ignore lint/a11y/useSemanticElements: inside a menu the radio items' group is role="group", not a fieldset */}
					<div class="ocp-mast-theme" role="group" aria-label="Ground">
						<For each={THEMES}>
							{(t) => (
								<button
									type="button"
									role="menuitemradio"
									aria-checked={theme() === t.mode ? 'true' : 'false'}
									class={accountMenuItemClass}
									onClick={() => choose(t.mode)}
								>
									{t.label}
								</button>
							)}
						</For>
					</div>
					<Show when={props.central}>
						<a class={accountMenuItemClass} role="menuitem" href="/admin">
							Administration
						</a>
					</Show>
				</AccountMenu>
			</div>
		</header>
	)
}
