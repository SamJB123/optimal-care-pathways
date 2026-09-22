/** The auth pages' common frame: brand, theme toggle, centred content. */
import { ThemeToggle } from '@aicolab/ui-solid'
import type { JSX } from '@solidjs/web'
import './styles.css'

export function Shell(props: {
	eyebrow?: string
	title: string
	lede?: string
	children: JSX.Element
}) {
	return (
		<>
			<header class="au-header">
				<a href="/" class="au-brand">
					<span class="au-brand-mark" aria-hidden="true">
						OCP
					</span>
					<span>
						<span class="au-brand-name">Optimal Care Pathways</span>
						<br />
						<span class="au-brand-sub">Account</span>
					</span>
				</a>
				<ThemeToggle />
			</header>
			<main class="au-main">
				<section class="au-card">
					{props.eyebrow ? <p class="au-eyebrow">{props.eyebrow}</p> : null}
					<h1 class="au-title">{props.title}</h1>
					{props.lede ? <p class="au-lede">{props.lede}</p> : null}
					{props.children}
				</section>
			</main>
		</>
	)
}
