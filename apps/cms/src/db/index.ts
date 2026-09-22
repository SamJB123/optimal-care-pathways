import { defineRelations } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from './schema.ts'

/** Relational config (drizzle v1 RQB v2), for the reads that read better as a join. */
export const relations = defineRelations(schema, (r) => ({
	documents: {
		template: r.one.templates({
			from: r.documents.templateId,
			to: r.templates.id,
			optional: false,
		}),
		sections: r.many.sections({ from: r.documents.id, to: r.sections.documentId }),
		versions: r.many.versions({ from: r.documents.id, to: r.versions.documentId }),
		references: r.many.references({ from: r.documents.id, to: r.references.documentId }),
	},
	sections: {
		document: r.one.documents({ from: r.sections.documentId, to: r.documents.id, optional: false }),
		core: r.one.sections({ from: r.sections.coreSectionId, to: r.sections.id }),
		origins: r.many.sectionOrigins({ from: r.sections.id, to: r.sectionOrigins.sectionId }),
		comments: r.many.comments({ from: r.sections.id, to: r.comments.sectionId }),
	},
	versions: {
		document: r.one.documents({
			from: r.versions.documentId,
			to: r.documents.id,
			optional: false,
		}),
		sections: r.many.versionSections({ from: r.versions.id, to: r.versionSections.versionId }),
		reviews: r.many.reviews({ from: r.versions.id, to: r.reviews.versionId }),
	},
	reviews: {
		version: r.one.versions({ from: r.reviews.versionId, to: r.versions.id, optional: false }),
		sections: r.many.reviewSections({ from: r.reviews.id, to: r.reviewSections.reviewId }),
	},
	legacyDocuments: {
		sections: r.many.legacySections({
			from: r.legacyDocuments.id,
			to: r.legacySections.documentId,
		}),
	},
}))

/** Drizzle handle over the content D1 (env.DB). */
export const db = (d1: D1Database) => drizzle(d1, { relations })

export type Db = ReturnType<typeof db>
export * as schema from './schema.ts'
