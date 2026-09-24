/**
 * The page's one editing toolbar, sticky at the top of the text column. It acts on the
 * section editor that last held the caret (`workspace.editors.active()`): that editor's
 * own formatting items, then Insert, Cite and Link, the point-of-care switch when the
 * caret is in a check list, and Undo and Redo. Every button keeps the caret where it is
 * (mousedown never takes focus), so a tool acts on the selection the author made.
 *
 * Shortcuts: ⌘⇧C opens Cite and ⌘⇧K opens Link (⌘K alone is the page's jump); '/' on
 * an empty line opens Insert at the caret.
 */

import './toolbar.css'

import { EditorToolbar } from '@aicolab/ui-solid/prosekit-solid'
import type { JSX } from '@solidjs/web'
import { createMemo, createSignal, For, onSettled, Show, useContext } from 'solid-js'
import { setSlashOpener } from '#/editors/SectionView.tsx'
import { DocumentContext, sectionLabel, type TableAction } from '#/lifecycle/workspace.ts'
import { CitePopover } from './CitePopover.tsx'
import { InsertMenu } from './InsertMenu.tsx'
import { LinkPopover, type LinkTab } from './LinkPopover.tsx'
import { createToolPopover, ToolPopover } from './popover.tsx'

const ANCHOR = {
	insert: '--ocp-tool-insert',
	cite: '--ocp-tool-cite',
	link: '--ocp-tool-link',
	table: '--ocp-tool-table',
	slash: '--ocp-tool-slash',
} as const

export function StageToolbar() {
	const workspace = useContext(DocumentContext)
	const control = () => workspace.editors.active()
	const canEdit = () => workspace.role !== 'viewer' && control() !== null
	const where = createMemo(() => {
		const id = control()?.sectionId
		const section = id ? workspace.sections().find((s) => s.id === id) : undefined
		return section ? sectionLabel(section) : null
	})
	// The control's plain reads are not reactive; its update-driven `canUndo` is, and
	// ticks on every caret move, so reading it first makes the check-list state follow.
	const checkList = createMemo(() => {
		const c = control()
		if (!c) return null
		c.canUndo()
		return c.inCheckList() ? { pointOfCare: c.checkListPointOfCare() } : null
	})
	const inTable = createMemo(() => {
		const c = control()
		if (!c) return false
		c.canUndo()
		return c.inTable()
	})
	const tableTools: readonly { action: TableAction; label: string; title: string }[] = [
		{ action: 'rowAbove', label: 'Row above', title: 'Add a row above the caret’s' },
		{ action: 'rowBelow', label: 'Row below', title: 'Add a row below the caret’s' },
		{ action: 'columnBefore', label: 'Column before', title: 'Add a column before the caret’s' },
		{ action: 'columnAfter', label: 'Column after', title: 'Add a column after the caret’s' },
		{ action: 'deleteRow', label: 'Remove row', title: 'Remove the caret’s row' },
		{ action: 'deleteColumn', label: 'Remove column', title: 'Remove the caret’s column' },
		{ action: 'deleteTable', label: 'Remove table', title: 'Remove the whole table' },
	]

	const insert = createToolPopover()
	const cite = createToolPopover()
	const link = createToolPopover()
	const table = createToolPopover()
	const [insertAnchor, setInsertAnchor] = createSignal<string>(ANCHOR.insert)
	const [slashAt, setSlashAt] = createSignal<DOMRect | null>(null)
	const [linkTab, setLinkTab] = createSignal<LinkTab | null>(null)

	// The caret the '/' menu opened at, re-read as the page scrolls under the open menu.
	let slashCaret: (() => DOMRect) | null = null
	const openInsert = (sectionId: string, caret: () => DOMRect) => {
		workspace.editors.activate(sectionId)
		slashCaret = caret
		setSlashAt(caret())
		setInsertAnchor(ANCHOR.slash)
		// The anchor moves to the caret before the panel measures against it.
		requestAnimationFrame(() => insert.show())
	}
	const openLink = (tab: LinkTab | null) => {
		setLinkTab(tab)
		link.show()
	}
	const refocus = () => control()?.focus()

	onSettled(() => {
		setSlashOpener(openInsert)
		const onScroll = () => {
			if (slashCaret && insert.open() && insertAnchor() === ANCHOR.slash) setSlashAt(slashCaret())
		}
		window.addEventListener('scroll', onScroll, { capture: true, passive: true })
		// Capture, on the window: ⌘⇧K must reach Link before the page's ⌘K jump sees it.
		const onKey = (event: KeyboardEvent) => {
			if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return
			const key = event.key.toLowerCase()
			if (key !== 'c' && key !== 'k') return
			if (!canEdit()) return
			event.preventDefault()
			event.stopPropagation()
			if (key === 'c') cite.show()
			else openLink(null)
		}
		window.addEventListener('keydown', onKey, { capture: true })
		return () => {
			window.removeEventListener('keydown', onKey, { capture: true })
			window.removeEventListener('scroll', onScroll, { capture: true })
			setSlashOpener(() => {})
		}
	})

	return (
		<div class="ocp-stage-toolbar">
			<p class="ocp-stage-where" title={where() ?? undefined} data-empty={where() ? undefined : ''}>
				{where() ?? 'Select a section to edit'}
			</p>
			<EditorToolbar
				items={control()?.toolbar() ?? []}
				class="ocp-stage-tools"
				label="Editing tools"
			>
				<span class="aic-prosekit-toolbar-separator" aria-hidden="true" />
				<ToolButton
					label="Insert"
					title="Insert a box, timeframe, table, image… (or type / on an empty line)"
					anchor={ANCHOR.insert}
					popoverTarget={insert.id}
					pressed={insert.open()}
					disabled={!canEdit()}
					onPress={() => {
						slashCaret = null
						setSlashAt(null)
						setInsertAnchor(ANCHOR.insert)
					}}
				/>
				<ToolButton
					label="Cite"
					title="Cite a reference at the caret (⌘⇧C)"
					anchor={ANCHOR.cite}
					popoverTarget={cite.id}
					pressed={cite.open()}
					disabled={!canEdit()}
				/>
				<ToolButton
					label="Link"
					title="Link the selected words (⌘⇧K)"
					anchor={ANCHOR.link}
					popoverTarget={link.id}
					pressed={link.open()}
					disabled={!canEdit()}
					onPress={() => setLinkTab(null)}
				/>
				<Show when={checkList()}>
					{(list) => (
						<>
							<span class="aic-prosekit-toolbar-separator" aria-hidden="true" />
							<ToolButton
								label="Point of care"
								title="Marks this check list for the quick reference guide"
								pressed={list().pointOfCare}
								disabled={!canEdit()}
								onPress={() => control()?.toggleCheckListPointOfCare()}
							/>
						</>
					)}
				</Show>
				{/* With the caret in a table: one Table button, whose panel holds the row and
				    column actions, so the bar never widens. Columns are resized by dragging their
				    edges in the table itself (section.css). */}
				<Show when={inTable()}>
					<span class="aic-prosekit-toolbar-separator" aria-hidden="true" />
					<ToolButton
						label="Table"
						title="Add or remove rows and columns of the table the caret is in"
						anchor={ANCHOR.table}
						popoverTarget={table.id}
						pressed={table.open()}
						disabled={!canEdit()}
					/>
				</Show>
				<span class="aic-prosekit-toolbar-separator" aria-hidden="true" />
				<ToolButton
					label="Undo"
					title="Undo (⌘Z)"
					disabled={!canEdit() || !control()?.canUndo()}
					onPress={() => control()?.undo()}
				/>
				<ToolButton
					label="Redo"
					title="Redo (⌘⇧Z)"
					disabled={!canEdit() || !control()?.canRedo()}
					onPress={() => control()?.redo()}
				/>
			</EditorToolbar>

			<Show when={slashAt()}>
				{(at) => (
					<span
						class="ocp-slash-anchor"
						aria-hidden="true"
						style={{
							'anchor-name': ANCHOR.slash,
							left: `${at().left}px`,
							top: `${at().top}px`,
							height: `${at().height}px`,
						}}
					/>
				)}
			</Show>

			<ToolPopover
				handle={insert}
				anchor={insertAnchor()}
				label="Insert"
				class="ocp-insert-popover"
				onEscape={refocus}
			>
				<InsertMenu
					control={control()}
					documentId={workspace.documentId}
					close={() => insert.hide()}
					onCrossReference={() => {
						insert.hide()
						setInsertAnchor(ANCHOR.insert)
						openLink('document')
					}}
				/>
			</ToolPopover>
			<ToolPopover
				handle={cite}
				anchor={ANCHOR.cite}
				label="Cite a reference"
				class="ocp-cite-popover"
				onEscape={refocus}
			>
				<CitePopover
					control={control()}
					documentId={workspace.documentId}
					close={() => cite.hide()}
				/>
			</ToolPopover>
			<ToolPopover
				handle={link}
				anchor={ANCHOR.link}
				label="Link"
				class="ocp-link-popover"
				onEscape={refocus}
			>
				<LinkPopover control={control()} tab={linkTab()} close={() => link.hide()} />
			</ToolPopover>
			<ToolPopover
				handle={table}
				anchor={ANCHOR.table}
				label="Table"
				class="ocp-table-popover"
				onEscape={refocus}
			>
				<ul class="ocp-link-list ocp-table-menu">
					<For each={tableTools}>
						{(tool) => (
							<li>
								<button
									type="button"
									class="ocp-link-target"
									title={tool.title}
									onClick={() => {
										table.hide()
										control()?.tableAction(tool.action)
									}}
								>
									{tool.label}
								</button>
							</li>
						)}
					</For>
				</ul>
			</ToolPopover>
		</div>
	)
}

/** A toolbar button in the editor toolbar's own style. It never takes focus from the
 *  text; one that opens a panel is that panel's `popovertarget`, so the browser handles
 *  open, shut and light dismiss. */
function ToolButton(props: {
	label: string
	title: string
	anchor?: string
	popoverTarget?: string
	pressed?: boolean
	disabled?: boolean
	onPress?: () => void
}) {
	const style = (): JSX.CSSProperties | undefined =>
		props.anchor ? { 'anchor-name': props.anchor } : undefined
	return (
		<button
			type="button"
			class="aic-prosekit-tool ocp-stage-tool"
			style={style()}
			data-state={props.pressed ? 'on' : 'off'}
			aria-pressed={props.popoverTarget ? undefined : props.pressed ? 'true' : 'false'}
			aria-expanded={props.popoverTarget ? (props.pressed ? 'true' : 'false') : undefined}
			title={props.title}
			disabled={props.disabled}
			popovertarget={props.popoverTarget}
			onMouseDown={(event) => event.preventDefault()}
			onClick={() => props.onPress?.()}
		>
			{props.label}
		</button>
	)
}
