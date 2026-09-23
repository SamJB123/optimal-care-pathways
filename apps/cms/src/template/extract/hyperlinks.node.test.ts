/**
 * The "<hyperlink to be added>" resolver: each rule on sentences taken from the 2026
 * templates, the notes it must leave alone, the rewrite of a body (the words marked, the
 * note cut out, the text around it kept), and the three templates end to end as the seed
 * maps them.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type JsonMark, type JsonNode, parseBody } from '#/content/schema.ts'
import { LEGACY_PATHWAYS } from '#/legacy/catalogue.ts'
import { TEMPLATES, templateByKey } from '../templates.ts'
import {
	type HyperlinkTargets,
	hyperlinkTargets,
	resolveHyperlinks,
	resolveWords,
	type ShowingDocument,
} from './hyperlinks.ts'
import { mapTemplate } from './map-to-content.ts'
import type { ExtractedDocument } from './model.ts'

const targets: HyperlinkTargets = {
	principles: {
		slug: 'principles',
		sections: [
			{ address: 'equity', title: 'Equity' },
			{ address: 'person-centred-care', title: 'Person-centred care' },
			{ address: 'safe-and-quality-care', title: 'Safe and quality care' },
			{ address: 'supportive-care', title: 'Supportive care' },
			{
				address: 'supportive-care/domains-of-supportive-care',
				title: 'Domains of supportive care',
			},
			{ address: 'research-and-clinical-trials', title: 'Research and clinical trials' },
		],
	},
	pathways: [
		{ slug: 'older-people-with-cancer', subject: 'older people with cancer' },
		{ slug: 'breast-cancer', subject: 'breast cancer' },
	],
}

/** The cancer template's steps and the numbered sections the notes name. */
const cancer: ShowingDocument = {
	kind: 'cancer',
	sections: [
		{ address: '1', title: 'Prevention, screening and early detection' },
		{ address: '1.1.3', title: 'Genetic testing for inherited (germline) cancer risk' },
		{ address: '3.2', title: 'Genetic or genomic testing' },
		{ address: '4', title: 'Treatment' },
		{ address: '4.3', title: 'Treatment overview' },
		{ address: '6', title: 'Managing residual, recurrent or metastatic disease' },
		{
			address: '6.5',
			title: 'Supporting health and wellbeing for people with advanced (metastatic) cancer',
		},
		{ address: '7', title: 'End-of-life care' },
	],
}

const principlesDoc: ShowingDocument = { kind: 'principles', sections: targets.principles.sections }

const resolved = (before: string, doc: ShowingDocument = cancer) => {
	const r = resolveWords(before, doc, targets)
	if (r.outcome !== 'resolved') throw new Error(`left: ${r.reason}`)
	return r
}
const left = (before: string, doc: ShowingDocument = cancer) => {
	const r = resolveWords(before, doc, targets)
	if (r.outcome !== 'left') throw new Error(`resolved to ${JSON.stringify(r.target)}`)
	return r.reason
}

describe('rules', () => {
	it('a Principle in a See also entry links to its section of the Principles', () => {
		expect(resolved('Supportive care (Principle) ')).toMatchObject({
			rule: 'principle',
			words: 'Supportive care (Principle)',
			target: { kind: 'link', href: '/p/principles#supportive-care' },
		})
		expect(resolved('Safety netting: in Safe and quality care (Principle) ')).toMatchObject({
			words: 'Safety netting: in Safe and quality care (Principle)',
			target: { href: '/p/principles#safe-and-quality-care' },
		})
		expect(resolved('Person-centred care (Principle): Informed consent ')).toMatchObject({
			words: 'Person-centred care (Principle): Informed consent',
			target: { href: '/p/principles#person-centred-care' },
		})
	})

	it('inside the Principles document a Principle is a cross-reference to its own section', () => {
		expect(
			resolved('Informed consent – in Person-centred care (Principle) ', principlesDoc),
		).toMatchObject({
			target: { kind: 'section', address: 'person-centred-care' },
		})
	})

	it('the Principles list takes the name and drops the second note', () => {
		expect(resolved('Equity <Link to Principle > ')).toMatchObject({
			words: 'Equity',
			target: { href: '/p/principles#equity' },
		})
	})

	it('a Principle named in a sentence links the name and the word', () => {
		expect(
			resolved(
				'Common supportive care needs for people with cancer are listed in the Supportive care principle ',
			),
		).toMatchObject({
			words: 'Supportive care principle',
			target: { href: '/p/principles#supportive-care' },
		})
	})

	it('the Principles document links to its published page', () => {
		expect(
			resolved(
				'The template focuses on pathway steps for the OCP. Pathway steps are underpinned by the Principles for Optimal Cancer Care ',
			),
		).toMatchObject({
			rule: 'document',
			words: 'Principles for Optimal Cancer Care',
			target: { href: '/p/principles' },
		})
		expect(resolved('All OCPs are underpinned by Principles for Optimal Cancer Care. ').words).toBe(
			'Principles for Optimal Cancer Care',
		)
	})

	it('a named pathway links to its published page', () => {
		expect(
			resolved('Optimal care pathway for older people with cancer ', principlesDoc),
		).toMatchObject({
			rule: 'pathway',
			target: { href: '/p/older-people-with-cancer' },
		})
		expect(left('Optimal care pathway for people with glioma ', principlesDoc)).toMatch(
			/No pathway/,
		)
	})

	it('a step is a cross-reference to that step of the showing document', () => {
		expect(
			resolved('Step 6: Managing recurrent, residual or metastatic disease (Pathway step) '),
		).toMatchObject({
			rule: 'step',
			words: 'Step 6: Managing recurrent, residual or metastatic disease (Pathway step)',
			target: { kind: 'section', address: '6' },
		})
		expect(resolved(' Step 7: End of life care (Pathway step) ').target).toMatchObject({
			address: '7',
		})
		expect(resolved('Step 4 Treatment (Pathway step) ').target).toMatchObject({ address: '4' })
		expect(resolved('Communication about genetic risk (Pathway step 1) ')).toMatchObject({
			words: 'Communication about genetic risk (Pathway step 1)',
			target: { kind: 'section', address: '1' },
		})
	})

	it('a numbered section is a cross-reference to it', () => {
		expect(resolved('3.2 Genetic or genomic testing (Pathway step) ')).toMatchObject({
			rule: 'section',
			words: '3.2 Genetic or genomic testing (Pathway step)',
			target: { address: '3.2' },
		})
		expect(
			resolved(
				'For information about genetic risk for [cancer type] see Section 1.1.3 Genetic testing inherited (germline) cancer risk ',
			),
		).toMatchObject({
			words: 'Section 1.1.3 Genetic testing inherited (germline) cancer risk',
			target: { address: '1.1.3' },
		})
		expect(
			resolved(
				'Common unmet needs for people with advanced (metastatic) cancer are listed in section 6.5. ',
			),
		).toMatchObject({
			words: 'section 6.5',
			target: { address: '6.5' },
		})
	})

	it('leaves what it cannot be sure of', () => {
		// The number and the title disagree: step 6 is not end-of-life care.
		expect(left('Step 6: End-of-life care (Pathway step) ')).toMatch(/Step 6 of this document/)
		// The Principles document has no steps.
		expect(left('Advance care planning (Pathway step 6) ', principlesDoc)).toMatch(/no step 6/)
		// A kind of pathway, not one; a topic with no page here.
		expect(left('Population-based OCPs ', principlesDoc)).toMatch(/No rule/)
		expect(
			left(
				'Multidisciplinary team membership for individual cancer types <Cancer-specific OCPs> ',
				principlesDoc,
			),
		).toMatch(/No rule/)
		expect(left('Voluntary assisted dying ')).toMatch(/No rule/)
		expect(left('Guide to Best Cancer Care for people with [cancer type]')).toMatch(/No rule/)
		// Nothing before the note to carry a link.
		expect(left('')).toMatch(/Nothing before/)
	})
})

const text = (value: string, marks?: JsonNode['marks']): JsonNode =>
	marks ? { type: 'text', text: value, marks } : { type: 'text', text: value }
const doc = (...content: JsonNode[]): JsonNode => ({ type: 'doc', content })
const paragraph = (...content: JsonNode[]): JsonNode => ({ type: 'paragraph', content })

describe('rewriting a body', () => {
	it('marks the words and cuts the note, keeping the sentence around it', () => {
		const { body, found } = resolveHyperlinks(
			doc(
				paragraph(
					text(
						'Review the Principles for Optimal Cancer Care <hyperlink to be added> when developing content.',
					),
				),
			),
			cancer,
			targets,
		)
		expect(found).toHaveLength(1)
		expect(body).toEqual(
			doc(
				paragraph(
					text('Review the '),
					text('Principles for Optimal Cancer Care', [
						{ type: 'link', attrs: { href: '/p/principles' } },
					]),
					text(' when developing content.'),
				),
			),
		)
	})

	it('keeps punctuation between the words and the note', () => {
		const bold: JsonMark = { type: 'bold' }
		const { body } = resolveHyperlinks(
			doc(
				paragraph(
					text('All OCPs are underpinned by '),
					text('Principles for Optimal Cancer Care. ', [bold]),
					text('<hyperlink to be added>'),
				),
			),
			cancer,
			targets,
		)
		expect(body).toEqual(
			doc(
				paragraph(
					text('All OCPs are underpinned by '),
					text('Principles for Optimal Cancer Care', [
						bold,
						{ type: 'link', attrs: { href: '/p/principles' } },
					]),
					text('.', [bold]),
				),
			),
		)
	})

	it('cuts a placeholder-marked note and the "<Link to Principle>" note with it', () => {
		const note: JsonMark = { type: 'placeholder', attrs: { label: '<hyperlink to be added>' } }
		const { body } = resolveHyperlinks(
			doc(
				paragraph(
					text('Equity <Link to Principle > ', [{ type: 'bold' }]),
					text('<hyperlink to be added>', [note]),
				),
			),
			cancer,
			targets,
		)
		expect(body).toEqual(
			doc(
				paragraph(
					text('Equity', [
						{ type: 'bold' },
						{ type: 'link', attrs: { href: '/p/principles#equity' } },
					]),
				),
			),
		)
	})

	it('resolves two notes in one paragraph, each from the words since the one before', () => {
		const { body, found } = resolveHyperlinks(
			doc(
				paragraph(
					text(
						'Step 6: Managing recurrent, residual or metastatic disease (Pathway step) <hyperlink to be added> Step 7: End-of-life care (Pathway step) <hyperlink to be added>',
					),
				),
			),
			cancer,
			targets,
		)
		expect(found.map((f) => f.resolution.outcome)).toEqual(['resolved', 'resolved'])
		expect(body).toEqual(
			doc(
				paragraph(
					text('Step 6: Managing recurrent, residual or metastatic disease (Pathway step)', [
						{ type: 'sectionLink', attrs: { address: '6' } },
					]),
					text(' '),
					text('Step 7: End-of-life care (Pathway step)', [
						{ type: 'sectionLink', attrs: { address: '7' } },
					]),
				),
			),
		)
	})

	it('leaves an uncertain note exactly as printed', () => {
		const printed = doc(paragraph(text('Voluntary assisted dying <hyperlink to be added>')))
		const { body, found } = resolveHyperlinks(printed, cancer, targets)
		expect(body).toEqual(printed)
		expect(found[0]?.resolution).toMatchObject({ outcome: 'left' })
	})

	it('gives a noted See also entry the address its title names, and no other entry', () => {
		const noted: JsonNode = {
			type: 'resource',
			attrs: { title: 'Step 7 End-of-life care (Pathway step)', url: '' },
		}
		const plain: JsonNode = {
			type: 'resource',
			attrs: { title: 'Research and clinical trials (Principle)', url: '' },
		}
		const { body, found } = resolveHyperlinks(
			doc({ type: 'resourceList', content: [noted, plain] }),
			cancer,
			targets,
			(n) => n === noted,
		)
		expect(found).toHaveLength(1)
		expect(body.content?.[0]?.content?.map((r) => r.attrs?.url)).toEqual(['#7', ''])
	})
})

describe('the 2026 templates', () => {
	const dataDir = join(import.meta.dirname, '..', '..', '..', 'template', '2026', 'extracted')
	const read = (key: string): ExtractedDocument =>
		JSON.parse(readFileSync(join(dataDir, `${key}.model.json`), 'utf8'))
	const id = (kind: string, key: string) => `${kind}:${key}`
	const principles = templateByKey('principles')
	const links = hyperlinkTargets(
		mapTemplate({ model: read(principles.key), template: principles, orgId: 'test', id }),
		LEGACY_PATHWAYS,
	)
	const mapped = TEMPLATES.map((template) =>
		mapTemplate({ model: read(template.key), template, orgId: 'test', id, hyperlinks: links }),
	)

	it('finds every note, text and See also entry alike, and resolves all but the uncertain', () => {
		// Principles, cancer template, population template.
		expect(mapped.map((m) => m.hyperlinks.length)).toEqual([25, 59, 65])
		expect(
			mapped.map((m) => m.hyperlinks.filter((h) => h.resolution.outcome === 'resolved').length),
		).toEqual([21, 54, 52])
	})

	it('leaves in the text only the notes left as is, and every body stays valid', () => {
		// The rest of those left are See also entries, whose note the mapper already took out.
		const printed = mapped.map((m) =>
			m.sections.reduce((n, s) => {
				let count = 0
				const visit = (node: JsonNode) => {
					if (node.type === 'text')
						count += (node.text ?? '').split('<hyperlink to be added>').length - 1
					for (const child of node.content ?? []) visit(child)
				}
				visit(s.bodyJson)
				return n + count
			}, 0),
		)
		expect(printed).toEqual([4, 3, 11])
		for (const m of mapped)
			for (const s of m.sections) expect(() => parseBody(s.bodyJson)).not.toThrow()
	})
})
