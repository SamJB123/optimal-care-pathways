/**
 * Choosing a document's family colour (decisions U21, U25): the print colour in a native
 * picker and as hex, and beside it the colour at work on BOTH grounds — an atlas row's
 * ticks, a spine entry, a published step heading and a link — with the contrast the text
 * reaches and the hex it was walked to. Each specimen is its own theme boundary (paper,
 * night) so it shows exactly what a reader on that ground sees.
 */

import { createMemo, For, Show } from 'solid-js'
import { familyReport, familyStyle, isHexColour, TEXT_CONTRAST } from '#/lib/family.ts'
import { paletteStyle } from '#/lib/palette.ts'
import { Ticks } from './Ticks.tsx'
import './family-colour.css'

const ratio = (n: number) => `${n.toFixed(1)} : 1`

export function FamilyColourField(props: {
	value: string
	onChange: (hex: string) => void
	/** The colour the print gave the document, when there is one to return to. */
	print?: string | null
	/** What the specimens are named after. */
	name: string
	label?: string
}) {
	const valid = () => isHexColour(props.value)
	const report = createMemo(() => (valid() ? familyReport(props.value) : null))
	return (
		<fieldset class="ocp-family-field">
			<legend>{props.label ?? 'Family colour'}</legend>
			<div class="ocp-family-inputs">
				<input
					type="color"
					aria-label="Pick the colour"
					value={valid() ? props.value : '#000000'}
					onInput={(e) => props.onChange(e.currentTarget.value)}
				/>
				<input
					type="text"
					aria-label="The colour as hex"
					spellcheck={false}
					pattern="#[0-9a-fA-F]{6}"
					value={props.value}
					onInput={(e) => {
						const v = e.currentTarget.value.trim()
						props.onChange(v.startsWith('#') ? v : `#${v}`)
					}}
				/>
				<Show when={props.print && props.print.toLowerCase() !== props.value.toLowerCase()}>
					<button type="button" class="ocp-family-reset" onClick={() => props.onChange(props.print ?? props.value)}>
						Back to the print colour
					</button>
				</Show>
			</div>
			<Show when={report()} fallback={<p class="ocp-family-invalid">Write the colour as # and six hex digits, e.g. #b65673.</p>}>
				{(r) => (
					<div class="ocp-family-specimens">
						<For each={[{ scheme: 'light', ground: 'Paper', side: r().paper }, { scheme: 'dark', ground: 'Night', side: r().night }] as const}>
							{(s) => (
								<figure class={['ui-theme', `theme-${s.scheme}`, 'ocp-family-specimen']} style={{ ...paletteStyle(), ...familyStyle(props.value) }}>
									<figcaption>{s.ground}</figcaption>
									<div class="ocp-family-row">
										<span class="ocp-family-name">{props.name}</span>
										<Ticks ticks={['published', 'changed', 'changed', 'published', 'review', 'changed', 'published', 'approved']} />
									</div>
									<div class="ocp-family-spine">
										<span class="ocp-family-mark" aria-hidden="true">●</span> 4.4.2 Radiation therapy
									</div>
									<p class="ocp-family-heading">Step 3: Diagnosis, staging and treatment planning</p>
									<p class="ocp-family-link">
										See <a href="#top" onClick={(e) => e.preventDefault()}>3.5 Multidisciplinary meeting</a>
									</p>
									<p class="ocp-family-readout">
										Text {ratio(s.side.contrast)}, {s.side.contrast >= TEXT_CONTRAST ? 'passes AA' : 'below AA'}
										<Show when={s.side.adjusted}>
											<span> · set at {s.side.ink} for legibility</span>
										</Show>
									</p>
								</figure>
							)}
						</For>
						<p class="ocp-family-on">
							<span class="ocp-family-chip" style={familyStyle(props.value)}>
								On the colour
							</span>
							{ratio(r().on.contrast)}
						</p>
					</div>
				)}
			</Show>
		</fieldset>
	)
}
