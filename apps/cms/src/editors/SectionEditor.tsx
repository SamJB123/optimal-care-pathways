/**
 * One section's live editor. Mounted per section on a step page; the tier is a LIVE
 * signal (a role change flips editability in place and re-attaches the stream), the
 * body is the room's yjs doc bound through @y/prosemirror, undo is local-only, and the
 * caret is published as presence.
 *
 * The editor draws no toolbar of its own: it registers an EditorControl with the page,
 * and the page's one toolbar (at the top of the text column) acts on whichever editor
 * holds the caret. The same control lets the margin tick guidance done, and the Insert,
 * Cite and Link tools put content in at the caret. Typing '/' on an empty line opens the
 * Insert menu.
 */

import '@aicolab/ui-solid/prosekit-solid/styles.css'
import './section.css'

import type { DocHandle, DocRoomClient } from '@aicolab/app-kit/doc-room/client'
import { Notice, Presence } from '@aicolab/ui-solid'
import {
	createEditorUi,
	createEditorUpdateSource,
	defineToolbarContribution,
	type ToolbarContribution,
} from '@aicolab/ui-solid/prosekit-solid'
import { encodeSelectionCursor, remoteCursorsKey } from '@aicolab/ui-solid/prosekit-solid/presence'
import { createEditor, defineKeymap, union } from '@prosekit/core'
import type { Mark, MarkType, Node as PmNode, ResolvedPos } from '@prosekit/pm/model'
import { TextSelection } from '@prosekit/pm/state'
import { configureYProsemirror } from '@y/prosemirror'
import { UndoManager } from '@y/y'
import { createSignal, onSettled, Show, untrack } from 'solid-js'
import type { GuidanceMode } from '#/content/blocks.tsx'
import type { DerivedView } from '#/content/derived.ts'
import { RenderedBody } from '#/content/render.tsx'
import { type JsonNode, jsonOf } from '#/content/schema.ts'
import type { EditorControl } from '#/lifecycle/workspace.ts'
import { createSectionExtension } from './extension.ts'

/** The extent of the link (of any of `types`) around a caret: the run of adjacent text in
 *  its paragraph carrying the same mark. */
function linkRangeAt(
	$pos: ResolvedPos,
	types: readonly (MarkType | undefined)[],
): { from: number; to: number } | null {
	const parent = $pos.parent
	const start = $pos.start()
	const offset = $pos.parentOffset
	const runs: { from: number; to: number; mark: Mark }[] = []
	parent.forEach((child, childOffset) => {
		const mark = child.marks.find((m) => types.some((t) => t === m.type))
		if (mark)
			runs.push({ from: start + childOffset, to: start + childOffset + child.nodeSize, mark })
	})
	const hit = runs.find((r) => r.from - start <= offset && offset <= r.to - start)
	if (!hit) return null
	let from = hit.from
	let to = hit.to
	for (const r of runs) {
		if (!r.mark.eq(hit.mark)) continue
		if (r.to === from) from = r.from
		if (r.from === to) to = r.to
	}
	return { from, to }
}

export default function SectionEditor(props: {
	room: DocRoomClient
	handle: DocHandle
	sectionId: string
	/** The section's resting body, shown in the editor's place until the live body is
	 *  bound, so the page keeps its shape while the room syncs. Null when unknown. */
	resting: JsonNode | null
	/** The page's derived view (citation numbers, timeframes) the block views read. */
	derived: DerivedView
	guidance: GuidanceMode
	/** Register this editor's control with the page; returns the unregister. */
	register: (control: EditorControl) => () => void
	/** The caret came into this editor: the page's toolbar now acts on it. */
	onActive: () => void
	/** '/' on an empty line: open the Insert menu at the caret, whose box is read afresh
	 *  whenever it is asked for (the page can scroll while the menu is open). */
	onSlash: (caret: () => DOMRect) => void
}) {
	// The slot upstream is keyed by (section, handle, room): a different section is a
	// different mount, so these are constants of this instance, read once and untracked
	// (a tracked top-level prop read is the STRICT_READ_UNTRACKED warning).
	const { room, handle, sectionId, guidance, resting } = untrack(() => ({
		room: props.room,
		handle: props.handle,
		sectionId: props.sectionId,
		guidance: props.guidance,
		resting: props.resting,
	}))
	const docKey = `doc:${sectionId}`
	const open = handle.openBody()
	const ytype = open.doc.get('')
	const [tier, setTier] = createSignal(handle.role())
	const editable = () => tier() === 'editor'
	const [ready, setReady] = createSignal(false)
	const updates = createEditorUpdateSource()
	let editorMounted = false

	let publishTimer: ReturnType<typeof setTimeout> | null = null
	const publishCaret = (): void => {
		if (publishTimer) return
		publishTimer = setTimeout(() => {
			publishTimer = null
			room.setCursor(docKey, editor.view.hasFocus() ? encodeSelectionCursor(editor.view) : null)
		}, 120)
	}

	const undoManager = new UndoManager(ytype)
	const editor = createEditor({
		extension: union(
			createSectionExtension({
				derived: () => props.derived,
				guidance,
				undoManager,
				isEditable: editable,
				onUpdate: (view, prevState) => {
					updates.notify()
					if (!view.state.selection.eq(prevState.selection)) publishCaret()
				},
				onFocusChange: (focus) => {
					if (focus) {
						publishCaret()
						props.onActive()
					} else room.setCursor(docKey, null)
				},
				getRemoteCursors: () =>
					room.cursors.for(docKey).map((rc) => ({
						userId: rc.userId,
						name: rc.name,
						anchor: rc.cursor.anchor,
						head: rc.cursor.head,
					})),
			}),
			defineKeymap({
				// '/' on an empty line is the Insert menu, not a slash.
				'/': (state) => {
					const { $from, empty } = state.selection
					if (!empty || $from.parent.type.name !== 'paragraph' || $from.parent.content.size > 0)
						return false
					props.onSlash(caretRect)
					return true
				},
			}),
		),
	})

	const caretRect = (): DOMRect => {
		const at = editor.view.coordsAtPos(editor.view.state.selection.from)
		return new DOMRect(at.left, at.top, 1, at.bottom - at.top)
	}

	/** The list node the caret sits in, with its position. */
	const enclosingList = (): { node: PmNode; pos: number } | null => {
		const $from = editor.view.state.selection.$from
		for (let depth = $from.depth; depth > 0; depth--) {
			const node = $from.node(depth)
			if (node.type.name === 'list') return { node, pos: $from.before(depth) }
		}
		return null
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

	const listKindActive = (kind: string): boolean => enclosingList()?.node.attrs.kind === kind

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
		mark(
			'heading-3',
			'H',
			'A heading inside the section',
			() => editor.commands.toggleHeading({ level: 3 }),
			() => editor.nodes.heading.isActive({ level: 3, textAlign: null }),
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
			'Check list (actions for this step)',
			() => editor.commands.toggleCheckList(),
			() => listKindActive('check'),
		),
	]

	const ui = createEditorUi({
		updates,
		toolbar,
		isMounted: () => editorMounted,
		canUndo: () => undoManager.canUndo(),
		canRedo: () => undoManager.canRedo(),
	})

	const control: EditorControl = {
		sectionId,
		toolbar: () => (editable() ? ui().toolbar : []),
		canUndo: () => ui().canUndo,
		canRedo: () => ui().canRedo,
		undo: () => undoManager.undo(),
		redo: () => undoManager.redo(),
		focus: () => editor.focus(),
		body: () => jsonOf(editor.view.state.doc),
		setGuidanceDone(index, done, by) {
			const { state } = editor.view
			const notes: { node: PmNode; pos: number }[] = []
			state.doc.descendants((node, pos) => {
				if (node.type.name !== 'guidance') return true
				notes.push({ node, pos })
				return false
			})
			const found = notes[index]
			if (!found) return
			editor.view.dispatch(
				state.tr.setNodeMarkup(found.pos, undefined, {
					...found.node.attrs,
					done,
					doneBy: done ? by : '',
					doneAt: done ? Date.now() : 0,
				}),
			)
		},
		insert(nodes: JsonNode[]) {
			const { state } = editor.view
			const content = nodes.map((json) => state.schema.nodeFromJSON(json))
			const { $from } = state.selection
			const inline = content.every((n) => n.isInline)
			if (inline) {
				editor.view.dispatch(
					state.tr
						.replaceSelectionWith(content[0] ?? state.schema.text(' '), false)
						.scrollIntoView(),
				)
				for (const node of content.slice(1))
					editor.view.dispatch(editor.view.state.tr.replaceSelectionWith(node, false))
			} else {
				// A block goes in place of the empty line it was asked for from, else after the
				// block the caret is in.
				const emptyLine =
					$from.parent.type.name === 'paragraph' &&
					$from.parent.content.size === 0 &&
					$from.depth > 0
				const from = emptyLine ? $from.before($from.depth) : $from.after(1)
				const to = emptyLine ? $from.after($from.depth) : from
				const tr = state.tr.replaceWith(from, to, content)
				const after = Math.min(tr.doc.content.size, from + 1)
				editor.view.dispatch(
					tr.setSelection(TextSelection.near(tr.doc.resolve(after))).scrollIntoView(),
				)
			}
			editor.focus()
		},
		link(target) {
			const { state } = editor.view
			const linkMark = state.schema.marks.link
			const sectionLink = state.schema.marks.sectionLink
			// With only a caret, the link it sits in is the range: remove or retarget all of it.
			const around = state.selection.empty
				? linkRangeAt(state.selection.$from, [linkMark, sectionLink])
				: null
			const from = around?.from ?? state.selection.from
			const to = around?.to ?? state.selection.to
			let tr = state.tr
			if (linkMark) tr = tr.removeMark(from, to, linkMark)
			if (sectionLink) tr = tr.removeMark(from, to, sectionLink)
			if (target && 'href' in target && linkMark)
				tr = tr.addMark(from, to, linkMark.create({ href: target.href }))
			if (target && 'address' in target && sectionLink)
				tr = tr.addMark(from, to, sectionLink.create({ address: target.address }))
			editor.view.dispatch(tr)
			editor.focus()
		},
		inCheckList: () => enclosingList()?.node.attrs.kind === 'check',
		checkListPointOfCare: () => enclosingList()?.node.attrs.pointOfCare === true,
		toggleCheckListPointOfCare() {
			const list = enclosingList()
			if (list?.node.attrs.kind !== 'check') return
			editor.view.dispatch(
				editor.view.state.tr.setNodeMarkup(list.pos, undefined, {
					...list.node.attrs,
					pointOfCare: list.node.attrs.pointOfCare !== true,
				}),
			)
		},
		selectedText: () => {
			const { from, to } = editor.view.state.selection
			return editor.view.state.doc.textBetween(from, to, ' ')
		},
	}

	let host!: HTMLDivElement
	onSettled(() => {
		editor.mount(host)
		// Binding applies the doc's content at once, and the node views that content needs
		// render Solid roots (which flush): not allowed inside the settle, so a microtask later.
		let unmounted = false
		queueMicrotask(() => {
			if (unmounted) return
			const bound = configureYProsemirror({ ytype })(editor.view.state, editor.view.dispatch)
			if (!bound) console.error('[section editor] configureYProsemirror did not bind')
			editorMounted = true
			updates.notify()
		})
		const unregister = props.register(control)
		const applyTier = (t: ReturnType<typeof handle.role>): void => {
			setTier(t)
			try {
				editor.view.dispatch(editor.view.state.tr)
			} catch {
				/* view mid-teardown */
			}
		}
		void handle.ready.then(() => applyTier(handle.role()))
		const offRole = handle.onRole((t) => {
			applyTier(t)
			open.reattach()
		})
		const notifyUndo = () => updates.notify()
		undoManager.on('stack-item-added', notifyUndo)
		undoManager.on('stack-item-popped', notifyUndo)
		const unsubscribeCursors = room.cursors.subscribe((key) => {
			if (key !== docKey) return
			try {
				editor.view.dispatch(editor.view.state.tr.setMeta(remoteCursorsKey, true))
			} catch {
				/* view mid-teardown */
			}
		})
		void open.whenReady.then(() => setReady(true))
		return () => {
			unmounted = true
			unregister()
			editorMounted = false
			unsubscribeCursors()
			offRole()
			if (publishTimer) clearTimeout(publishTimer)
			room.setCursor(docKey, null)
			undoManager.off('stack-item-added', notifyUndo)
			undoManager.off('stack-item-popped', notifyUndo)
			undoManager.destroy()
			editor.mount(null)
			open.close()
		}
	})

	return (
		<Presence class="aic-prosekit ocp-section-editor">
			<Show when={ready() && !editable()}>
				<Notice class="ocp-section-viewing" colorBase="info" variant="text">
					Read only: your role on this document is viewer.
				</Notice>
			</Show>
			{/* Until the live body is bound the resting body stands in its place and the editor
			    (mounted, syncing) is kept out of the layout: the section keeps its height. */}
			<Show when={!ready() && resting}>
				{(body) => <RenderedBody body={body()} derived={props.derived} guidance={guidance} />}
			</Show>
			<div
				class="aic-prosekit-editor ocp-body"
				data-guidance={guidance}
				data-binding={!ready() ? '' : undefined}
				aria-busy={!ready() ? 'true' : undefined}
				// In a list, Tab indents (extension.ts): the way out is told.
				aria-description="Escape leaves the text; Tab then moves on."
				ref={host}
			/>
		</Presence>
	)
}
