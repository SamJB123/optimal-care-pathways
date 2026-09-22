/**
 * One section's live editor. Mounted per section on a step page; the tier is a LIVE
 * signal (a role change flips editability in place and re-attaches the stream), the
 * body is the room's yjs doc bound through @y/prosemirror, undo is local-only, and the
 * caret is published as presence.
 *
 * The template's own blocks (banner, timeframe, guidance, check items, placeholders,
 * citations) render through the schema's DOM output and section.css; there is no
 * bespoke node view yet, so they edit as ordinary structured blocks.
 */

import '@aicolab/ui-solid/prosekit-solid/styles.css'
import './section.css'

import type { DocHandle, DocRoomClient } from '@aicolab/app-kit/doc-room/client'
import { Button, Notice, Presence } from '@aicolab/ui-solid'
import {
	createEditorUi,
	createEditorUpdateSource,
	defineToolbarContribution,
	EditorToolbar,
	type ToolbarContribution,
} from '@aicolab/ui-solid/prosekit-solid'
import { encodeSelectionCursor, remoteCursorsKey } from '@aicolab/ui-solid/prosekit-solid/presence'
import { createEditor } from '@prosekit/core'
import { configureYProsemirror } from '@y/prosemirror'
import { UndoManager } from '@y/y'

import { createSignal, onSettled, Show } from 'solid-js'
import { createSectionExtension } from './extension.ts'

export default function SectionEditor(props: {
	room: DocRoomClient
	handle: DocHandle
	sectionId: string
}) {
	const docKey = `doc:${props.sectionId}`
	const open = props.handle.openBody()
	const ytype = open.doc.get('')
	const [tier, setTier] = createSignal(props.handle.role())
	const editable = () => tier() === 'editor'
	const [ready, setReady] = createSignal(false)
	const updates = createEditorUpdateSource()
	let editorMounted = false

	let publishTimer: ReturnType<typeof setTimeout> | null = null
	const publishCaret = (): void => {
		if (publishTimer) return
		publishTimer = setTimeout(() => {
			publishTimer = null
			props.room.setCursor(
				docKey,
				editor.view.hasFocus() ? encodeSelectionCursor(editor.view) : null,
			)
		}, 120)
	}

	const undoManager = new UndoManager(ytype)
	const editor = createEditor({
		extension: createSectionExtension({
			undoManager,
			isEditable: editable,
			onUpdate: (view, prevState) => {
				updates.notify()
				if (!view.state.selection.eq(prevState.selection)) publishCaret()
			},
			onFocusChange: (focus) => {
				if (focus) publishCaret()
				else props.room.setCursor(docKey, null)
			},
			getRemoteCursors: () =>
				props.room.cursors.for(docKey).map((rc) => ({
					userId: rc.userId,
					name: rc.name,
					anchor: rc.cursor.anchor,
					head: rc.cursor.head,
				})),
		}),
	})

	const toggleLink = (): void => {
		if (editor.marks.link.isActive()) {
			editor.commands.removeLink()
			return
		}
		const href = window.prompt('Link URL:')?.trim()
		if (href) editor.commands.addLink({ href })
	}

	/** Whether the selection sits in a list of `kind` (ProseKit's typed check names only
	 *  its own kinds, so this reads the node directly). */
	const listKindActive = (kind: string): boolean => {
		const $from = editor.view.state.selection.$from
		for (let depth = $from.depth; depth > 0; depth--) {
			const node = $from.node(depth)
			if (node.type.name === 'list') return node.attrs.kind === kind
		}
		return false
	}

	const mark = (
		id: string,
		label: string,
		title: string,
		run: () => void,
		active: () => boolean,
		style?: Record<string, string | number>,
	) =>
		defineToolbarContribution({ id, label, title, run, style }, () => ({
			active: active(),
			disabled: false,
		}))

	const toolbar: readonly ToolbarContribution[] = [
		mark(
			'bold',
			'B',
			'Bold (⌘B)',
			() => editor.commands.toggleBold(),
			() => editor.marks.bold.isActive(),
			{ 'font-weight': 700 },
		),
		mark(
			'italic',
			'I',
			'Italic (⌘I)',
			() => editor.commands.toggleItalic(),
			() => editor.marks.italic.isActive(),
			{ 'font-style': 'italic' },
		),
		mark(
			'underline',
			'U',
			'Underline (⌘U)',
			() => editor.commands.toggleUnderline(),
			() => editor.marks.underline.isActive(),
			{ 'text-decoration': 'underline' },
		),
		mark(
			'strike',
			'S',
			'Strikethrough',
			() => editor.commands.toggleStrike(),
			() => editor.marks.strike.isActive(),
			{ 'text-decoration': 'line-through' },
		),
		mark(
			'superscript',
			'x²',
			'Superscript',
			() => editor.commands.toggleSuperscript(),
			() => editor.marks.superscript.isActive(),
		),
		mark(
			'subscript',
			'x₂',
			'Subscript',
			() => editor.commands.toggleSubscript(),
			() => editor.marks.subscript.isActive(),
		),
		mark('link', '🔗', 'Link', toggleLink, () => editor.marks.link.isActive()),
		mark(
			'heading-2',
			'H2',
			'Heading',
			() => editor.commands.toggleHeading({ level: 2 }),
			() => editor.nodes.heading.isActive({ level: 2 }),
		),
		mark(
			'heading-3',
			'H3',
			'Subheading',
			() => editor.commands.toggleHeading({ level: 3 }),
			() => editor.nodes.heading.isActive({ level: 3 }),
		),
		mark(
			'bullet-list',
			'•',
			'Bullet list',
			() => editor.commands.toggleBulletList(),
			() => listKindActive('bullet'),
		),
		mark(
			'ordered-list',
			'1.',
			'Numbered list',
			() => editor.commands.toggleOrderedList(),
			() => listKindActive('ordered'),
		),
		mark(
			'check-list',
			'✓',
			'Check item (an action for this step)',
			() => editor.commands.toggleCheckList(),
			() => listKindActive('check'),
		),
		mark(
			'blockquote',
			'❝',
			'Quote',
			() => editor.commands.toggleBlockquote(),
			() => editor.nodes.blockquote.isActive(),
		),
		mark(
			'table',
			'▦',
			'Insert table',
			() => editor.commands.insertTable({ row: 3, col: 3, header: true }),
			() => editor.nodes.table.isActive(),
		),
		mark(
			'rule',
			'—',
			'Horizontal rule',
			() => editor.commands.insertHorizontalRule(),
			() => false,
		),
	]

	const ui = createEditorUi({
		updates,
		toolbar,
		isMounted: () => editorMounted,
		canUndo: () => undoManager.canUndo(),
		canRedo: () => undoManager.canRedo(),
	})

	let host!: HTMLDivElement
	onSettled(() => {
		editor.mount(host)
		const bound = configureYProsemirror({ ytype })(editor.view.state, editor.view.dispatch)
		if (!bound) console.error('[section editor] configureYProsemirror did not bind')
		editorMounted = true
		updates.notify()
		const applyTier = (t: ReturnType<typeof props.handle.role>): void => {
			setTier(t)
			try {
				editor.view.dispatch(editor.view.state.tr)
			} catch {
				/* view mid-teardown */
			}
		}
		void props.handle.ready.then(() => applyTier(props.handle.role()))
		const offRole = props.handle.onRole((t) => {
			applyTier(t)
			open.reattach()
		})
		const notifyUndo = () => updates.notify()
		undoManager.on('stack-item-added', notifyUndo)
		undoManager.on('stack-item-popped', notifyUndo)
		const unsubscribeCursors = props.room.cursors.subscribe((key) => {
			if (key !== docKey) return
			try {
				editor.view.dispatch(editor.view.state.tr.setMeta(remoteCursorsKey, true))
			} catch {
				/* view mid-teardown */
			}
		})
		void open.whenReady.then(() => setReady(true))
		return () => {
			editorMounted = false
			unsubscribeCursors()
			offRole()
			if (publishTimer) clearTimeout(publishTimer)
			props.room.setCursor(docKey, null)
			undoManager.off('stack-item-added', notifyUndo)
			undoManager.off('stack-item-popped', notifyUndo)
			undoManager.destroy()
			editor.mount(null)
			open.close()
		}
	})

	return (
		<Presence class="aic-prosekit ocp-section-editor">
			<EditorToolbar items={editable() ? ui().toolbar : []}>
				<Show
					when={editable()}
					fallback={
						<Notice class="ocp-section-viewing" colorBase="info" variant="text">
							viewing — your role on this pathway is read-only
						</Notice>
					}
				>
					<span class="aic-prosekit-toolbar-separator" aria-hidden="true" />
					<Button
						variant="text"
						title="Undo (⌘Z)"
						class="aic-prosekit-tool"
						disabled={!ui().canUndo}
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => undoManager.undo()}
					>
						<span aria-hidden="true">↩</span>
					</Button>
					<Button
						variant="text"
						title="Redo (⇧⌘Z)"
						class="aic-prosekit-tool"
						disabled={!ui().canRedo}
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => undoManager.redo()}
					>
						<span aria-hidden="true">↪</span>
					</Button>
				</Show>
			</EditorToolbar>
			<div
				class="aic-prosekit-editor ocp-body"
				aria-busy={!ready() ? 'true' : undefined}
				ref={host}
			/>
		</Presence>
	)
}
