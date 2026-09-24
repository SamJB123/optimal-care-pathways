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
import { sectionAnchor } from './hrefs.ts'

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

/* The plain paths live in hrefs.ts, which never touches the router, so the seed scripts
   and the extractor can use them; they are the same functions from here. */
export {
	compareHref,
	draftDocxHref,
	draftPdfHref,
	editionHref,
	editionsHref,
	fidelityHref,
	guideHref,
	guidePdfHref,
	legacyHref,
	partHref,
	pdfHref,
	previewHref,
	publishedHref,
	sectionAnchor,
	sectionHref,
	teamHref,
	workspaceHref,
} from './hrefs.ts'
