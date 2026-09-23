/**
 * A run of section ticks (decision U11): one mark per section, in reading order — a
 * hairline where the section reads as published, a heavier mark in the family colour
 * where the draft changed it, a notch where it waits in review (a rule beneath once the
 * reviewer has decided). The atlas draws a run per spine band; the workspace spine and
 * the colour editor's specimen draw the same marks.
 */

import { For } from 'solid-js'
import type { TickState } from '#/server/atlas.ts'
import './ticks.css'

export function Ticks(props: { ticks: readonly TickState[]; class?: string }) {
	return (
		<span class={['ocp-ticks', props.class]} aria-hidden="true">
			<For each={props.ticks}>{(tick) => <i data-s={tick} />}</For>
		</span>
	)
}

/** The same run where a pixel per section is more than the width allows (a phone): each
 *  stretch of sections in one state becomes one segment, in order and in proportion. */
export function TickRuns(props: { ticks: readonly TickState[]; class?: string }) {
	const runs = () => {
		const out: { state: TickState; length: number }[] = []
		for (const tick of props.ticks) {
			const last = out.at(-1)
			if (last?.state === tick) last.length++
			else out.push({ state: tick, length: 1 })
		}
		return out
	}
	return (
		<span class={['ocp-tick-runs', props.class]} aria-hidden="true">
			<For each={runs()}>{(run) => <i data-s={run.state} style={{ 'flex-grow': run.length }} />}</For>
		</span>
	)
}

/** The ticks in words, for an accessible name. */
export function ticksSummary(ticks: readonly TickState[]): string {
	const count = (s: TickState) => ticks.filter((t) => t === s).length
	const parts = [
		[count('published'), 'as published'],
		[count('changed') + count('new'), 'changed'],
		[count('review'), 'in review'],
		[count('approved'), 'approved'],
		[count('changes'), 'with changes requested'],
	] as const
	const said = parts.filter(([n]) => n > 0).map(([n, what]) => `${n} ${what}`)
	return `${ticks.length} section${ticks.length === 1 ? '' : 's'}${said.length ? `: ${said.join(', ')}` : ''}`
}

/** The key the atlas prints once, in its head. */
export function TickKey() {
	return (
		<dl class="ocp-tick-key">
			<div>
				<dt>
					<Ticks ticks={['published', 'published', 'published']} />
				</dt>
				<dd>As published</dd>
			</div>
			<div>
				<dt>
					<Ticks ticks={['changed', 'changed', 'changed']} />
				</dt>
				<dd>Changed in the draft</dd>
			</div>
			<div>
				<dt>
					<Ticks ticks={['review', 'review', 'review']} />
				</dt>
				<dd>In review</dd>
			</div>
			<div>
				<dt>
					<Ticks ticks={['approved', 'approved', 'changes']} />
				</dt>
				<dd>Decided: approved, changes asked</dd>
			</div>
		</dl>
	)
}
