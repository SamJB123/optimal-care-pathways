/**
 * The lifecycle as server functions: each binds the worker's environment and the
 * verified caller and hands off to `lifecycle.ts`, which the workerd tests exercise
 * directly. A refusal from the lifecycle reaches the page as its message.
 */

import { createServerFn } from '@tanstack/solid-start'
import { z } from 'zod'
import { renderBodyHtml } from '#/content/render-html.tsx'
import { centralOrgId } from './access.ts'
import { envOf, requireUser } from './env.ts'
import * as lifecycle from './lifecycle.ts'

const documentIdSchema = z.object({ documentId: z.string().min(1).max(64) })

/** The lifecycle bound to this worker's bindings and the request's origin. */
async function lifecycleOf(): Promise<lifecycle.Lifecycle> {
	const { env, d } = await envOf()
	let central: Promise<string | null> | null = null
	return {
		d,
		auth: env.AUTH,
		rooms: env.DOCUMENT_ROOM,
		centralOrgId: () => {
			central ??= centralOrgId(env.AUTH, d)
			return central
		},
		origin: env.PUBLIC_ORIGIN ?? 'https://ocp-cms.aicolab.workers.dev',
		renderHtml: renderBodyHtml,
		purge: async (tags) => {
			// biome-ignore lint/correctness/noUnresolvedImports: provided by the Workers runtime
			const { cache } = await import('cloudflare:workers')
			await cache.purge({ tags })
		},
	}
}

export const documentState = createServerFn({ method: 'GET' })
	.inputValidator(documentIdSchema)
	.handler(async ({ data, context }) =>
		lifecycle.documentState(await lifecycleOf(), data.documentId, requireUser(context.userId)),
	)

export const requestReview = createServerFn({ method: 'POST' })
	.inputValidator(documentIdSchema.extend({ note: z.string().trim().max(2000).nullable() }))
	.handler(async ({ data, context }) =>
		lifecycle.requestReview(await lifecycleOf(), {
			documentId: data.documentId,
			userId: requireUser(context.userId),
			note: data.note || null,
		}),
	)

export const decideSection = createServerFn({ method: 'POST' })
	.inputValidator(
		z.object({
			reviewId: z.string().min(1).max(64),
			sectionId: z.string().min(1).max(64),
			decision: z.enum(['approved', 'changes_requested']),
			note: z.string().trim().max(2000).nullable(),
		}),
	)
	.handler(async ({ data, context }) => {
		const state = await lifecycle.decideSection(await lifecycleOf(), {
			...data,
			note: data.note || null,
			userId: requireUser(context.userId),
		})
		return { ...state, requestedAt: state.requestedAt.getTime() }
	})

export const publishReadiness = createServerFn({ method: 'GET' })
	.inputValidator(documentIdSchema)
	.handler(async ({ data, context }) =>
		lifecycle.publishReadiness(await lifecycleOf(), data.documentId, requireUser(context.userId)),
	)

export const publishDocument = createServerFn({ method: 'POST' })
	.inputValidator(
		documentIdSchema.extend({
			label: z.string().trim().max(120).nullable(),
			releaseNotes: z.string().trim().max(5000).nullable(),
		}),
	)
	.handler(async ({ data, context }) =>
		lifecycle.publish(await lifecycleOf(), {
			documentId: data.documentId,
			userId: requireUser(context.userId),
			label: data.label || null,
			releaseNotes: data.releaseNotes || null,
		}),
	)

export const versionsOf = createServerFn({ method: 'GET' })
	.inputValidator(documentIdSchema)
	.handler(async ({ data, context }) => {
		const lc = await lifecycleOf()
		// Membership is checked the same way every read is.
		await lifecycle.listComments(lc, data.documentId, requireUser(context.userId))
		return lifecycle.versionsOf(lc, data.documentId)
	})

/** A comment as the page carries it: timestamps as epoch ms. */
export type CommentWire = Omit<lifecycle.CommentRow, 'createdAt' | 'resolvedAt'> & {
	createdAt: number
	resolvedAt: number | null
}

const commentWire = (c: lifecycle.CommentRow): CommentWire => ({
	...c,
	createdAt: c.createdAt.getTime(),
	resolvedAt: c.resolvedAt?.getTime() ?? null,
})

export const listComments = createServerFn({ method: 'GET' })
	.inputValidator(documentIdSchema)
	.handler(async ({ data, context }) =>
		(
			await lifecycle.listComments(
				await lifecycleOf(),
				data.documentId,
				requireUser(context.userId),
			)
		).map(commentWire),
	)

export const addComment = createServerFn({ method: 'POST' })
	.inputValidator(
		documentIdSchema.extend({
			sectionId: z.string().min(1).max(64),
			kind: z.enum(['comment', 'suggestion']),
			body: z.string().trim().min(1).max(5000),
		}),
	)
	.handler(async ({ data, context }) =>
		commentWire(
			await lifecycle.addComment(await lifecycleOf(), {
				...data,
				userId: requireUser(context.userId),
			}),
		),
	)

export const resolveComment = createServerFn({ method: 'POST' })
	.inputValidator(z.object({ commentId: z.string().min(1).max(64), resolved: z.boolean() }))
	.handler(async ({ data, context }) =>
		commentWire(
			await lifecycle.resolveComment(await lifecycleOf(), {
				...data,
				userId: requireUser(context.userId),
			}),
		),
	)

export const suggestionsForCore = createServerFn({ method: 'GET' })
	.inputValidator(documentIdSchema)
	.handler(async ({ data, context }) =>
		lifecycle.suggestionsForCore(await lifecycleOf(), data.documentId, requireUser(context.userId)),
	)

export const divergeSection = createServerFn({ method: 'POST' })
	.inputValidator(z.object({ sectionId: z.string().min(1).max(64) }))
	.handler(async ({ data, context }) => {
		await lifecycle.divergeSection(await lifecycleOf(), {
			...data,
			userId: requireUser(context.userId),
		})
		return { ok: true }
	})

export const revertSection = createServerFn({ method: 'POST' })
	.inputValidator(z.object({ sectionId: z.string().min(1).max(64) }))
	.handler(async ({ data, context }) => {
		await lifecycle.revertSection(await lifecycleOf(), {
			...data,
			userId: requireUser(context.userId),
		})
		return { ok: true }
	})
