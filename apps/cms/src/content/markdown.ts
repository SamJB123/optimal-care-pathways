/**
 * Markdown from a body's JSON (decision 97), written at publish beside the HTML so the
 * partner site can take either. The template's blocks become the nearest Markdown
 * structure a reader would write by hand: a banner is a bold line, a box a blockquote
 * headed by its banner, a timeframe a blockquote headed by its care point, resources a
 * list of links, check items task-list items, citations footnote references numbered
 * as the published document numbers them. Drafting guidance is not published and does
 * not appear.
 */

import type { DerivedView } from './derived.ts'
import { inlineText } from './derived.ts'
import type { JsonMark, JsonNode } from './schema.ts'

const escapeMd = (text: string): string => text.replace(/([\\`*_[\]<>])/g, '\\$1')

function inline(nodes: JsonNode[], derived: DerivedView): string {
	let out = ''
	for (const node of nodes) {
		switch (node.type) {
			case 'text':
				out += marked(escapeMd(node.text ?? ''), node.marks ?? [])
				break
			case 'hardBreak':
				out += '  \n'
				break
			case 'citation': {
				const id = typeof node.attrs?.referenceId === 'string' ? node.attrs.referenceId : ''
				const n = derived.referenceNumbers[id]
				out += n === undefined ? '' : `[^${n}]`
				break
			}
			case 'footnote':
				out += ` (${typeof node.attrs?.text === 'string' ? node.attrs.text : ''})`
				break
			case 'mention':
				out += typeof node.attrs?.value === 'string' ? node.attrs.value : ''
				break
			case 'image':
				out += `![${str(node.attrs?.alt)}](${str(node.attrs?.src)})`
				break
			default:
				out += inline(node.content ?? [], derived)
		}
	}
	return out
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

function marked(text: string, marks: JsonMark[]): string {
	if (text.trim() === '') return text
	let out = text
	for (const mark of [...marks].reverse()) {
		switch (mark.type) {
			case 'bold':
				out = `**${out}**`
				break
			case 'italic':
				out = `*${out}*`
				break
			case 'strike':
				out = `~~${out}~~`
				break
			case 'superscript':
				out = `^${out}^`
				break
			case 'subscript':
				out = `~${out}~`
				break
			case 'link':
				out = `[${out}](${str(mark.attrs?.href)})`
				break
			case 'sectionLink':
				out = `[${out}](#${str(mark.attrs?.address)})`
				break
			default:
				break
		}
	}
	return out
}

const indent = (text: string, prefix: string): string =>
	text
		.split('\n')
		.map((line) => (line === '' ? line : prefix + line))
		.join('\n')

function block(node: JsonNode, derived: DerivedView): string {
	const children = node.content ?? []
	switch (node.type) {
		case 'paragraph':
		case 'carePoint':
			return inline(children, derived)
		case 'heading': {
			const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 1
			return `${'#'.repeat(Math.min(6, Math.max(1, level)))} ${inline(children, derived)}`
		}
		case 'banner':
			return `**${inline(children, derived)}**`
		case 'blockquote':
			return indent(blocks(children, derived), '> ')
		case 'horizontalRule':
		case 'pageBreak':
			return '---'
		case 'image':
			return `![${str(node.attrs?.alt)}](${str(node.attrs?.src)})`
		case 'list':
			return listItem(node, derived)
		case 'table':
			return table(node, derived)
		case 'guidance':
			return ''
		case 'box':
		case 'timeframe':
			return indent(blocks(children, derived), '> ')
		case 'variants':
			return children
				.map((variant, i) => (i === 0 ? '' : '*Or*\n\n') + blocks(variant.content ?? [], derived))
				.join('\n\n')
		case 'resourceList':
			return children.map((resource) => `- ${resource_(resource, derived)}`).join('\n')
		case 'resource':
			return `- ${resource_(node, derived)}`
		case 'timeframeSnapshot':
			return snapshot(derived)
		case 'pathwayMap':
			return ''
		default:
			return blocks(children, derived)
	}
}

function resource_(node: JsonNode, derived: DerivedView): string {
	const title = str(node.attrs?.title)
	const url = str(node.attrs?.url)
	const head = url ? `[${escapeMd(title)}](${url})` : `**${escapeMd(title)}**`
	const description = blocks(node.content ?? [], derived)
		.replace(/\n+/g, ' ')
		.trim()
	return description ? `${head} — ${description}` : head
}

function listItem(node: JsonNode, derived: DerivedView): string {
	const kind = str(node.attrs?.kind) || 'bullet'
	const [first, ...rest] = node.content ?? []
	const marker =
		kind === 'ordered'
			? `${typeof node.attrs?.order === 'number' ? node.attrs.order : 1}.`
			: kind === 'check'
				? node.attrs?.negated === true
					? '- [ ] ✗'
					: '- [x]'
				: '-'
	const head = first ? block(first, derived) : ''
	const tail = rest.map((child) => indent(block(child, derived), '  ')).join('\n')
	return `${marker} ${head}${tail ? `\n${tail}` : ''}`
}

function table(node: JsonNode, derived: DerivedView): string {
	const rows = (node.content ?? []).map((row) =>
		(row.content ?? []).map((cell) =>
			blocks(cell.content ?? [], derived)
				.replace(/\n+/g, ' ')
				.replace(/\|/g, '\\|')
				.trim(),
		),
	)
	const width = Math.max(0, ...rows.map((r) => r.length))
	if (width === 0) return ''
	const pad = (cells: string[]) => [...cells, ...Array(width - cells.length).fill('')]
	const line = (cells: string[]) => `| ${pad(cells).join(' | ')} |`
	const [head, ...body] = rows
	return [line(head ?? []), `| ${Array(width).fill('---').join(' | ')} |`, ...body.map(line)].join(
		'\n',
	)
}

function snapshot(derived: DerivedView): string {
	if (derived.timeframes.length === 0) return ''
	const rows = derived.timeframes.map((t) => [
		t.stepNumber === null ? '' : `Step ${t.stepNumber}`,
		t.section,
		t.carePoint,
		t.statements.join('; '),
	])
	const line = (cells: string[]) => `| ${cells.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`
	return [
		line(['Step', 'Section', 'Care point', 'Timeframe']),
		'| --- | --- | --- | --- |',
		...rows.map(line),
	].join('\n')
}

function blocks(nodes: JsonNode[], derived: DerivedView): string {
	return nodes
		.map((node) => block(node, derived))
		.filter((text) => text.trim() !== '')
		.join('\n\n')
}

/** The body as Markdown. */
export function bodyToMarkdown(body: JsonNode | null, derived: DerivedView): string {
	if (!body) return ''
	return blocks(body.content ?? [], derived).trim()
}

/** A body's plain text, for search and previews. */
export const bodyText = (body: JsonNode | null): string => (body ? inlineText(body) : '')
