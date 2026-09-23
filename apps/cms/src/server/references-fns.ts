/**
 * A document's references as server functions: each binds the worker's environment and
 * the verified caller and hands off to `references.ts`, which the workerd tests exercise
 * directly. A refusal reaches the page as its message.
 */

import { createServerFn } from '@tanstack/solid-start'
import { z } from 'zod'
import { requireUser } from './env.ts'
import { lifecycleOf } from './lifecycle-env.ts'
import * as references from './references.ts'

const id = z.string().min(1).max(64)
const documentIdSchema = z.object({ documentId: id })
const citation = z.string().trim().min(1).max(4000)
const url = z.string().trim().max(2000).nullable()

/** A reference row as the page carries it: its timestamp as epoch ms. */
export type ReferenceWire = Omit<references.ReferenceRow, 'createdAt'> & { createdAt: number }

const referenceWire = (r: references.ReferenceRow): ReferenceWire => ({
	...r,
	createdAt: r.createdAt.getTime(),
})

export const listReferences = createServerFn({ method: 'GET' })
	.inputValidator(documentIdSchema)
	.handler(async ({ data, context }) =>
		references.listReferences(await lifecycleOf(), {
			documentId: data.documentId,
			userId: requireUser(context.userId),
		}),
	)

export const searchReferences = createServerFn({ method: 'GET' })
	.inputValidator(documentIdSchema.extend({ query: z.string().max(200) }))
	.handler(async ({ data, context }) =>
		references.searchReferences(await lifecycleOf(), {
			...data,
			userId: requireUser(context.userId),
		}),
	)

export const addReference = createServerFn({ method: 'POST' })
	.inputValidator(documentIdSchema.extend({ citation, url }))
	.handler(async ({ data, context }) =>
		referenceWire(
			await references.addReference(await lifecycleOf(), {
				documentId: data.documentId,
				citation: data.citation,
				url: data.url || null,
				userId: requireUser(context.userId),
			}),
		),
	)

export const editReference = createServerFn({ method: 'POST' })
	.inputValidator(documentIdSchema.extend({ referenceId: id, citation, url }))
	.handler(async ({ data, context }) =>
		references.editReference(await lifecycleOf(), {
			referenceId: data.referenceId,
			documentId: data.documentId,
			citation: data.citation,
			url: data.url || null,
			userId: requireUser(context.userId),
		}),
	)

export const deleteReference = createServerFn({ method: 'POST' })
	.inputValidator(documentIdSchema.extend({ referenceId: id }))
	.handler(async ({ data, context }) =>
		references.deleteReference(await lifecycleOf(), {
			...data,
			userId: requireUser(context.userId),
		}),
	)
