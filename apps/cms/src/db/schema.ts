/**
 * The content schema — the SQL source of truth. D1, one database.
 *
 * WHAT A DOCUMENT IS. Either a CORE-CONTENT document (one per template kind, owned by the
 * central organisation: Cancer Australia's black "core content", and the Principles) or a
 * PATHWAY (one per cancer type or population group, owned by its own organisation). Both
 * have the same shape and the same lifecycle: a tree of sections, drafted live, snapshotted
 * at submit-for-review and at publish.
 *
 * WHAT A SECTION IS. A heading-delimited region, at the template's own depth, with the
 * template's addressing: a numbered heading IS its number ('3', '3.1', '3.1.1'), which the
 * template declares immutable; an unnumbered section is addressed by parent plus its own
 * name ('3/supportive-care'). A section is OWNED — it holds this document's draft body as
 * ProseMirror JSON — or SHARED — it holds no body and renders the core document's section
 * it points at. Divergence is an ownership change (shared → owned, body copied) and back.
 *
 * WHERE LIVE EDITING GOES. The section room (a Durable Object per document) hosts one yjs
 * body per section and folds it into `sections.body_json` on a short debounce. The DO holds
 * only yjs state, replaceable from this row at any time. Nothing here is written by a DO
 * except that column and its `updated_*` pair.
 *
 * WHAT A VERSION IS (decisions 115–117). Every document has, at any time, exactly one
 * DRAFT version (whose content is the live `sections` rows), at most one PUBLISHED
 * version and any number of ARCHIVED ones. Publishing freezes the draft's sections —
 * body RESOLVED (a shared section's core body as published) and rendered to HTML and
 * Markdown — into `version_sections`, marks the draft published, archives the incumbent
 * and opens the next draft. `last_changed_version_no` on a version section is the
 * partner site's per-section "last updated". A review is of the draft version and pins
 * each reviewed section's body hash; decisions live per section and roll up in a view.
 *
 * SHARED CONTENT IS STORED ONCE (decision 118). A shared section holds no body; a
 * citation names a reference row by id wherever that row lives, so a pathway's
 * references list is the union of the rows its resolved bodies cite. Nothing of the
 * core is copied into a pathway except the template scaffold of the sections the
 * template hands to the pathway to write.
 *
 * Timestamps are epoch-ms integers. Ids are UUIDs. Every user reference is a better-auth
 * user id; membership and roles live in the auth worker, keyed by `documents.org_id`.
 */

import { and, eq, sql } from 'drizzle-orm'
import {
	index,
	integer,
	primaryKey,
	real,
	sqliteTable,
	sqliteView,
	text,
	uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import type { JsonNode } from '#/content/schema.ts'

const timestampMs = (name: string) => integer(name, { mode: 'timestamp_ms' })
const bool = (name: string) => integer(name, { mode: 'boolean' })
const createdAt = () =>
	timestampMs('created_at').default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`).notNull()

// ---------------------------------------------------------------------------
// Templates — Cancer Australia's structure, versioned
// ---------------------------------------------------------------------------

export const TEMPLATE_KINDS = ['cancer', 'population', 'principles'] as const
export type TemplateKind = (typeof TEMPLATE_KINDS)[number]

/** One row per template revision Cancer Australia issues. The core-content document
 *  for a kind follows its template; a pathway pins the template it was seeded from and
 *  moves to a newer one only by an explicit, reported migration. */
export const templates = sqliteTable('templates', {
	id: text('id').primaryKey(), // e.g. 'cancer-2026-07'
	kind: text('kind').$type<TemplateKind>().notNull(),
	/** As printed: 'Public consultation draft, July 2026'. */
	label: text('label').notNull(),
	sourceFile: text('source_file').notNull(),
	issuedOn: text('issued_on'), // as printed, e.g. '20 July 2026'
	pageCount: integer('page_count'),
	createdAt: createdAt(),
})

// ---------------------------------------------------------------------------
// Documents — core content and pathways, one shape
// ---------------------------------------------------------------------------

export const DOCUMENT_KINDS = ['core', 'pathway'] as const
export type DocumentKind = (typeof DOCUMENT_KINDS)[number]

export const AUDIENCES = ['cancer', 'population', 'principles'] as const
export type Audience = (typeof AUDIENCES)[number]

export const documents = sqliteTable(
	'documents',
	{
		id: text('id').primaryKey(),
		kind: text('kind').$type<DocumentKind>().notNull(),
		templateId: text('template_id')
			.notNull()
			.references(() => templates.id),
		/** The better-auth organisation whose members draft, review and view this document.
		 *  The central organisation for core documents, which therefore exists before any
		 *  document does: creating it is the first step of a fresh deployment. */
		orgId: text('org_id').notNull(),
		/** This system's own address, e.g. 'breast-cancer'. */
		slug: text('slug').notNull(),
		/** The partner site's slug for this document (Cancer Council controls it). */
		partnerSlug: text('partner_slug'),
		title: text('title').notNull(),
		/** What the document is about — 'Breast cancer', 'Older people with cancer'.
		 *  Substituted into shared prose at render time. */
		subject: text('subject').notNull(),
		audience: text('audience').$type<Audience>().notNull(),
		/** The pathway's family colour (#rrggbb): the accent its printed edition set its
		 *  step bands in, read by the legacy import; chosen for a new pathway; null for the
		 *  core documents, which stay neutral. */
		accent: text('accent'),
		createdAt: createdAt(),
		updatedAt: timestampMs('updated_at'),
	},
	(t) => [uniqueIndex('documents_slug').on(t.slug), index('documents_org').on(t.orgId)],
)

// ---------------------------------------------------------------------------
// Sections — the tree, the addresses, the draft bodies
// ---------------------------------------------------------------------------

export const OWNERSHIPS = ['shared', 'owned'] as const
export type Ownership = (typeof OWNERSHIPS)[number]

export const sections = sqliteTable(
	'sections',
	{
		id: text('id').primaryKey(),
		documentId: text('document_id')
			.notNull()
			.references(() => documents.id, { onDelete: 'cascade' }),
		parentId: text('parent_id'),
		/** THE CANONICAL ADDRESS within the document (see the file comment). */
		address: text('address').notNull(),
		/** True where the address is the template's printed number, and therefore
		 *  immutable: cannot be renamed or reordered, only hidden. */
		canonical: bool('canonical').notNull().default(false),
		printedNumber: text('printed_number'),
		title: text('title'),
		headingLevel: integer('heading_level'),
		/** REAL, so an unnumbered section can be inserted between two that cannot move. */
		orderIndex: real('order_index').notNull(),
		/** Denormalised pathway step (1–7), null outside the steps. */
		stepNumber: integer('step_number'),
		ownership: text('ownership').$type<Ownership>().notNull().default('owned'),
		/** For a shared section: the core document's section it renders. */
		coreSectionId: text('core_section_id'),
		/** Core documents only: the template's rule for this section — what a pathway
		 *  seeded from it starts as. 'shared' renders the core body by reference; 'owned'
		 *  copies the core body as the pathway's starting draft. Null on pathway sections. */
		pathwayOwnership: text('pathway_ownership').$type<Ownership>(),
		/** Template scaffolding a document never renders: the developer instructions,
		 *  the cover banner, the contents page. */
		apparatus: bool('apparatus').notNull().default(false),
		/** Removed sections are hidden, not deleted: the canonical spine stays comparable. */
		hidden: bool('hidden').notNull().default(false),
		/** Belongs in the quick reference guide (a derived view). */
		pointOfCare: bool('point_of_care').notNull().default(false),
		/** The draft body, ProseMirror JSON in the content schema (src/content/schema.ts),
		 *  folded from the section room. Drafting guidance (the template's green and purple
		 *  text) lives INSIDE the body as `guidance` nodes, where the author needs it, and is
		 *  stripped at publish. Null when shared. */
		bodyJson: text('body_json', { mode: 'json' }).$type<JsonNode>(),
		/** Provenance: the pages of the source PDF this section was extracted from, as
		 *  printed ("13" or "13-14"). Set by the seed for core documents and by the legacy
		 *  import; null on sections an author created. The review page reads it. */
		sourcePages: text('source_pages'),
		/** The glyph printed beside the heading (a principle's icon), as a URL the app
		 *  serves; null for most sections (decision 65). */
		icon: text('icon'),
		/** Reference ids cited ON the heading itself ("Principles of multidisciplinary
		 *  care⁵²"): a title is plain text, so its markers live here and render after it,
		 *  counted first in the section's citation order. */
		titleCitations: text('title_citations', { mode: 'json' }).$type<string[]>(),
		/** Set by the legacy import on a section whose place in the template was not
		 *  declared by the template itself — legacy content appended under a step with no
		 *  matching section ('unplaced: …'), or moved to a destination chosen by reading
		 *  ('proposed: …'). An author clears it by keeping, moving or removing the section.
		 *  Null on every other section. */
		migrationNote: text('migration_note'),
		updatedAt: timestampMs('updated_at'),
		updatedBy: text('updated_by'),
	},
	(t) => [
		uniqueIndex('sections_document_address').on(t.documentId, t.address),
		index('sections_document').on(t.documentId),
		index('sections_parent').on(t.parentId),
		index('sections_core').on(t.coreSectionId),
	],
)

// ---------------------------------------------------------------------------
// References — cited from a body by a typed mark carrying the reference id
// ---------------------------------------------------------------------------

export const references = sqliteTable(
	'references',
	{
		id: text('id').primaryKey(),
		documentId: text('document_id')
			.notNull()
			.references(() => documents.id, { onDelete: 'cascade' }),
		/** The citation as printed in the References list. */
		citation: text('citation').notNull(),
		url: text('url'),
		/** The number the source document printed, kept for provenance; numbering in the
		 *  rendered document is derived from citation order. */
		printedNumber: integer('printed_number'),
		createdAt: createdAt(),
	},
	(t) => [index('references_document').on(t.documentId)],
)

// ---------------------------------------------------------------------------
// Versions — draft, published, archived (decisions 115–117)
// ---------------------------------------------------------------------------

export const VERSION_STATUSES = ['draft', 'published', 'archived'] as const
export type VersionStatus = (typeof VERSION_STATUSES)[number]

/**
 * One row per version of a document. Exactly one 'draft' per document at any time (its
 * content is the live `sections`); at most one 'published' (publishing archives the
 * incumbent in the same batch); the rest 'archived'. `version_no` is assigned when the
 * draft is opened (the incumbent's number plus one), so a draft is "Version 3 (draft)".
 */
export const versions = sqliteTable(
	'versions',
	{
		id: text('id').primaryKey(),
		documentId: text('document_id')
			.notNull()
			.references(() => documents.id, { onDelete: 'cascade' }),
		status: text('status').$type<VersionStatus>().notNull().default('draft'),
		versionNo: integer('version_no').notNull(),
		/** An edition label such as 'Second edition'; set at publish. */
		label: text('label'),
		/** What changed in this version, written for readers of the published document
		 *  (public release notes); set at publish. */
		releaseNotes: text('release_notes'),
		/** For a pathway: the core document's PUBLISHED version its shared sections were
		 *  resolved against at publish. */
		coreVersionId: text('core_version_id'),
		createdAt: createdAt(),
		createdBy: text('created_by').notNull(),
		publishedAt: timestampMs('published_at'),
		publishedBy: text('published_by'),
	},
	(t) => [
		index('versions_document').on(t.documentId),
		uniqueIndex('versions_document_no').on(t.documentId, t.versionNo),
		index('versions_status').on(t.documentId, t.status),
	],
)

/** One row per section as it stood when the version was published: body RESOLVED (a
 *  shared section's core body as published) and rendered. Written only at publish; a
 *  draft's sections are the live `sections` rows. */
export const versionSections = sqliteTable(
	'version_sections',
	{
		versionId: text('version_id')
			.notNull()
			.references(() => versions.id, { onDelete: 'cascade' }),
		sectionId: text('section_id').notNull(),
		parentAddress: text('parent_address'),
		address: text('address').notNull(),
		title: text('title'),
		printedNumber: text('printed_number'),
		orderIndex: real('order_index').notNull(),
		ownership: text('ownership').$type<Ownership>().notNull(),
		hidden: bool('hidden').notNull(),
		pointOfCare: bool('point_of_care').notNull(),
		bodyJson: text('body_json', { mode: 'json' }).$type<JsonNode>(),
		html: text('html'),
		markdown: text('markdown'),
		/** The version in which this section's resolved body last changed — the partner
		 *  site's per-section "last updated". */
		lastChangedVersionNo: integer('last_changed_version_no').notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.versionId, t.sectionId] }),
		index('version_sections_address').on(t.versionId, t.address),
	],
)

// ---------------------------------------------------------------------------
// Reviews — decisions per section on the draft, rolled up in a view (decision 95, 119)
// ---------------------------------------------------------------------------

export const SECTION_DECISIONS = ['approved', 'changes_requested'] as const
export type SectionDecision = (typeof SECTION_DECISIONS)[number]

/**
 * A review is of the DRAFT version and covers everything that changed since the
 * published version (decision 112: review cycles are publish cycles). It stores no
 * decision of its own: `review_state` derives it from the sections. A later request on
 * the same draft supersedes an earlier one (the latest review per draft is the one that
 * counts).
 */
export const reviews = sqliteTable(
	'reviews',
	{
		id: text('id').primaryKey(),
		documentId: text('document_id')
			.notNull()
			.references(() => documents.id, { onDelete: 'cascade' }),
		versionId: text('version_id')
			.notNull()
			.references(() => versions.id, { onDelete: 'cascade' }),
		requestedBy: text('requested_by').notNull(),
		requestedAt: createdAt(),
		note: text('note'),
	},
	(t) => [index('reviews_document').on(t.documentId), index('reviews_version').on(t.versionId)],
)

/**
 * One row per section the review must decide — the sections whose resolved body differs
 * from the published version — pinning the body's hash at request time (decision 120):
 * publishing requires every pinned hash to still match, so what was approved is what is
 * published. Decision null until a reviewer decides.
 */
export const reviewSections = sqliteTable(
	'review_sections',
	{
		reviewId: text('review_id')
			.notNull()
			.references(() => reviews.id, { onDelete: 'cascade' }),
		sectionId: text('section_id').notNull(),
		bodyHash: text('body_hash').notNull(),
		decision: text('decision').$type<SectionDecision>(),
		note: text('note'),
		decidedBy: text('decided_by'),
		decidedAt: timestampMs('decided_at'),
	},
	(t) => [primaryKey({ columns: [t.reviewId, t.sectionId] })],
)

// ---------------------------------------------------------------------------
// Comments — threads per section, at every stage (decision 99, 110)
// ---------------------------------------------------------------------------

/** A comment on a section, or — on a SHARED section — a suggested change addressed to
 *  the central organisation, which lists suggestions on the core document (decision 26). */
export const COMMENT_KINDS = ['comment', 'suggestion'] as const
export type CommentKind = (typeof COMMENT_KINDS)[number]

export const comments = sqliteTable(
	'comments',
	{
		id: text('id').primaryKey(),
		documentId: text('document_id')
			.notNull()
			.references(() => documents.id, { onDelete: 'cascade' }),
		sectionId: text('section_id')
			.notNull()
			.references(() => sections.id, { onDelete: 'cascade' }),
		kind: text('kind').$type<CommentKind>().notNull().default('comment'),
		body: text('body').notNull(),
		authorId: text('author_id').notNull(),
		authorName: text('author_name').notNull(),
		createdAt: createdAt(),
		resolvedAt: timestampMs('resolved_at'),
		resolvedBy: text('resolved_by'),
	},
	(t) => [index('comments_section').on(t.sectionId), index('comments_document').on(t.documentId)],
)

// ---------------------------------------------------------------------------
// Views — "currently published" and the review roll-up, one shape for every reader
// ---------------------------------------------------------------------------

/**
 * The published version of every document that has one (decision 98): the document row
 * beside its 'published' version row. Publishing archives the incumbent in the same
 * batch, so there is at most one such row per document and no "latest" to pick. The
 * public API, the composed view and a pathway's publish (which resolves shared sections
 * against the core's published version) read this and never re-derive "current".
 */
export const publishedVersions = sqliteView('published_versions').as((qb) =>
	qb
		.select({
			// Both tables have an `id`; a view's columns must be distinct, so each is aliased.
			documentId: sql<string>`${documents.id}`.as('document_id'),
			kind: documents.kind,
			templateId: documents.templateId,
			orgId: documents.orgId,
			slug: documents.slug,
			partnerSlug: documents.partnerSlug,
			title: documents.title,
			subject: documents.subject,
			audience: documents.audience,
			versionId: sql<string>`${versions.id}`.as('version_id'),
			versionNo: versions.versionNo,
			label: versions.label,
			releaseNotes: versions.releaseNotes,
			coreVersionId: versions.coreVersionId,
			publishedAt: versions.publishedAt,
			publishedBy: versions.publishedBy,
		})
		.from(versions)
		.innerJoin(documents, eq(documents.id, versions.documentId))
		.where(eq(versions.status, 'published')),
)

/** The sections of every published version, resolved and rendered, hidden ones left out. */
export const publishedSections = sqliteView('published_sections').as((qb) =>
	qb
		.select({
			documentId: versions.documentId,
			versionId: versionSections.versionId,
			versionNo: versions.versionNo,
			sectionId: versionSections.sectionId,
			parentAddress: versionSections.parentAddress,
			address: versionSections.address,
			title: versionSections.title,
			printedNumber: versionSections.printedNumber,
			orderIndex: versionSections.orderIndex,
			ownership: versionSections.ownership,
			pointOfCare: versionSections.pointOfCare,
			bodyJson: versionSections.bodyJson,
			html: versionSections.html,
			markdown: versionSections.markdown,
			lastChangedVersionNo: versionSections.lastChangedVersionNo,
		})
		.from(versionSections)
		.innerJoin(versions, eq(versions.id, versionSections.versionId))
		.where(and(eq(versions.status, 'published'), eq(versionSections.hidden, false))),
)

/**
 * A review's state, derived from its sections (decision 119): how many sections it
 * covers, how many are decided, and the roll-up — 'changes_requested' as soon as any
 * section says so, 'approved' once every section is approved, null while open.
 * `superseded` is true when a later review exists on the same draft.
 */
export const reviewState = sqliteView('review_state').as((qb) =>
	qb
		.select({
			reviewId: reviews.id,
			documentId: reviews.documentId,
			versionId: reviews.versionId,
			requestedBy: reviews.requestedBy,
			requestedAt: reviews.requestedAt,
			note: reviews.note,
			total: sql<number>`count(${reviewSections.sectionId})`.as('total'),
			decided: sql<number>`count(${reviewSections.decision})`.as('decided'),
			approved:
				sql<number>`coalesce(sum(case when ${reviewSections.decision} = 'approved' then 1 else 0 end), 0)`.as(
					'approved',
				),
			changesRequested:
				sql<number>`coalesce(sum(case when ${reviewSections.decision} = 'changes_requested' then 1 else 0 end), 0)`.as(
					'changes_requested',
				),
			decision: sql<SectionDecision | null>`case
				when coalesce(sum(case when ${reviewSections.decision} = 'changes_requested' then 1 else 0 end), 0) > 0 then 'changes_requested'
				when count(${reviewSections.sectionId}) > 0 and count(${reviewSections.decision}) = count(${reviewSections.sectionId}) then 'approved'
				else null end`.as('decision'),
			// SQLite has no boolean: 1 when a later review exists on the same draft, else 0.
			superseded: sql<number>`exists (
				select 1 from ${reviews} later
				where later.version_id = ${reviews.versionId}
				and later.created_at > ${reviews.requestedAt}
			)`.as('superseded'),
		})
		.from(reviews)
		.leftJoin(reviewSections, eq(reviewSections.reviewId, reviews.id))
		.groupBy(reviews.id),
)

// ---------------------------------------------------------------------------
// Provenance — where a section's content came from
// ---------------------------------------------------------------------------

export const LEGACY_FORMATS = ['full', 'quick_reference_guide'] as const
export type LegacyFormat = (typeof LEGACY_FORMATS)[number]

/** The published documents that predate the 2026 template, as re-extracted from their
 *  PDFs. Read-only in this system; kept until every pathway is republished. */
export const legacyDocuments = sqliteTable(
	'legacy_documents',
	{
		id: text('id').primaryKey(),
		slug: text('slug').notNull(),
		title: text('title').notNull(),
		audience: text('audience').$type<Audience>().notNull(),
		format: text('format').$type<LegacyFormat>().notNull(),
		edition: text('edition'),
		publicationDate: text('publication_date'),
		/** The source PDF's key in the files bucket. */
		pdfKey: text('pdf_key'),
		createdAt: createdAt(),
	},
	(t) => [uniqueIndex('legacy_documents_slug').on(t.slug)],
)

export const legacySections = sqliteTable(
	'legacy_sections',
	{
		id: text('id').primaryKey(),
		documentId: text('document_id')
			.notNull()
			.references(() => legacyDocuments.id, { onDelete: 'cascade' }),
		parentId: text('parent_id'),
		level: integer('level').notNull(),
		orderIndex: real('order_index').notNull(),
		heading: text('heading'),
		/** The legacy identity key the section mapping addresses ('step-3/staging'). */
		key: text('key'),
		bodyJson: text('body_json', { mode: 'json' }).$type<JsonNode>(),
	},
	(t) => [
		index('legacy_sections_document').on(t.documentId),
		index('legacy_sections_parent').on(t.parentId),
	],
)

/** Which legacy sections fed a section's body. Survives renames and moves. */
export const sectionOrigins = sqliteTable(
	'section_origins',
	{
		sectionId: text('section_id')
			.notNull()
			.references(() => sections.id, { onDelete: 'cascade' }),
		legacySectionId: text('legacy_section_id')
			.notNull()
			.references(() => legacySections.id, { onDelete: 'cascade' }),
		/** Characters this legacy section contributed, so a split is visible. */
		chars: integer('chars').notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.sectionId, t.legacySectionId] }),
		index('section_origins_legacy').on(t.legacySectionId),
	],
)

// ---------------------------------------------------------------------------
// Events — the activity line
// ---------------------------------------------------------------------------

export const events = sqliteTable(
	'events',
	{
		id: text('id').primaryKey(),
		documentId: text('document_id').references(() => documents.id, { onDelete: 'cascade' }),
		/** 'document.created', 'section.diverged', 'review.requested', 'version.published'… */
		kind: text('kind').notNull(),
		actorId: text('actor_id').notNull(),
		actorName: text('actor_name').notNull(),
		detail: text('detail', { mode: 'json' }),
		at: createdAt(),
	},
	(t) => [index('events_document_at').on(t.documentId, t.at)],
)
