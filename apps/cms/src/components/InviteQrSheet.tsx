/**
 * The QR sheet for one invite link, for a workshop's last slide: a large code with the
 * seven-step glyph on a white knockout, the link, PNG and SVG downloads for slides and
 * print, and a full-screen Present mode for projecting it. Everything renders in the
 * browser (qrSvgString); the token leaves the page only inside the /join link it encodes.
 */

import { AdaptiveModalSheet, Button, Chip, QrCode, qrSvgString, toast } from '@aicolab/ui-solid'
import { createSignal, onSettled, Show } from 'solid-js'
import { imprintDate } from '#/lib/labels.ts'
import type { Role } from '#/lib/roles.ts'
import { roleWord } from '#/lib/team-labels.ts'
import { SpineGlyph } from './Masthead.tsx'
import './invite-qr.css'

const KNOCKOUT = 0.22
const EXPORT_PX = 1024

export interface InviteLinkForQr {
	url: string
	role: Role
	expiresAt: number
}

const saveBlob = (blob: Blob, filename: string): void => {
	const a = document.createElement('a')
	a.href = URL.createObjectURL(blob)
	a.download = filename
	a.click()
	setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

export function InviteQrSheet(props: { link: InviteLinkForQr; teamName: string; central: boolean; onDismiss: () => void }) {
	const [presenting, setPresenting] = createSignal(false)
	let sheet: HTMLDivElement | undefined
	let present: HTMLDivElement | undefined

	/** The glyph the sheet shows, as an image for the exported code: the same drawing,
	 *  read from the page rather than drawn twice. */
	const markHref = (): string | undefined => {
		const glyph = sheet?.querySelector('.ocp-qr-mark')
		return glyph ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(glyph))}` : undefined
	}
	const exportSvg = (): string =>
		qrSvgString(props.link.url, { knockout: KNOCKOUT, markHref: markHref(), ink: '#000000', surface: '#ffffff', pixelSize: EXPORT_PX })
	const filename = (ext: string): string => `team-invite-${roleWord(props.link.role, props.central).replace(/\s+/g, '-')}.${ext}`

	const downloadSvg = (): void => saveBlob(new Blob([exportSvg()], { type: 'image/svg+xml' }), filename('svg'))
	const downloadPng = (): void => {
		const src = URL.createObjectURL(new Blob([exportSvg()], { type: 'image/svg+xml' }))
		const img = new Image()
		img.onload = () => {
			const canvas = document.createElement('canvas')
			canvas.width = EXPORT_PX
			canvas.height = EXPORT_PX
			canvas.getContext('2d')?.drawImage(img, 0, 0, EXPORT_PX, EXPORT_PX)
			URL.revokeObjectURL(src)
			canvas.toBlob((blob) => (blob ? saveBlob(blob, filename('png')) : toast.error('This browser could not make the PNG.')), 'image/png')
		}
		img.onerror = () => {
			URL.revokeObjectURL(src)
			toast.error('This browser could not make the PNG.')
		}
		img.src = src
	}

	const startPresenting = (): void => {
		setPresenting(true)
		// The fixed overlay is the mechanism; full screen only removes the browser's chrome
		// where it is allowed.
		queueMicrotask(() => present?.requestFullscreen?.().catch(() => {}))
	}
	const stopPresenting = (): void => {
		if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
		setPresenting(false)
	}
	onSettled(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') stopPresenting()
		}
		document.addEventListener('keydown', onKey)
		return () => document.removeEventListener('keydown', onKey)
	})

	const mark = () => <SpineGlyph class="ocp-qr-mark" />

	return (
		<>
			{/* The sheet is a modal <dialog>, in the top layer above any z-index: it steps
			    aside while the code is presented, and returns after. */}
			<AdaptiveModalSheet
				open={!presenting()}
				label="Invite link QR code"
				title="Invite link QR code"
				eyebrow={
					<Chip variant="soft" colorBase={props.link.role === 'viewer' ? 'neutral' : 'secondary'}>
						Joins as a {roleWord(props.link.role, props.central)}
					</Chip>
				}
				onDismiss={props.onDismiss}
			>
				<div
					class="ocp-qr-sheet"
					ref={(el) => {
						sheet = el
					}}
				>
					<QrCode class="ocp-qr-code" value={props.link.url} label={`QR code for ${props.link.url}`} knockout={KNOCKOUT} mark={mark} />
					<button
						type="button"
						class="ocp-qr-url"
						title="Copy the link"
						onClick={() => {
							void navigator.clipboard
								.writeText(props.link.url)
								.then(() => toast.success('Link copied.'))
								.catch(() => toast.error('Could not copy. Select the link and copy it.'))
						}}
					>
						<code>{props.link.url}</code>
					</button>
					<p class="ocp-qr-expiry">Works until {imprintDate(props.link.expiresAt)}. Make a new link after that.</p>
					<div class="ocp-qr-actions">
						<Button variant="outline" onClick={downloadPng}>
							Download PNG
						</Button>
						<Button variant="outline" onClick={downloadSvg}>
							Download SVG
						</Button>
						<Button onClick={startPresenting}>Present</Button>
					</div>
				</div>
			</AdaptiveModalSheet>

			{/* The projection surface: a giant code and the join line. A click anywhere, or
			    Escape, ends it. */}
			<Show when={presenting()}>
				{/* biome-ignore lint/a11y/useKeyWithClickEvents: Escape ends it from the keyboard (the document listener above) */}
				<div
					class="ocp-qr-present"
					ref={(el) => {
						present = el
					}}
					role="dialog"
					aria-label="The invite QR code, presented"
					onClick={stopPresenting}
				>
					<p class="ocp-qr-present-title">Scan to join {props.teamName}</p>
					<QrCode class="ocp-qr-present-code" value={props.link.url} knockout={KNOCKOUT} mark={mark} />
					<p class="ocp-qr-present-url">{props.link.url.replace(/^https?:\/\//, '')}</p>
				</div>
			</Show>
		</>
	)
}
