/**
 * The template authors' "<hyperlink to be added>" notes, resolved in the seed. Each note
 * marks a link the authors meant; the words just before it say where to. A note becomes a
 * mark on those words and the note's text goes:
 *
 *   a Principle ("Supportive care (Principle)", "Equity <Link to Principle>")
 *       → a link to that Principle's section of the Principles document
 *         (`/p/principles#supportive-care`), or a cross-reference inside the Principles
 *         document itself;
 *   the Principles document, a named pathway ("Optimal care pathway for older people with
 *   cancer") → a link to its published page (`/p/{slug}`);
 *   a step or a numbered section of a pathway ("Step 4 Treatment (Pathway step)",
 *   "(Pathway step 1)", "4.3 Treatment overview (Pathway step)", "section 6.5")
 *       → a typed `sectionLink` by address. A core section is read by every pathway that
 *         shares it, so the cross-reference resolves in whichever document shows it; a
 *         hard-coded url would point every pathway at one.
 *
 * Anything else stays exactly as printed, and the occurrence says why. A See also entry
 * whose only address was the note (the mapper leaves its url empty) takes the address its
 * title names by the same rules. Pure over the JSON; the seed and the resolution list
 * (scripts/hyperlink-resolutions.ts) run the same code.
 */

import type { JsonMark, JsonNode } from '#/content/schema.ts'
import type { TemplateKind } from '#/db/schema.ts'
import { publishedHref } from '#/lib/hrefs.ts'
import type { SeedResult } from '../rows.ts'

/** The note as the templates print it, however Word spaced its brackets. */
const NOTE = /<\s*hyperlink to be added\s*>/gi

export const hasHyperlinkNote = (text: string): boolean =>
	/<\s*hyperlink to be added\s*>/i.test(text)

/** The eight Principles, by the headings the Principles document gives them. */
export const PRINCIPLES = [
	'Equity',
	'Person-centred care',
	'Safe and quality care',
	'Multidisciplinary care',
	'Supportive care',
	'Navigation and care coordination',
	'Communication',
	'Research and clinical trials',
] as const

export interface TargetSection {
	address: string
	title: string | null
}

/** What a note can point at beyond the document it sits in. */
export interface HyperlinkTargets {
	/** The Principles document: its slug (read at `/p/{slug}`) and its sections. */
	principles: { slug: string; sections: readonly TargetSection[] }
	/** The pathways, by the subject their title names. */
	pathways: readonly { slug: string; subject: string }[]
}

/** The document a note sits in: a step's cross-reference must find its step here. */
export interface ShowingDocument {
	kind: TemplateKind
	sections: readonly TargetSection[]
}

export type HyperlinkTarget =
	| { kind: 'link'; href: string; name: string }
	| { kind: 'section'; address: string; name: string }

export type HyperlinkRule = 'principle' | 'document' | 'pathway' | 'step' | 'section'

export type HyperlinkResolution =
	| { outcome: 'resolved'; rule: HyperlinkRule; words: string; target: HyperlinkTarget }
	| { outcome: 'left'; reason: string }

/** One note as the resolution list shows it: the sentence around it and what became of it. */
export interface HyperlinkOccurrence {
	text: string
	resolution: HyperlinkResolution
}

interface Context {
	doc: ShowingDocument
	targets: HyperlinkTargets
}

type Groups = Record<string, string | undefined>

interface Rule {
	rule: HyperlinkRule
	/** Matched against the words before the note (since the block began or the note
	 *  before); the `words` group is the span the link goes on. Needs the `d` flag. */
	pattern: RegExp
	target: (groups: Groups, context: Context) => HyperlinkTarget | { reason: string }
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const NAMES = PRINCIPLES.map(escapeRegExp).join('|')

/** A title's words, for comparing a printed title with a section's: lower case, hyphens
 *  and punctuation as spaces ("End-of-life" = "End of life"). */
const wordsOf = (value: string): string[] =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.split(' ')
		.filter(Boolean)

function principleTarget(
	name: string | undefined,
	{ doc, targets }: Context,
): HyperlinkTarget | { reason: string } {
	const wanted = (name ?? '').trim().toLowerCase()
	const canonical = PRINCIPLES.find((p) => p.toLowerCase() === wanted)
	// A Principle is a top-level section of the Principles document.
	const section = targets.principles.sections.find(
		(s) => !s.address.includes('/') && s.title?.toLowerCase() === wanted,
	)
	if (!canonical || !section)
		return { reason: `The Principles document has no section “${name ?? ''}”.` }
	if (doc.kind === 'principles')
		return { kind: 'section', address: section.address, name: `${canonical} (Principle)` }
	return {
		kind: 'link',
		href: `${publishedHref(targets.principles.slug)}#${section.address}`,
		name: `${canonical} (Principle)`,
	}
}

function pathwayTarget(
	subject: string | undefined,
	{ targets }: Context,
): HyperlinkTarget | { reason: string } {
	const wanted = (subject ?? '').trim().toLowerCase()
	const found = targets.pathways.find(
		(p) =>
			p.subject.toLowerCase() === wanted || `people with ${p.subject.toLowerCase()}` === wanted,
	)
	if (!found) return { reason: `No pathway has the subject “${subject ?? ''}”.` }
	return {
		kind: 'link',
		href: publishedHref(found.slug),
		name: `Optimal care pathway for ${found.subject}`,
	}
}

/** A section of the showing document by address, when the title printed with it (if any)
 *  is the section's: every printed word is in the section's title. */
function sectionTarget(
	address: string | undefined,
	printed: string | undefined,
	{ doc }: Context,
): HyperlinkTarget | { reason: string } {
	const section = doc.sections.find((s) => s.address === address)
	const label = /\./.test(address ?? '') ? `Section ${address ?? ''}` : `Step ${address ?? ''}`
	if (!section) return { reason: `This document has no ${label.toLowerCase()}.` }
	const title = section.title ?? ''
	const have = new Set(wordsOf(title))
	const missing = wordsOf(printed ?? '').filter((w) => !have.has(w))
	if (missing.length > 0)
		return { reason: `${label} of this document is “${title}”; the words name something else.` }
	return { kind: 'section', address: section.address, name: `${label}: ${title}` }
}

/** The rules, first match wins. A rule that matches but finds no target leaves the note
 *  with its reason; later rules are not tried. */
const RULES: readonly Rule[] = [
	{
		// "Equity <Link to Principle>": the pathway templates' list of the Principles, where
		// the authors' second note asks for the same link and goes with the first.
		rule: 'principle',
		pattern: new RegExp(`(?<words>\\b(?:${NAMES}))\\s*<\\s*Link to Principle\\s*>\\s*$`, 'id'),
		target: (g, c) => principleTarget(g.words, c),
	},
	{
		// A See also entry naming a Principle: "Supportive care (Principle)", "Safety
		// netting: in Safe and quality care (Principle)", "Person-centred care (Principle):
		// Informed consent". The whole entry is the link's words.
		rule: 'principle',
		pattern: new RegExp(
			`^\\s*(?<words>[^()<>]*?(?<name>${NAMES})\\s*\\(Principle\\)(?::[^()<>]*?)?)\\s*$`,
			'id',
		),
		target: (g, c) => principleTarget(g.name, c),
	},
	{
		// A Principle named in a sentence: "…are listed in the Supportive care principle".
		rule: 'principle',
		pattern: new RegExp(`(?<words>\\b(?<name>${NAMES}) principle)\\s*$`, 'id'),
		target: (g, c) => principleTarget(g.name, c),
	},
	{
		// The Principles document by its title: "…underpinned by the Principles for Optimal
		// Cancer Care". Its published page.
		rule: 'document',
		pattern: /(?<words>\bPrinciples for Optimal Cancer Care)\.?\s*$/d,
		target: (_, { targets }) => ({
			kind: 'link',
			href: publishedHref(targets.principles.slug),
			name: 'Principles for Optimal Cancer Care',
		}),
	},
	{
		// A pathway by its title: "Optimal care pathway for older people with cancer". Its
		// published page, found by the subject the catalogue gives it.
		rule: 'pathway',
		pattern: /^\s*(?<words>Optimal care pathway for (?<subject>[^<>]+?))\s*$/di,
		target: (g, c) => pathwayTarget(g.subject, c),
	},
	{
		// A step by its number and title: "Step 6: Managing recurrent, residual or
		// metastatic disease (Pathway step)". Step n of the showing document, when the title
		// printed is step n's ("Step 6: End-of-life care" is not).
		rule: 'step',
		pattern: /^\s*(?<words>Step\s+(?<number>\d+):?\s*(?<title>[^()<>]*?)\s*\(Pathway step\))\s*$/di,
		target: (g, c) => sectionTarget(g.number, g.title, c),
	},
	{
		// A topic with its step's number: "Communication about genetic risk (Pathway step 1)".
		// Step n of the showing document.
		rule: 'step',
		pattern: /^\s*(?<words>[^()<>]+?\s*\(Pathway step (?<number>\d+)\))\s*$/di,
		target: (g, c) => sectionTarget(g.number, '', c),
	},
	{
		// A numbered section of a step: "3.2 Genetic or genomic testing (Pathway step)",
		// "see Section 1.1.3 Genetic testing inherited (germline) cancer risk", "listed in
		// section 6.5.". That section of the showing document, when the title agrees.
		rule: 'section',
		pattern:
			/(?<words>\b(?:section\s+)?(?<number>\d+(?:\.\d+)+)(?<title>[^<>]*?)(?:\s*\(Pathway step\))?)\.?\s*$/di,
		target: (g, c) => sectionTarget(g.number, g.title, c),
	},
]

interface Matched {
	resolution: HyperlinkResolution
	/** The words' span within the text given, when resolved. */
	start: number
	end: number
}

function match(before: string, context: Context): Matched {
	if (before.trim() === '')
		return {
			resolution: { outcome: 'left', reason: 'Nothing before the note to carry the link.' },
			start: 0,
			end: 0,
		}
	for (const rule of RULES) {
		const m = rule.pattern.exec(before)
		const span = m?.indices?.groups?.words
		if (!m || !span) continue
		const target = rule.target(m.groups ?? {}, context)
		if ('reason' in target)
			return { resolution: { outcome: 'left', reason: target.reason }, start: 0, end: 0 }
		const [start, end] = span
		return {
			resolution: { outcome: 'resolved', rule: rule.rule, words: before.slice(start, end), target },
			start,
			end,
		}
	}
	return {
		resolution: { outcome: 'left', reason: 'No rule names a target for these words.' },
		start: 0,
		end: 0,
	}
}

/** What the words before a note resolve to. */
export const resolveWords = (
	before: string,
	doc: ShowingDocument,
	targets: HyperlinkTargets,
): HyperlinkResolution => match(before, { doc, targets }).resolution

const markOf = (target: HyperlinkTarget): JsonMark =>
	target.kind === 'link'
		? { type: 'link', attrs: { href: target.href } }
		: { type: 'sectionLink', attrs: { address: target.address } }

/** A textblock's inline content, one item per character (atoms whole), so marks can be
 *  laid over any span and the note cut out whatever runs drew it. */
type Item = { char: string; marks: JsonMark[] } | { atom: JsonNode }

const OBJECT = '￼'

function itemsOf(nodes: JsonNode[]): Item[] {
	return nodes.flatMap((node): Item[] =>
		node.type === 'text'
			? // Code units, so an item's index is its offset in the flat text.
				(node.text ?? '').split('').map((char) => ({ char, marks: node.marks ?? [] }))
			: [{ atom: node }],
	)
}

const flatOf = (items: Item[]): string =>
	items.map((i) => ('char' in i ? i.char : i.atom.type === 'hardBreak' ? '\n' : OBJECT)).join('')

function nodesOf(items: Item[]): JsonNode[] {
	const out: JsonNode[] = []
	for (const item of items) {
		if (!('char' in item)) {
			out.push(item.atom)
			continue
		}
		const last = out.at(-1)
		if (last?.type === 'text' && JSON.stringify(last.marks ?? []) === JSON.stringify(item.marks))
			last.text = `${last.text ?? ''}${item.char}`
		else
			out.push(
				item.marks.length > 0
					? { type: 'text', text: item.char, marks: item.marks }
					: { type: 'text', text: item.char },
			)
	}
	return out
}

/** The sentence around a note for the list: the block's words, trimmed to a window. */
function sentenceOf(flat: string, start: number, end: number): string {
	const clean = (value: string) => value.replaceAll(OBJECT, '').replace(/\s+/g, ' ')
	const from = Math.max(0, start - 180)
	const to = Math.min(flat.length, end + 80)
	return `${from > 0 ? '…' : ''}${clean(flat.slice(from, to)).trim()}${to < flat.length ? '…' : ''}`
}

/** Resolve the notes in one textblock's inline content. */
function resolveInline(
	nodes: JsonNode[],
	context: Context,
	found: HyperlinkOccurrence[],
): JsonNode[] {
	const items = itemsOf(nodes)
	const flat = flatOf(items)
	const notes = [...flat.matchAll(NOTE)]
	if (notes.length === 0) return nodes
	const marked: { start: number; end: number; mark: JsonMark }[] = []
	const cut: { start: number; end: number }[] = []
	let from = 0
	for (const note of notes) {
		const noteStart = note.index
		const noteEnd = noteStart + note[0].length
		const before = flat.slice(from, noteStart)
		const { resolution, start, end } = match(before, context)
		found.push({ text: sentenceOf(flat, noteStart, noteEnd), resolution })
		if (resolution.outcome === 'resolved') {
			const wordsEnd = from + end
			marked.push({ start: from + start, end: wordsEnd, mark: markOf(resolution.target) })
			// The note goes with the space before it; so does a "<Link to Principle>" note
			// between the words and it. Punctuation after the words stays ("Care. <…>").
			const between = flat.slice(wordsEnd, noteStart)
			const cutStart = /^\s*(?:<\s*Link to Principle\s*>\s*)?$/i.test(between)
				? wordsEnd
				: noteStart - (/\s*$/.exec(between)?.[0].length ?? 0)
			cut.push({ start: cutStart, end: noteEnd })
		}
		from = noteEnd
	}
	const kept = items.flatMap((item, i): Item[] => {
		if (cut.some((c) => i >= c.start && i < c.end)) return []
		if (!('char' in item)) return [item]
		const add = marked.filter((m) => i >= m.start && i < m.end).map((m) => m.mark)
		return [add.length > 0 ? { char: item.char, marks: [...item.marks, ...add] } : item]
	})
	return nodesOf(kept)
}

/**
 * Resolve every note in a body. `noted` says which resource entries lost a note to the
 * mapper (their url is empty): their title resolves by the same rules. Returns a new body
 * and the occurrences in reading order.
 */
export function resolveHyperlinks(
	body: JsonNode,
	doc: ShowingDocument,
	targets: HyperlinkTargets,
	noted: (node: JsonNode) => boolean = () => false,
): { body: JsonNode; found: HyperlinkOccurrence[] } {
	const context: Context = { doc, targets }
	const found: HyperlinkOccurrence[] = []
	const visit = (node: JsonNode): JsonNode => {
		let next = node
		if (node.type === 'resource' && node.attrs?.url === '' && noted(node)) {
			const title = String(node.attrs.title ?? '')
			const { resolution } = match(title, context)
			found.push({ text: `${title} <hyperlink to be added>`, resolution })
			if (resolution.outcome === 'resolved') {
				const { target } = resolution
				const url = target.kind === 'link' ? target.href : `#${target.address}`
				next = { ...node, attrs: { ...node.attrs, url } }
			}
		}
		const content = next.content
		if (!content) return next
		if (content.some((c) => c.type === 'text'))
			return { ...next, content: resolveInline(content, context, found) }
		return { ...next, content: content.map(visit) }
	}
	return { body: visit(body), found }
}

/** The targets beyond a template: the Principles document as the seed maps it, and the
 *  pathways the catalogue names (published at `/p/{pathwaySlug}`). */
export function hyperlinkTargets(
	principles: SeedResult,
	pathways: readonly { pathwaySlug: string; subject: string }[],
): HyperlinkTargets {
	return {
		principles: {
			slug: principles.document.slug,
			sections: principles.sections.map((s) => ({ address: s.address, title: s.title })),
		},
		pathways: pathways.map((p) => ({ slug: p.pathwaySlug, subject: p.subject })),
	}
}
