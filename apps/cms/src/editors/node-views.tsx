/**
 * The editor's node views for the template's blocks: the SAME Solid components the
 * read-only renderer uses (content/blocks.tsx), mounted by ui-solid's Solid node view
 * over the content schema's specs. Each view hands the component the node's attributes
 * (live), an attribute setter (the done tick, a resource's link) and a host element that
 * ProseMirror's content element is appended into, so the node's children edit inside
 * the component exactly where the renderer draws them.
 */

import { defineSolidNodeView, type SolidNodeViewProps } from '@aicolab/ui-solid/prosekit-solid'
import { union } from '@prosekit/core'
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
	type ResourceAttrs,
} from '#/content/schema.ts'

/** Every node view is its own Solid root (ProseMirror owns the mount), so the page's
 *  context does not reach it: the derived view is handed in and provided around each. */
type Provide = <P extends object>(component: Component<P>) => Component<P>

const providing =
	(derived: () => DerivedView): Provide =>
	(Inner) =>
	(props) => (
		<DerivedContext value={derived}>
			<Inner {...props} />
		</DerivedContext>
	)

/** A block component as a node view: attrs live, the content element as its child. */
function viewOf<Attrs extends object>(
	Block: Component<BlockProps<Attrs>>,
	contentClass = 'ocp-node-content',
): Component<SolidNodeViewProps<Attrs>> {
	return (props) => (
		<Block attrs={props.attrs} edit={{ setAttrs: (patch) => props.setAttrs(patch) }}>
			<div class={contentClass} ref={(element) => props.contentRef(element)} />
		</Block>
	)
}

/** Inline-content blocks host the content element inline. */
function inlineViewOf<Attrs extends object>(
	Block: Component<BlockProps<Attrs>>,
): Component<SolidNodeViewProps<Attrs>> {
	return (props) => (
		<Block attrs={props.attrs} edit={{ setAttrs: (patch) => props.setAttrs(patch) }}>
			<span class="ocp-node-content" ref={(element) => props.contentRef(element)} />
		</Block>
	)
}

const none = () => ({})

const asAttrs =
	<T,>(read: (attrs: Record<string, unknown>) => T) =>
	(node: { attrs: Record<string, unknown> }) =>
		read(node.attrs)

const str = (value: unknown, fallback = ''): string =>
	typeof value === 'string' ? value : fallback

export function defineTemplateNodeViews(derived: () => DerivedView) {
	const provide = providing(derived)
	return union(
		defineSolidNodeView<BoxAttrs>({
			name: 'box',
			hasContent: true,
			readAttrs: asAttrs(boxAttrsOf),
			component: provide(viewOf(BoxBlock)),
		}),
		defineSolidNodeView<BannerAttrs>({
			name: 'banner',
			hasContent: true,
			readAttrs: asAttrs((a) => ({ tone: a.tone === 'sub' ? 'sub' : 'band' })),
			component: provide(inlineViewOf(BannerBlock)),
			contentAs: 'span',
		}),
		defineSolidNodeView<GuidanceAttrs>({
			name: 'guidance',
			hasContent: true,
			readAttrs: asAttrs((a) => ({ done: a.done === true })),
			component: provide(viewOf(GuidanceBlock)),
		}),
		defineSolidNodeView<Record<string, never>>({
			name: 'timeframe',
			hasContent: true,
			readAttrs: none,
			component: provide(viewOf(TimeframeBlock)),
		}),
		defineSolidNodeView<{ textAlign: TextAlign | null }>({
			name: 'carePoint',
			hasContent: true,
			readAttrs: asAttrs((a) => ({ textAlign: textAlignOf(a.textAlign) })),
			component: provide(inlineViewOf(CarePointBlock)),
			contentAs: 'span',
		}),
		defineSolidNodeView<Record<string, never>>({
			name: 'variants',
			hasContent: true,
			readAttrs: none,
			component: provide(viewOf(VariantsBlock)),
		}),
		defineSolidNodeView<Record<string, never>>({
			name: 'variant',
			hasContent: true,
			readAttrs: none,
			component: provide(viewOf(VariantBlock)),
		}),
		defineSolidNodeView<Record<string, never>>({
			name: 'columns',
			hasContent: true,
			readAttrs: none,
			component: provide(viewOf(ColumnsBlock, 'ocp-node-content ocp-columns-content')),
		}),
		defineSolidNodeView<Record<string, never>>({
			name: 'column',
			hasContent: true,
			readAttrs: none,
			component: provide(viewOf(ColumnBlock)),
		}),
		defineSolidNodeView<Record<string, never>>({
			name: 'resourceList',
			hasContent: true,
			readAttrs: none,
			component: provide(viewOf(ResourceListBlock, 'ocp-node-content ocp-resources-content')),
		}),
		defineSolidNodeView<ResourceAttrs>({
			name: 'resource',
			hasContent: true,
			readAttrs: asAttrs((a) => ({ title: str(a.title), url: str(a.url) })),
			component: provide(viewOf(ResourceBlock)),
			as: 'li',
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
