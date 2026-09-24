/**
 * The Solid renderer over a body's JSON (decision 77): every read-only view of a
 * section — the step page's shared sections, the review page, the hub — paints a body
 * with the SAME block components the editor's node views use (content/blocks.tsx), so
 * view and edit look alike and the derived views (citation numbers, the timeframe
 * snapshot) are computed once and read through context. Renders on the server too:
 * nothing here touches the DOM.
 *
 * ProseKit's own nodes (paragraph, heading, list, table, image, …) are written out as
 * their `toDOM` would write them, so the CSS that dresses the editor dresses this too.
 */

import { Dynamic, type JSX } from '@solidjs/web'
import { For, Match, Show, Switch, untrack } from 'solid-js'
import {
	BannerBlock,
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
	TimeframeBlock,
	TimeframeSnapshotBlock,
	textAlignOf,
	VariantBlock,
	VariantsBlock,
} from './blocks.tsx'
import { type DerivedView, emptyDerived } from './derived.ts'
import { boxAttrsOf, guidanceAttrsOf, type JsonMark, type JsonNode } from './schema.ts'
// The body's own styles travel with the renderer: a page that renders a body (the
// review page, the hub) gets them without mounting an editor. The list sheet is the
// one the editor uses (prosekit's, which draws the bullet itself), never the flat-list
// stock sheet beside it: both at once draw two bullets.
import '@prosekit/extensions/list/style.css'
import '#/editors/section.css'

/** A body, rendered. `derived` is the page's derived view; without it citations show
 *  '?' and the snapshot is empty. */
export function RenderedBody(props: {
	body: JsonNode
	derived?: DerivedView
	guidance?: GuidanceMode
}) {
	// Where guidance shows is a constant of the document a body belongs to.
	const guidance = untrack(() => props.guidance ?? 'inline')
	return (
		<DerivedContext value={() => props.derived ?? emptyDerived()}>
			<GuidanceModeContext value={guidance}>
				<div class="ocp-body ocp-body-static" data-guidance={guidance}>
					<Blocks nodes={props.body.content ?? []} />
				</div>
			</GuidanceModeContext>
		</DerivedContext>
	)
}

function Blocks(props: { nodes: JsonNode[] }) {
	return <For each={props.nodes}>{(node) => <Block node={node} />}</For>
}

const str = (value: unknown, fallback = ''): string =>
	typeof value === 'string' ? value : fallback
const num = (value: unknown): number | null => (typeof value === 'number' ? value : null)

const alignStyle = (attrs: JsonNode['attrs']): JSX.CSSProperties | undefined => {
	const align = textAlignOf(attrs?.textAlign)
	return align ? { 'text-align': align } : undefined
}

function Block(props: { node: JsonNode }) {
	const attrs = () => props.node.attrs ?? {}
	const children = () => props.node.content ?? []
	return (
		<Switch fallback={<Blocks nodes={children()} />}>
			<Match when={props.node.type === 'paragraph'}>
				<p style={alignStyle(attrs())}>
					<Inline nodes={children()} />
				</p>
			</Match>
			<Match when={props.node.type === 'heading'}>
				<Dynamic component={`h${num(attrs().level) ?? 1}`} style={alignStyle(attrs())}>
					<Inline nodes={children()} />
				</Dynamic>
			</Match>
			<Match when={props.node.type === 'blockquote'}>
				<blockquote>
					<Blocks nodes={children()} />
				</blockquote>
			</Match>
			<Match when={props.node.type === 'horizontalRule'}>
				<div class="prosekit-horizontal-rule">
					<hr />
				</div>
			</Match>
			<Match when={props.node.type === 'pageBreak'}>
				<div class="prosekit-horizontal-rule prosekit-page-break">
					<hr />
				</div>
			</Match>
			<Match when={props.node.type === 'image'}>
				<img src={str(attrs().src)} alt={str(attrs().alt)} />
			</Match>
			<Match when={props.node.type === 'list'}>
				<ListBlock node={props.node} />
			</Match>
			<Match when={props.node.type === 'table'}>
				<table>
					<colgroup>
						<For each={columnWidths(props.node)}>
							{(width) => <col style={width ? { width: `${width}px` } : undefined} />}
						</For>
					</colgroup>
					<tbody>
						<For each={children()}>
							{(row) => (
								<tr>
									<For each={row.content ?? []}>{(cell) => <Cell node={cell} />}</For>
								</tr>
							)}
						</For>
					</tbody>
				</table>
			</Match>
			<Match when={props.node.type === 'box'}>
				<BoxBlock attrs={boxAttrsOf(attrs())}>
					<Blocks nodes={children()} />
				</BoxBlock>
			</Match>
			<Match when={props.node.type === 'banner'}>
				<BannerBlock attrs={{ tone: attrs().tone === 'sub' ? 'sub' : 'band' }}>
					<Inline nodes={children()} />
				</BannerBlock>
			</Match>
			<Match when={props.node.type === 'guidance'}>
				<GuidanceBlock attrs={guidanceAttrsOf(attrs())}>
					<Blocks nodes={children()} />
				</GuidanceBlock>
			</Match>
			<Match when={props.node.type === 'timeframe'}>
				<TimeframeBlock attrs={{}}>
					<Blocks nodes={children()} />
				</TimeframeBlock>
			</Match>
			<Match when={props.node.type === 'carePoint'}>
				<CarePointBlock attrs={{ textAlign: textAlignOf(attrs().textAlign) }}>
					<Inline nodes={children()} />
				</CarePointBlock>
			</Match>
			<Match when={props.node.type === 'variants'}>
				<VariantsBlock attrs={{}}>
					<Blocks nodes={children()} />
				</VariantsBlock>
			</Match>
			<Match when={props.node.type === 'variant'}>
				<VariantBlock attrs={{}}>
					<Blocks nodes={children()} />
				</VariantBlock>
			</Match>
			<Match when={props.node.type === 'figureRow'}>
				<div data-ocp="figureRow">
					<Blocks nodes={children()} />
				</div>
			</Match>
			<Match when={props.node.type === 'columns'}>
				<ColumnsBlock attrs={{}}>
					<Blocks nodes={children()} />
				</ColumnsBlock>
			</Match>
			<Match when={props.node.type === 'column'}>
				<ColumnBlock attrs={{}}>
					<Blocks nodes={children()} />
				</ColumnBlock>
			</Match>
			<Match when={props.node.type === 'resourceList'}>
				<ResourceListBlock attrs={{}}>
					<Blocks nodes={children()} />
				</ResourceListBlock>
			</Match>
			<Match when={props.node.type === 'resource'}>
				<ResourceBlock attrs={{ title: str(attrs().title), url: str(attrs().url) }}>
					<Blocks nodes={children()} />
				</ResourceBlock>
			</Match>
			<Match when={props.node.type === 'timeframeSnapshot'}>
				<TimeframeSnapshotBlock />
			</Match>
			<Match when={props.node.type === 'pathwayMap'}>
				<PathwayMapBlock />
			</Match>
		</Switch>
	)
}

/** prosemirror-flat-list's DOM: the item element, its marker, its content. */
function ListBlock(props: { node: JsonNode }) {
	const attrs = () => props.node.attrs ?? {}
	const kind = () => str(attrs().kind, 'bullet')
	const order = () => num(attrs().order)
	const icon = () => str(attrs().icon)
	const style = (): JSX.CSSProperties | undefined => {
		const out: JSX.CSSProperties = {}
		if (order() !== null) out['--prosemirror-flat-list-order'] = String(order())
		if (icon()) out['--ocp-list-icon'] = `url("${encodeURI(icon())}")`
		return Object.keys(out).length > 0 ? out : undefined
	}
	return (
		<div
			class="prosemirror-flat-list"
			data-list-kind={kind()}
			data-list-order={order() === null ? undefined : String(order())}
			data-list-collapsable={(props.node.content?.length ?? 0) >= 2 ? '' : undefined}
			data-point-of-care={attrs().pointOfCare === true ? 'true' : undefined}
			data-negated={attrs().negated === true ? 'true' : undefined}
			style={style()}
		>
			<div class="list-marker list-marker-click-target" contenteditable="false" />
			<div class="list-content">
				<Blocks nodes={props.node.content ?? []} />
			</div>
		</div>
	)
}

/** The widths a table's columns were dragged to in the editor (prosemirror-tables'
 *  `colwidth`, in px, on the first row's cells), or null for a column that keeps its
 *  share of the table. */
export function columnWidths(table: JsonNode): (number | null)[] {
	const out: (number | null)[] = []
	for (const cell of table.content?.[0]?.content ?? []) {
		const span = num(cell.attrs?.colspan) ?? 1
		const widths = cell.attrs?.colwidth
		for (let i = 0; i < span; i++) {
			const width = Array.isArray(widths) ? widths[i] : null
			out.push(typeof width === 'number' && width > 0 ? width : null)
		}
	}
	return out
}

function Cell(props: { node: JsonNode }) {
	const attrs = () => props.node.attrs ?? {}
	const background = () => str(attrs().background) || undefined
	return (
		<Dynamic
			component={props.node.type === 'tableHeaderCell' ? 'th' : 'td'}
			colspan={num(attrs().colspan) ?? undefined}
			rowspan={num(attrs().rowspan) ?? undefined}
			data-background={background()}
			data-ui-color-base={background()}
			data-ui-color-variant={background() ? 'soft' : undefined}
		>
			<Blocks nodes={props.node.content ?? []} />
		</Dynamic>
	)
}

/** Inline content: text under its marks (first mark outermost, as ProseMirror
 *  serialises), and the inline atoms. */
export function Inline(props: { nodes: JsonNode[] }) {
	return (
		<For each={props.nodes}>
			{(node, i) => (
				<Switch>
					<Match when={node.type === 'text'}>
						<Marked marks={node.marks ?? []} index={0} text={node.text ?? ''} />
					</Match>
					<Match when={node.type === 'hardBreak'}>
						<br />
					</Match>
					<Match when={node.type === 'citation'}>
						<CitationInline
							referenceId={str(node.attrs?.referenceId)}
							joined={props.nodes[i() - 1]?.type === 'citation'}
						/>
					</Match>
					<Match when={node.type === 'footnote'}>
						<FootnoteInline text={str(node.attrs?.text)} />
					</Match>
					<Match when={node.type === 'mention'}>
						<span data-id={str(node.attrs?.id)} data-mention={str(node.attrs?.kind)}>
							{str(node.attrs?.value)}
						</span>
					</Match>
					<Match when={node.type === 'image'}>
						<img src={str(node.attrs?.src)} alt={str(node.attrs?.alt)} />
					</Match>
				</Switch>
			)}
		</For>
	)
}

function Marked(props: { marks: JsonMark[]; index: number; text: string }) {
	const mark = () => props.marks[props.index]
	const inner = () => <Marked marks={props.marks} index={props.index + 1} text={props.text} />
	return (
		<Show when={mark()} fallback={props.text}>
			{(m) => (
				<Switch fallback={inner()}>
					<Match when={m().type === 'bold'}>
						<strong>{inner()}</strong>
					</Match>
					<Match when={m().type === 'italic'}>
						<em>{inner()}</em>
					</Match>
					<Match when={m().type === 'underline'}>
						<u>{inner()}</u>
					</Match>
					<Match when={m().type === 'strike'}>
						<s>{inner()}</s>
					</Match>
					<Match when={m().type === 'superscript'}>
						<sup>{inner()}</sup>
					</Match>
					<Match when={m().type === 'subscript'}>
						<sub>{inner()}</sub>
					</Match>
					<Match when={m().type === 'link'}>
						<a
							href={str(m().attrs?.href)}
							target={str(m().attrs?.target) || undefined}
							rel={str(m().attrs?.rel) || undefined}
						>
							{inner()}
						</a>
					</Match>
					<Match when={m().type === 'placeholder'}>
						<mark
							data-ocp="placeholder"
							data-label={str(m().attrs?.label)}
							data-ui-color-base="warning"
							data-ui-color-variant="soft"
						>
							{inner()}
						</mark>
					</Match>
					<Match when={m().type === 'note'}>
						<span data-ocp="note">{inner()}</span>
					</Match>
					<Match when={m().type === 'instruction'}>
						<span data-ocp="instruction">{inner()}</span>
					</Match>
					<Match when={m().type === 'sectionLink'}>
						<a
							data-ocp="section"
							data-address={str(m().attrs?.address)}
							href={`#${str(m().attrs?.address)}`}
						>
							{inner()}
						</a>
					</Match>
					<Match when={m().type === 'insertion'}>
						<ins data-ocp="insertion">{inner()}</ins>
					</Match>
					<Match when={m().type === 'deletion'}>
						<del data-ocp="deletion">{inner()}</del>
					</Match>
				</Switch>
			)}
		</Show>
	)
}
