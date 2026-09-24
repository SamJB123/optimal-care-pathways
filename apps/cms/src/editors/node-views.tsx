/**
 * The editor's node views for the template's blocks: the SAME Solid components the
 * read-only renderer uses (content/blocks.tsx), mounted by ui-solid's Solid node view
 * over the content schema's specs. Each view hands the component the node's attributes
 * (live), an attribute setter (the done tick, a resource's link) and ProseMirror's
 * content element as its child, so the node's children edit inside the component
 * exactly where the renderer draws them — with nothing between the block's element and
 * the content but that one element, which takes no space of its own.
 */

import {
	defineSolidNodeView,
	type NodeViewDOMSpec,
	type SolidNodeViewProps,
} from '@aicolab/ui-solid/prosekit-solid'
import { union } from '@prosekit/core'
import type { EditorView } from '@prosekit/pm/view'
import type { JSX } from '@solidjs/web'
import type { Component } from 'solid-js'
import {
	BannerBlock,
	type BlockProps,
	BoxBlock,
	CarePointBlock,
	CitationInline,
	ColumnBlock,
	ColumnsBlock,
	DerivedContext,
	FootnoteInline,
	GuidanceBlock,
	type GuidanceMode,
	GuidanceModeContext,
	PathwayMapBlock,
	ResourceBlock,
	ResourceListBlock,
	type TextAlign,
	TimeframeBlock,
	TimeframeSnapshotBlock,
	textAlignOf,
	VariantBlock,
	VariantsBlock,
} from '#/content/blocks.tsx'
import type { DerivedView } from '#/content/derived.ts'
import {
	type BannerAttrs,
	type BoxAttrs,
	boxAttrsOf,
	type GuidanceAttrs,
	guidanceAttrsOf,
	type ResourceAttrs,
} from '#/content/schema.ts'

/** Every node view is its own Solid root (ProseMirror owns the mount), so the page's
 *  context does not reach it: the derived view is handed in and provided around each. */
type Provide = <P extends object>(component: Component<P>) => Component<P>

const providing =
	(derived: () => DerivedView, guidance: GuidanceMode): Provide =>
	(Inner) =>
	(props) => (
		<DerivedContext value={derived}>
			<GuidanceModeContext value={guidance}>
				<Inner {...props} />
			</GuidanceModeContext>
		</DerivedContext>
	)

/** ProseMirror's content element: a div for block content, a span for inline content,
 *  classed so it takes no space of its own (section.css). */
const contentElement =
	(tag: 'div' | 'span', options: { presentation?: boolean } = {}): NodeViewDOMSpec =>
	() => {
		const element = document.createElement(tag)
		element.className = 'ocp-node-content'
		// Where the block is a list, its content element stands between the list and its
		// items: it is layout only, so assistive technology reads the items as the list's.
		if (options.presentation) element.setAttribute('role', 'presentation')
		return element
	}

/** A block component as a node view: attrs live, the content element as its child. */
function viewOf<Attrs extends object>(
	Block: Component<BlockProps<Attrs>>,
): Component<SolidNodeViewProps<Attrs>> {
	return (props) => (
		<Block attrs={props.attrs} edit={{ setAttrs: (patch) => props.setAttrs(patch) }}>
			{props.content}
		</Block>
	)
}

const none = () => ({})

/** Keep one alternative of a `variants` group: its blocks take the place of the whole
 *  group, in one transaction (so one undo brings the others back). */
export function keepVariant(view: EditorView, getPos: () => number | undefined): void {
	// A viewer's editor is read-only: the button is hidden (section.css), and a call that
	// gets through does nothing.
	if (!view.editable) return
	const pos = getPos()
	if (pos === undefined) return
	const variant = view.state.doc.nodeAt(pos)
	const $pos = view.state.doc.resolve(pos)
	if (!variant || variant.type.name !== 'variant' || $pos.parent.type.name !== 'variants') return
	view.dispatch(
		view.state.tr.replaceWith($pos.before(), $pos.after(), variant.content).scrollIntoView(),
	)
	view.focus()
}

const asAttrs =
	<T,>(read: (attrs: Record<string, unknown>) => T) =>
	(node: { attrs: Record<string, unknown> }) =>
		read(node.attrs)

const str = (value: unknown, fallback = ''): string =>
	typeof value === 'string' ? value : fallback

export function defineTemplateNodeViews(derived: () => DerivedView, guidance: GuidanceMode) {
	const provide = providing(derived, guidance)
	return union(
		defineSolidNodeView<BoxAttrs>({
			name: 'box',
			hasContent: true,
			readAttrs: asAttrs(boxAttrsOf),
			component: provide(viewOf(BoxBlock)),
			contentAs: contentElement('div'),
		}),
		defineSolidNodeView<BannerAttrs>({
			name: 'banner',
			hasContent: true,
			readAttrs: asAttrs((a) => ({ tone: a.tone === 'sub' ? 'sub' : 'band' })),
			component: provide(viewOf(BannerBlock)),
			contentAs: contentElement('span'),
		}),
		defineSolidNodeView<GuidanceAttrs>({
			name: 'guidance',
			hasContent: true,
			readAttrs: asAttrs(guidanceAttrsOf),
			component: provide(viewOf(GuidanceBlock)),
			contentAs: contentElement('div'),
		}),
		defineSolidNodeView<Record<string, never>>({
			name: 'timeframe',
			hasContent: true,
			readAttrs: none,
			component: provide(viewOf(TimeframeBlock)),
			contentAs: contentElement('div'),
		}),
		defineSolidNodeView<{ textAlign: TextAlign | null }>({
			name: 'carePoint',
			hasContent: true,
			readAttrs: asAttrs((a) => ({ textAlign: textAlignOf(a.textAlign) })),
			component: provide(viewOf(CarePointBlock)),
			contentAs: contentElement('span'),
		}),
		defineSolidNodeView<Record<string, never>>({
			name: 'variants',
			hasContent: true,
			readAttrs: none,
			component: provide(viewOf(VariantsBlock)),
			contentAs: contentElement('div'),
		}),
		defineSolidNodeView<Record<string, never>>({
			name: 'variant',
			hasContent: true,
			readAttrs: none,
			component: provide((props) => (
				<VariantBlock
					attrs={props.attrs}
					edit={{
						setAttrs: (patch) => props.setAttrs(patch),
						keep: () => keepVariant(props.view, props.getPos),
					}}
				>
					{props.content}
				</VariantBlock>
			)),
			contentAs: contentElement('div'),
		}),
		defineSolidNodeView<Record<string, never>>({
			name: 'columns',
			hasContent: true,
			readAttrs: none,
			component: provide(viewOf(ColumnsBlock)),
			contentAs: contentElement('div'),
		}),
		defineSolidNodeView<Record<string, never>>({
			name: 'column',
			hasContent: true,
			readAttrs: none,
			component: provide(viewOf(ColumnBlock)),
			contentAs: contentElement('div'),
		}),
		defineSolidNodeView<Record<string, never>>({
			name: 'resourceList',
			hasContent: true,
			readAttrs: none,
			component: provide(viewOf(ResourceListBlock)),
			contentAs: contentElement('div', { presentation: true }),
		}),
		defineSolidNodeView<ResourceAttrs>({
			name: 'resource',
			hasContent: true,
			readAttrs: asAttrs((a) => ({ title: str(a.title), url: str(a.url) })),
			component: provide(viewOf(ResourceBlock)),
			// The row the component draws is the list item; the node view's own element is
			// layout only around it.
			as: () => {
				const element = document.createElement('div')
				element.setAttribute('role', 'presentation')
				return element
			},
			contentAs: contentElement('div'),
		}),
		defineSolidNodeView<Record<string, never>>({
			name: 'timeframeSnapshot',
			hasContent: false,
			readAttrs: none,
			component: provide(() => <TimeframeSnapshotBlock />),
		}),
		defineSolidNodeView<Record<string, never>>({
			name: 'pathwayMap',
			hasContent: false,
			readAttrs: none,
			component: provide(() => <PathwayMapBlock />),
		}),
		defineSolidNodeView<{ referenceId: string }>({
			name: 'citation',
			hasContent: false,
			readAttrs: asAttrs((a) => ({ referenceId: str(a.referenceId) })),
			component: provide((props) => <CitationInline referenceId={props.attrs.referenceId} />),
			as: 'span',
		}),
		defineSolidNodeView<{ text: string }>({
			name: 'footnote',
			hasContent: false,
			readAttrs: asAttrs((a) => ({ text: str(a.text) })),
			component: provide((props) => <FootnoteInline text={props.attrs.text} />),
			as: 'span',
		}),
	)
}

export type TemplateNodeViewsExtension = ReturnType<typeof defineTemplateNodeViews>
export type { JSX }
