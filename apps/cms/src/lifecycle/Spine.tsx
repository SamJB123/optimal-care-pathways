/**
 * The workspace's spine (decisions U6, U13, U18, S13): the document as the template
 * orders it — the overview, the front matter, Steps 1–7, the back matter, the references
 * — on ui-solid's WorkspaceNavigation (on a phone the organism hides it and the jump and
 * the drawer carry the reader). The part being read opens beneath into its sections, each
 * with its mark (○ shared, ◐ own copy, ● written here), when it last changed, and who is
 * in it now. A subsection the team added can be dragged to a new place, or moved with
 * Alt+↑/↓; the template's own sections never move. Hidden sections stay out of the spine
 * unless the reader asks to see them, struck through. Below: where the document stands,
 * and the doors to review, publish, the editions, the preview and the published page.
 */

import {
	WorkspaceNavigation,
	WorkspaceNavigationGroup,
	WorkspaceNavigationItem,
	WorkspaceNavigationList,
} from '@aicolab/ui-solid'
import { useNavigate, useParams } from '@tanstack/solid-router'
import { createMemo, createSignal, For, Show, useContext } from 'solid-js'
import { documentName, numberLabel } from '#/lib/labels.ts'
import { partHref, previewHref, publishedHref, sectionAnchor } from '#/lib/links.ts'
import type { SectionWireRow } from '#/lib/live-topics.ts'
import { moveSection } from '#/server/structure-fns.ts'
import { atLeast, DocumentContext, MARK_GLYPH, markOf, partsOf } from './workspace.ts'
import './spine.css'

const initials = (name: string) =>
	name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((w) => w[0]?.toUpperCase() ?? '')
		.join('')

const shortAgo = (ms: number | null, now: number): string => {
	if (!ms) return ''
	const minutes = Math.round((now - ms) / 60_000)
	if (minutes < 60) return minutes < 1 ? 'now' : `${minutes}m`
	const hours = Math.round(minutes / 60)
	if (hours < 24) return `${hours}h`
	const days = Math.round(hours / 24)
	return days < 60 ? `${days}d` : `${Math.round(days / 30)}mo`
}

/** A part's leading mark in the spine: its step number, or a quiet rule. */
const partMark = (root: SectionWireRow) => (root.stepNumber && !root.parentId ? String(root.stepNumber) : '·')

export function Spine(props: { onRequestReview: () => void }) {
	const workspace = useContext(DocumentContext)
	const navigate = useNavigate()
	const params = useParams({ strict: false })
	const parts = createMemo(() => partsOf(workspace.sections(), workspace.showHidden()))
	const current = () => {
		const p = params()
		return 'part' in p && typeof p.part === 'string' ? p.part : null
	}
	const hiddenCount = () => workspace.sections().filter((s) => s.hidden && !s.apparatus).length

	const state = () => workspace.state()
	const changes = () => state().changes.length
	const review = () => state().review
	const reviewLine = () => {
		const r = review()
		const n = `${changes()} section${changes() === 1 ? '' : 's'}`
		if (!r && !state().published) return `${n} written for the first edition, not yet in review`
		if (!r) return changes() > 0 ? `${n} changed, not yet in review` : 'Nothing changed since publishing'
		if (r.decision === 'approved') return 'Review approved'
		if (r.decision === 'changes_requested') return 'Changes asked for in review'
		return `In review: ${r.decided} of ${r.total} decided`
	}
	const editionLine = () => {
		const s = state()
		return s.published
			? `Edition ${s.published.versionNo}${s.published.label ? `, ${s.published.label}` : ''} published · drafting edition ${s.draft.versionNo}`
			: `Not yet published · drafting edition ${s.draft.versionNo}`
	}

	return (
		<WorkspaceNavigation
			label="Document spine"
			class="ocp-spine"
			brand={
				<div class="ocp-spine-brand" style={{ 'view-transition-name': `ocp-name-${workspace.document.slug}` }}>
					<span class="ocp-spine-name">{documentName(workspace.document)}</span>
					<span class="ocp-spine-edition">{editionLine()}</span>
				</div>
			}
			footer={
				<Show when={hiddenCount() > 0}>
					<label class="ocp-spine-hidden">
						<input type="checkbox" checked={workspace.showHidden()} onChange={(e) => workspace.setShowHidden(e.currentTarget.checked)} />
						Show hidden sections ({hiddenCount()})
					</label>
				</Show>
			}
		>
			<WorkspaceNavigationGroup id="ocp-spine-parts" label="The document">
				<WorkspaceNavigationItem
					label="Overview"
					mark="◇"
					current={current() === null}
					onSelect={() => void navigate({ to: '/d/$documentId', params: { documentId: workspace.documentId } })}
				/>
				<For each={parts()}>
					{(part) => (
						<>
							<WorkspaceNavigationItem
								label={part.label}
								mark={partMark(part.root)}
								current={current() === part.key}
								muted={part.root.hidden}
								class={{ 'ocp-spine-hidden-part': part.root.hidden }}
								onSelect={() => void navigate({ href: partHref(workspace.documentId, part.key) })}
							/>
							{/* The part being read opens in place, beneath its own entry. */}
							<Show when={current() === part.key}>
								<li class="ocp-spine-part-open" role="none">
									<PartSections root={part.root} />
								</li>
							</Show>
						</>
					)}
				</For>
				<WorkspaceNavigationItem
					label="Reference list"
					mark="¶"
					current={current() === 'references'}
					onSelect={() => void navigate({ to: '/d/$documentId/references', params: { documentId: workspace.documentId } })}
				/>
			</WorkspaceNavigationGroup>

			<WorkspaceNavigationGroup id="ocp-spine-publish" label="Review and publish">
				<p class="ocp-spine-standing">{reviewLine()}</p>
				<WorkspaceNavigationList label="Review and publish">
					<Show when={changes() > 0}>
						<WorkspaceNavigationItem
							label={workspace.mode() === 'review' ? 'Back to writing' : 'Read the changes'}
							mark={workspace.mode() === 'review' ? '✎' : '⇄'}
							current={workspace.mode() === 'review'}
							onSelect={() => workspace.setMode(workspace.mode() === 'review' ? 'edit' : 'review')}
						/>
					</Show>
					<Show when={atLeast(workspace.role, 'member') && changes() > 0}>
						<WorkspaceNavigationItem
							label={review() && review()?.decision === null ? 'Ask for review again' : 'Ask for review'}
							mark="→"
							onSelect={props.onRequestReview}
						/>
					</Show>
					<Show when={state().central}>
						<WorkspaceNavigationItem label="Publish…" mark="↑" onSelect={() => workspace.openPublish()} />
					</Show>
					<WorkspaceNavigationItem
						label="Editions"
						mark="≡"
						current={current() === 'versions'}
						onSelect={() => void navigate({ to: '/d/$documentId/versions', params: { documentId: workspace.documentId } })}
					/>
					<WorkspaceNavigationItem label="Preview the draft" mark="◫" onSelect={() => void navigate({ href: previewHref(workspace.documentId) })} />
					<Show when={state().published}>
						<WorkspaceNavigationItem label="The published page" mark="↗" onSelect={() => window.location.assign(publishedHref(workspace.document.slug))} />
					</Show>
					<Show when={workspace.document.kind === 'core' && state().central}>
						<WorkspaceNavigationItem
							label="Suggestions from pathways"
							mark="✉"
							current={current() === 'suggestions'}
							onSelect={() => void navigate({ to: '/d/$documentId/suggestions', params: { documentId: workspace.documentId } })}
						/>
					</Show>
				</WorkspaceNavigationList>
			</WorkspaceNavigationGroup>
		</WorkspaceNavigation>
	)
}

/** The sections of the part being read, as a tree the reader can jump through. */
function PartSections(props: { root: SectionWireRow }) {
	const workspace = useContext(DocumentContext)
	const [now] = createSignal(Date.now())
	const [dragging, setDragging] = createSignal<string | null>(null)
	const [error, setError] = createSignal<string | null>(null)
	const rows = createMemo(() => {
		const all = workspace.sections()
		const byParent = new Map<string | null, SectionWireRow[]>()
		for (const s of all) byParent.set(s.parentId, [...(byParent.get(s.parentId) ?? []), s])
		const out: { section: SectionWireRow; depth: number }[] = []
		const walk = (node: SectionWireRow, depth: number) => {
			if (node.apparatus || (node.hidden && !workspace.showHidden())) return
			out.push({ section: node, depth })
			for (const child of (byParent.get(node.id) ?? []).sort((a, b) => a.orderIndex - b.orderIndex)) walk(child, depth + 1)
		}
		walk(props.root, 0)
		return out
	})
	const here = (sectionId: string) => workspace.presence().filter((p) => p.sectionId === sectionId)
	const canMove = (s: SectionWireRow) => s.added && atLeast(workspace.role, 'member')

	const jump = (s: SectionWireRow) => {
		workspace.focus(s.id)
		const target = document.getElementById(sectionAnchor(s.address))
		if (!target) return
		target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
		target.dataset.arrived = ''
		setTimeout(() => delete target.dataset.arrived, 1600)
	}

	const move = async (section: SectionWireRow, parentId: string, beforeId: string | null) => {
		setError(null)
		try {
			await moveSection({ data: { sectionId: section.id, parentId, beforeId } })
			await workspace.refreshState()
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		}
	}

	/** Alt+↑/↓: one place up or down among its siblings. */
	const nudge = (section: SectionWireRow, direction: -1 | 1) => {
		if (!section.parentId) return
		const siblings = workspace
			.sections()
			.filter((s) => s.parentId === section.parentId && !s.apparatus)
			.sort((a, b) => a.orderIndex - b.orderIndex)
		const at = siblings.findIndex((s) => s.id === section.id)
		const target = direction === -1 ? siblings[at - 1] : siblings[at + 2]
		if (direction === -1 && !target) return
		void move(section, section.parentId, target?.id ?? null)
	}

	return (
		<section class="ocp-spine-part" aria-label="Sections of this part">
			<Show when={error()}>{(text) => <p class="ocp-spine-error" role="alert">{text()}</p>}</Show>
			<ol class="ocp-spine-sections">
				<For each={rows()}>
					{(row) => (
						<li
							class="ocp-spine-section"
							data-depth={row.depth}
							data-mark={markOf(row.section)}
							data-hidden={row.section.hidden ? '' : undefined}
							data-current={workspace.focused() === row.section.id ? '' : undefined}
							data-drop={dragging() && dragging() !== row.section.id ? '' : undefined}
							draggable={canMove(row.section) ? 'true' : 'false'}
							onDragStart={(e) => {
								setDragging(row.section.id)
								e.dataTransfer?.setData('text/plain', row.section.id)
							}}
							onDragEnd={() => setDragging(null)}
							onDragOver={(e) => {
								if (dragging() && dragging() !== row.section.id && row.section.parentId) e.preventDefault()
							}}
							onDrop={(e) => {
								e.preventDefault()
								const moving = workspace.sections().find((s) => s.id === dragging())
								setDragging(null)
								if (moving && row.section.parentId) void move(moving, row.section.parentId, row.section.id)
							}}
						>
							<button
								type="button"
								class="ocp-spine-section-button"
								onClick={() => jump(row.section)}
								onKeyDown={(e) => {
									if (!e.altKey || !canMove(row.section)) return
									if (e.key === 'ArrowUp') {
										e.preventDefault()
										nudge(row.section, -1)
									} else if (e.key === 'ArrowDown') {
										e.preventDefault()
										nudge(row.section, 1)
									}
								}}
								title={canMove(row.section) ? 'Added by this document’s team: drag it, or Alt+↑/↓ to move it' : undefined}
							>
								<span class="ocp-spine-mark" aria-hidden="true">
									{MARK_GLYPH[markOf(row.section)]}
								</span>
								<span class="ocp-spine-section-label">
									<Show when={row.section.printedNumber}>{(n) => <span class="ocp-spine-number">{numberLabel(n())} </span>}</Show>
									{row.section.title ?? row.section.address}
								</span>
								<span class="ocp-spine-when">{shortAgo(row.section.updatedAt, now())}</span>
							</button>
							<Show when={here(row.section.id).length > 0}>
								<span class="ocp-spine-here" title={here(row.section.id).map((p) => p.name).join(', ')}>
									<For each={here(row.section.id).slice(0, 3)}>{(p) => <span>{initials(p.name)}</span>}</For>
								</span>
							</Show>
						</li>
					)}
				</For>
			</ol>
		</section>
	)
}
