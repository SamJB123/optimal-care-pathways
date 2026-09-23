/**
 * The template's notes to a drafter, read out of a section's body for the margin: each
 * guidance block (in reading order — the order the editor counts them in, so a note's
 * index is the block it ticks), and each instruction written inside a shared sentence.
 */

import { guidanceAttrsOf, type JsonNode } from '#/content/schema.ts'

export interface GuidanceNote {
	kind: 'guidance'
	/** Its place among the section's guidance blocks: what the editor ticks. */
	index: number
	/** The note's text, block by block. */
	paragraphs: string[]
	done: boolean
	doneBy: string
	doneAt: number
}

export interface InstructionNote {
	kind: 'instruction'
	text: string
}

export type MarginNote = GuidanceNote | InstructionNote

const textOf = (node: JsonNode): string =>
	node.type === 'text' ? (node.text ?? '') : (node.content ?? []).map(textOf).join('')

/** A guidance block's text as paragraphs (its first-level blocks, lists as their items). */
function paragraphsOf(node: JsonNode): string[] {
	return (node.content ?? [])
		.flatMap((block) =>
			block.type === 'list' ? (block.content ?? []).map(textOf) : [textOf(block)],
		)
		.map((t) => t.replace(/\s+/g, ' ').trim())
		.filter((t) => t.length > 0)
}

export function marginNotesOf(body: JsonNode | null | undefined): MarginNote[] {
	if (!body) return []
	const notes: MarginNote[] = []
	let index = 0
	const walk = (node: JsonNode) => {
		if (node.type === 'guidance') {
			const attrs = guidanceAttrsOf(node.attrs ?? {})
			notes.push({ kind: 'guidance', index: index++, paragraphs: paragraphsOf(node), ...attrs })
			return
		}
		if (node.type === 'text' && node.marks?.some((m) => m.type === 'instruction')) {
			const text = (node.text ?? '').replace(/^\s*<\s*|\s*>\s*$/g, '').trim()
			if (text) notes.push({ kind: 'instruction', text })
			return
		}
		for (const child of node.content ?? []) walk(child)
	}
	walk(body)
	return notes
}

/** How many notes still wait for the drafter. */
export const openNotes = (notes: readonly MarginNote[]): number =>
	notes.filter((n) => n.kind === 'guidance' && !n.done).length
