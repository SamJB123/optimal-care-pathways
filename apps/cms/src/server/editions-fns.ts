/**
 * The edition imprint and the comparison as server functions: each binds the worker's
 * environment and the verified caller and hands off to `editions.ts`, which the workerd
 * tests exercise directly. Server functions only: a plain export here would keep its
 * imports (the worker's env) alive in the client bundle.
 */

import { createServerFn } from '@tanstack/solid-start'
import { z } from 'zod'
import * as editions from './editions.ts'
import { requireUser } from './env.ts'
import { lifecycleOf } from './lifecycle-env.ts'

const documentIdSchema = z.object({ documentId: z.string().min(1).max(64) })
const editionRef = z.union([z.literal('draft'), z.number().int().min(1)])

export const editionsOf = createServerFn({ method: 'GET' })
	.inputValidator(documentIdSchema)
	.handler(async ({ data, context }) =>
		editions.editionsOf(await lifecycleOf(), data.documentId, requireUser(context.userId)),
	)

export const compareEditions = createServerFn({ method: 'GET' })
	.inputValidator(documentIdSchema.extend({ from: editionRef, to: editionRef }))
	.handler(async ({ data, context }) =>
		editions.compareEditions(await lifecycleOf(), {
			documentId: data.documentId,
			from: data.from,
			to: data.to,
			userId: requireUser(context.userId),
		}),
	)
