/**
 * How a section's printed number reads beside its title. The template's step headings
 * are set as "Step 1: Prevention…" — Word's auto-number carries the colon — while a
 * numbered heading reads "1.1 Prevention". The number is stored bare (decision: the
 * renderer adds the separator), so every surface that shows a number goes through here.
 */
export const numberLabel = (printedNumber: string): string =>
	/^Step \d+$/.test(printedNumber) ? `${printedNumber}:` : printedNumber
