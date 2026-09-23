/**
 * How a section's printed number reads beside its title. The template's step headings
 * are set as "Step 1: Prevention…" — Word's auto-number carries the colon — while a
 * numbered heading reads "1.1 Prevention". The number is stored bare (decision: the
 * renderer adds the separator), so every surface that shows a number goes through here.
 */
export const numberLabel = (printedNumber: string): string =>
	/^Step \d+$/.test(printedNumber) ? `${printedNumber}:` : printedNumber

/** What a document is called where space is short (the atlas, the masthead, the jump):
 *  a pathway by its subject ("Breast cancer"), a core document by what it is. The full
 *  title stays the document's own heading. */
export function documentName(document: {
	kind: 'core' | 'pathway'
	audience: 'cancer' | 'population' | 'principles'
	subject: string
}): string {
	if (document.kind === 'core')
		return document.audience === 'principles'
			? 'Principles for Optimal Cancer Care'
			: document.audience === 'cancer'
				? 'Cancer-specific template'
				: 'Population template'
	const subject = document.subject.trim()
	return subject.charAt(0).toUpperCase() + subject.slice(1)
}

/** Dates read in Australian time wherever they are rendered, so the server's text and the
 *  hydrating client's agree. */
const ZONE = 'Australia/Sydney'
const IMPRINT = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: ZONE })
const SHORT = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: ZONE })
const MONTH = new Intl.DateTimeFormat('en-AU', { month: 'long', year: 'numeric', timeZone: ZONE })

/** A date as the imprint sets it: '14 March 2026'. */
export const imprintDate = (ms: number): string => IMPRINT.format(ms)

/** A short date: '14 Mar 2026'. */
export const shortDate = (ms: number): string => SHORT.format(ms)

/** A month: 'March 2026'. */
export const monthDate = (ms: number): string => MONTH.format(ms)

/** How long ago, in plain words, against `now` (pass the server's time on first render so
 *  both sides agree): 'just now', '5 min ago', '3 h ago', 'yesterday', '4 days ago', then
 *  the short date. */
export function ago(ms: number, now: number): string {
	const minutes = Math.round((now - ms) / 60_000)
	if (minutes < 1) return 'just now'
	if (minutes < 60) return `${minutes} min ago`
	const hours = Math.round(minutes / 60)
	if (hours < 24) return `${hours} h ago`
	const days = Math.round(hours / 24)
	if (days === 1) return 'yesterday'
	if (days < 14) return `${days} days ago`
	return shortDate(ms)
}
