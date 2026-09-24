/**
 * Where a document is read: its published page, its quick reference guide and their
 * PDFs, an earlier edition, the draft preview, the workspace. Every link to those places
 * goes through here, so a route is named once.
 *
 * Two forms. The `…Link` builders are typed router destinations (`linkOptions`): spread
 * one into `<Link>` or hand it to `navigate()`, and the router checks the route and its
 * params and navigates without leaving the page — the app's socket, rooms and documents
 * live on across the move. The `…Href` strings remain for what is not a route of this
 * app's router: files the worker serves (PDFs, Word), the API, and anchors.
 */

import { type LinkOptions, linkOptions } from '@tanstack/solid-router'

/** A typed destination in this app, as the masthead's crumbs and links carry one. */
export type AppLink = LinkOptions

export const homeLink = () => linkOptions({ to: '/' })
export const libraryLink = () => linkOptions({ to: '/library' })
export const adminLink = () => linkOptions({ to: '/admin' })
export const publishedLink = (slug: string) => linkOptions({ to: '/p/$slug', params: { slug } })
export const editionLink = (slug: string, versionNo: number) =>
	linkOptions({ to: '/p/$slug/v/$version', params: { slug, version: String(versionNo) } })
export const guideLink = (slug: string) =>
	linkOptions({ to: '/p/$slug/quick-reference-guide', params: { slug } })
export const workspaceLink = (documentId: string) =>
	linkOptions({ to: '/d/$documentId', params: { documentId } })
export const partLink = (documentId: string, part: string) =>
	linkOptions({ to: '/d/$documentId/$part', params: { documentId, part } })
export const sectionLink = (documentId: string, part: string, address: string) =>
	linkOptions({
		to: '/d/$documentId/$part',
		params: { documentId, part },
		hash: sectionAnchor(address),
	})
export const previewLink = (documentId: string) =>
	linkOptions({ to: '/d/$documentId/preview', params: { documentId } })
export const legacyLink = (slug: string) => linkOptions({ to: '/legacy/$slug', params: { slug } })
export const fidelityLink = (documentId: string) =>
	linkOptions({ to: '/review/$documentId', params: { documentId } })
export const suggestionsLink = (documentId: string) =>
	linkOptions({ to: '/d/$documentId/suggestions', params: { documentId } })
export const teamLink = (documentId: string) =>
	linkOptions({ to: '/d/$documentId/team', params: { documentId } })
export const editionsLink = (documentId: string) =>
	linkOptions({ to: '/d/$documentId/versions', params: { documentId } })
export const referencesLink = (documentId: string) =>
	linkOptions({ to: '/d/$documentId/references', params: { documentId } })

export const publishedHref = (slug: string): string => `/p/${slug}`
export const editionHref = (slug: string, versionNo: number): string => `/p/${slug}/v/${versionNo}`
export const guideHref = (slug: string): string => `/p/${slug}/quick-reference-guide`
export const pdfHref = (slug: string): string => `/api/v1/documents/${slug}.pdf`
export const guidePdfHref = (slug: string): string =>
	`/api/v1/documents/${slug}-quick-reference-guide.pdf`
export const workspaceHref = (documentId: string): string => `/d/${documentId}`
export const partHref = (documentId: string, part: string): string =>
	`/d/${documentId}/${encodeURIComponent(part)}`
export const sectionHref = (documentId: string, part: string, address: string): string =>
	`${partHref(documentId, part)}#${sectionAnchor(address)}`
export const previewHref = (documentId: string): string => `/d/${documentId}/preview`
/** A previous edition as its PDF printed it. */
export const legacyHref = (slug: string): string => `/legacy/${slug}`
/** A core template set against the template PDF it was read from. */
export const fidelityHref = (documentId: string): string => `/review/${documentId}`
/** The draft as a watermarked PDF, and as a Word file (guidance left out of both). */
export const draftPdfHref = (documentId: string): string => `/d/${documentId}/draft.pdf`
export const draftDocxHref = (documentId: string): string => `/d/${documentId}/draft.docx`
export const editionsHref = (documentId: string): string => `/d/${documentId}/versions`
/** The document's team: who works on it, and the ways in. */
export const teamHref = (documentId: string): string => `/d/${documentId}/team`
/** Two editions side by side; `draft` stands for the draft in work. */
export const compareHref = (
	documentId: string,
	from: number | 'draft',
	to: number | 'draft',
): string => `/d/${documentId}/versions?from=${from}&to=${to}`

/** The fragment a section is reached by on a page: its address, made a valid id. */
export const sectionAnchor = (address: string): string =>
	`s-${address.replace(/[^a-z0-9]+/gi, '-')}`
