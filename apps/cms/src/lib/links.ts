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

/** The fragment a section is reached by on a page: its address, made a valid id. */
export const sectionAnchor = (address: string): string => `s-${address.replace(/[^a-z0-9]+/gi, '-')}`
