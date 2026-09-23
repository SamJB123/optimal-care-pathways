/**
 * The jump (decision U12, S2): ⌘K / Ctrl+K from anywhere, over ui-solid's CommandPalette.
 * It finds the documents the reader can open, every published page with its guide and
 * PDFs, the sections of the document in hand, and the actions the page offers in words
 * — each page hands in its own sections and actions. The document index loads on first
 * open; the full-text answers (when a page supplies a search) arrive as their own group.
 */

import {
	CommandPalette,
	type CommandPaletteGroup,
	type CommandPaletteItem,
	CommandPaletteTrigger,
	openCommandPalette,
} from '@aicolab/ui-solid'
import { useNavigate } from '@tanstack/solid-router'
import { createMemo, createSignal, onSettled } from 'solid-js'
import { guideHref, guidePdfHref, pdfHref, publishedHref, workspaceHref } from '#/lib/links.ts'
import { type JumpDocument, jumpIndex } from '#/server/atlas.ts'
import './jump.css'

export const JUMP_ID = 'ocp-jump'

export interface JumpTarget extends CommandPaletteItem {
	/** An in-app path, or a function to run. */
	go: string | (() => void)
}

/** What a page contributes: the sections of its document and its actions. */
export interface JumpContribution {
	sections?: readonly JumpTarget[]
	actions?: readonly JumpTarget[]
	/** Full-text search, when the page offers it: called as the query changes. */
	search?: (query: string) => Promise<readonly JumpTarget[]>
}

const RECENT_KEY = 'ocp:jump-recent'

function documentTargets(documents: readonly JumpDocument[]): JumpTarget[] {
	return documents.flatMap((d) => [
		...(d.id
			? [
					{
						id: `doc:${d.id}`,
						label: d.name,
						detail: d.title,
						kind: d.kind === 'core' ? 'Template' : 'Pathway',
						keywords: [d.subject, d.slug],
						go: workspaceHref(d.id),
					},
				]
			: []),
		...(d.published
			? [
					{ id: `pub:${d.slug}`, label: `${d.name}, published`, kind: 'Published', keywords: [d.subject, d.slug, 'read'], go: publishedHref(d.slug) },
					{ id: `guide:${d.slug}`, label: `${d.name}, quick reference guide`, kind: 'Published', keywords: [d.subject, 'guide'], go: guideHref(d.slug) },
					{ id: `pdf:${d.slug}`, label: `${d.name}, PDF`, kind: 'Download', keywords: [d.subject, 'pdf'], go: pdfHref(d.slug) },
					{ id: `gpdf:${d.slug}`, label: `${d.name}, guide PDF`, kind: 'Download', keywords: [d.subject, 'pdf', 'guide'], go: guidePdfHref(d.slug) },
				]
			: []),
	])
}

export function Jump(props: JumpContribution) {
	const navigate = useNavigate()
	const [documents, setDocuments] = createSignal<readonly JumpDocument[]>([])
	const [found, setFound] = createSignal<readonly JumpTarget[]>([])
	const [recent, setRecent] = createSignal<readonly string[]>([])
	let loaded = false
	let asked = 0

	onSettled(() => {
		try {
			const stored: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
			if (Array.isArray(stored)) setRecent(stored.filter((x): x is string => typeof x === 'string'))
		} catch {
			/* no recents: fine */
		}
		const onKey = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
				event.preventDefault()
				openCommandPalette(JUMP_ID)
			}
		}
		document.addEventListener('keydown', onKey)
		return () => document.removeEventListener('keydown', onKey)
	})

	const items = createMemo((): JumpTarget[] => [
		...(props.actions ?? []),
		...(props.sections ?? []),
		...documentTargets(documents()),
	])

	const extraGroups = createMemo((): CommandPaletteGroup<JumpTarget>[] =>
		found().length > 0 ? [{ label: 'In the text', items: found() }] : [],
	)

	const onQuery = (query: string) => {
		const search = props.search
		const ask = ++asked
		if (!search || query.trim().length < 3) {
			setFound([])
			return
		}
		setTimeout(() => {
			if (ask !== asked) return
			void search(query.trim())
				.then((results) => {
					if (ask === asked) setFound(results)
				})
				.catch(() => setFound([]))
		}, 220)
	}

	const select = (item: JumpTarget) => {
		const next = [item.id, ...recent().filter((id) => id !== item.id)].slice(0, 6)
		setRecent(next)
		try {
			localStorage.setItem(RECENT_KEY, JSON.stringify(next))
		} catch {
			/* recents are a convenience */
		}
		if (typeof item.go === 'function') item.go()
		else if (item.go.startsWith('/api/')) window.location.assign(item.go)
		else void navigate({ href: item.go })
	}

	return (
		<>
			<CommandPaletteTrigger target={JUMP_ID} label="Jump to a pathway, section or action" class="ocp-jump-trigger" shortcut={<kbd>⌘K</kbd>}>
				<span class="ocp-jump-trigger-text">Jump to…</span>
			</CommandPaletteTrigger>
			<CommandPalette
				id={JUMP_ID}
				items={items()}
				extraGroups={extraGroups()}
				onQuery={onQuery}
				recentIds={recent()}
				placeholder="A pathway, a section number, an action…"
				inputLabel="Jump to"
				listLabel="Places and actions"
				emptyMessage="Nothing matches. Try a pathway's name, a section number such as 4.4.2, or an action such as 'publish'."
				onOpen={() => {
					if (loaded) return
					loaded = true
					void jumpIndex().then(setDocuments).catch(() => {
						loaded = false
					})
				}}
				onSelect={select}
			/>
		</>
	)
}
