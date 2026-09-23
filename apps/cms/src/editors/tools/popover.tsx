/**
 * The tools' overlay: a native `popover="auto"` panel (light dismiss and Esc from the
 * browser) positioned by CSS anchor positioning against whatever element carries its
 * anchor name — a toolbar button, or the caret's box for the '/' menu. The DOM is the
 * one truth for open or shut: the toggle events set the signal, so a toolbar button
 * wired by `popovertarget`, a shortcut calling `show()`, and the browser's own dismissal
 * all agree. The panel's content mounts on opening, so each opening starts fresh.
 */

import type { JSX } from '@solidjs/web'
import { createSignal, createUniqueId, Show, untrack } from 'solid-js'

export interface ToolPopoverHandle {
	id: string
	open: () => boolean
	show(): void
	hide(): void
	attach(el: HTMLElement): void
}

const isOpening = (event: Event): boolean => 'newState' in event && event.newState === 'open'

export function createToolPopover(): ToolPopoverHandle {
	const id = `ocp-tool-${createUniqueId()}`
	const [open, setOpen] = createSignal(false)
	let panel: HTMLElement | null = null
	return {
		id,
		open,
		show() {
			if (panel && !panel.matches(':popover-open')) panel.showPopover()
		},
		hide() {
			if (panel?.matches(':popover-open')) panel.hidePopover()
		},
		attach(el) {
			panel = el
			// Opening on `beforetoggle` (synchronous, before the panel paints) so the content
			// is there on the first frame; closing on `toggle`, after the panel has gone.
			el.addEventListener('beforetoggle', (event) => {
				if (isOpening(event)) setOpen(true)
			})
			el.addEventListener('toggle', (event) => {
				if (!isOpening(event)) setOpen(false)
			})
		},
	}
}

export function ToolPopover(props: {
	handle: ToolPopoverHandle
	/** The anchor name of the element the panel sits against. */
	anchor: string
	label: string
	class?: string
	/** Esc inside the panel: the browser closes it; the caller puts the caret back. */
	onEscape?: () => void
	children: JSX.Element
}) {
	// A constant of the instance: the caller makes one handle per panel and keeps it.
	const handle = untrack(() => props.handle)
	return (
		<div
			id={handle.id}
			popover="auto"
			role="dialog"
			aria-label={props.label}
			class={['ocp-tool-popover', props.class]}
			style={{ 'position-anchor': props.anchor }}
			ref={(el) => handle.attach(el)}
			onKeyDown={(event) => {
				if (event.key === 'Escape') props.onEscape?.()
			}}
		>
			<Show when={handle.open()}>{props.children}</Show>
		</div>
	)
}
