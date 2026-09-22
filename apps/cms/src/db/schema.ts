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
 * WHAT A VERSION IS. A snapshot row plus one row per section with the body RESOLVED (a
 * shared section's core body as it was at that moment) and rendered to HTML and Markdown.
 * Publish snapshots carry a version number and an optional edition label; review
 * snapshots carry none. `last_changed_version_no` on a snapshot section is the partner
 * site's per-section "last updated".
 *
 * Timestamps are epoch-ms integers. Ids are UUIDs. Every user reference is a better-auth
 * user id; membership and roles live in the auth worker, keyed by `documents.org_id`.
 */

import { sql } from 'drizzle-orm'
import {
	index,
	integer,
	primaryKey,
	real,
	sqliteTable,
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

/** The draft's workflow state. Published versions are snapshots, not a state. */
export const DOCUMENT_STATUSES = ['draft', 'in_review', 'approved'] as const
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number]

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
		status: text('status').$type<DocumentStatus>().notNull().default('draft'),
		/** The latest published version number; 0 = never published. */
		publishedVersionNo: integer('published_version_no').notNull().default(0),
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
// Snapshots — review checkpoints and published versions
// ---------------------------------------------------------------------------

export const SNAPSHOT_KINDS = ['review', 'publish'] as const
export type SnapshotKind = (typeof SNAPSHOT_KINDS)[number]

export const snapshots = sqliteTable(
	'snapshots',
	{
		id: text('id').primaryKey(),
		documentId: text('document_id')
			.notNull()
			.references(() => documents.id, { onDelete: 'cascade' }),
		kind: text('kind').$type<SnapshotKind>().notNull(),
		/** Publish snapshots only: 1, 2, 3… per document. */
		versionNo: integer('version_no'),
		/** Publish snapshots only: an edition label such as 'Second edition'. */
		label: text('label'),
		/** For a pathway: the core document's publish snapshot its shared sections were
		 *  resolved against. */
		coreSnapshotId: text('core_snapshot_id'),
		createdAt: createdAt(),
		createdBy: text('created_by').notNull(),
		note: text('note'),
	},
	(t) => [
		index('snapshots_document').on(t.documentId),
		uniqueIndex('snapshots_document_version').on(t.documentId, t.versionNo),
	],
)

/** One row per section as it stood in the snapshot, body resolved and rendered. */
export const snapshotSections = sqliteTable(
	'snapshot_sections',
	{
		snapshotId: text('snapshot_id')
			.notNull()
			.references(() => snapshots.id, { onDelete: 'cascade' }),
		sectionId: text('section_id').notNull(),
		parentAddress: text('parent_address'),
		address: text('address').notNull(),
		title: text('title'),
		printedNumber: text('printed_number'),
		orderIndex: real('order_index').notNull(),
		ownership: text('ownership').$type<Ownership>().notNull(),
		hidden: bool('hidden').notNull(),
		pointOfCare: bool('point_of_care').notNull(),
		/** The resolved body: the section's own, or the core section's at that moment. */
		bodyJson: text('body_json', { mode: 'json' }).$type<JsonNode>(),
		html: text('html'),
		markdown: text('markdown'),
		/** The publish version in which this section's resolved body last changed — the
		 *  partner site's per-section "last updated". Null on review snapshots. */
		lastChangedVersionNo: integer('last_changed_version_no'),
	},
	(t) => [
		primaryKey({ columns: [t.snapshotId, t.sectionId] }),
		index('snapshot_sections_address').on(t.snapshotId, t.address),
	],
)

// ---------------------------------------------------------------------------
// Reviews — a reviewer's decision on a review snapshot
// ---------------------------------------------------------------------------

export const REVIEW_DECISIONS = ['approved', 'changes_requested'] as const
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number]

export const reviews = sqliteTable(
	'reviews',
	{
		id: text('id').primaryKey(),
		documentId: text('document_id')
			.notNull()
			.references(() => documents.id, { onDelete: 'cascade' }),
		snapshotId: text('snapshot_id')
			.notNull()
			.references(() => snapshots.id, { onDelete: 'cascade' }),
		requestedBy: text('requested_by').notNull(),
		requestedAt: createdAt(),
		decidedBy: text('decided_by'),
		decidedAt: timestampMs('decided_at'),
		decision: text('decision').$type<ReviewDecision>(),
		note: text('note'),
	},
	(t) => [index('reviews_document').on(t.documentId)],
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
