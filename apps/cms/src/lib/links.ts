/**
 * Where a document is read: its published page, its quick reference guide and their
 * PDFs, an earlier edition, the draft preview, the workspace. Every link to those places
 * goes through here, so a route is named once.
 */

export const publishedHref = (slug: string): string => `/p/${slug}`
export const editionHref = (slug: string, versionNo: number): string => `/p/${slug}/v/${versionNo}`
export const guideHref = (slug: string): string => `/p/${slug}/quick-reference-guide`
export const pdfHref = (slug: string): string => `/api/v1/documents/${slug}.pdf`
export const guidePdfHref = (slug: string): string => `/api/v1/documents/${slug}-quick-reference-guide.pdf`
export const workspaceHref = (documentId: string): string => `/d/${documentId}`
export const partHref = (documentId: string, part: string): string =>
	`/d/${documentId}/${encodeURIComponent(part)}`
export const sectionHref = (documentId: string, part: string, address: string): string =>
	`${partHref(documentId, part)}#${sectionAnchor(address)}`
export const previewHref = (documentId: string): string => `/d/${documentId}/preview`
/** The draft as a watermarked PDF, and as a Word file (guidance left out of both). */
export const draftPdfHref = (documentId: string): string => `/d/${documentId}/draft.pdf`
export const draftDocxHref = (documentId: string): string => `/d/${documentId}/draft.docx`
export const editionsHref = (documentId: string): string => `/d/${documentId}/versions`
/** Two editions side by side; `draft` stands for the draft in work. */
export const compareHref = (documentId: string, from: number | 'draft', to: number | 'draft'): string =>
	`/d/${documentId}/versions?from=${from}&to=${to}`

/** The fragment a section is reached by on a page: its address, made a valid id. */
export const sectionAnchor = (address: string): string => `s-${address.replace(/[^a-z0-9]+/gi, '-')}`
