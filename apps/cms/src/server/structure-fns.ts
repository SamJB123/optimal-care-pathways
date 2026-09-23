/**
 * The structure doors as server functions: each binds the worker's environment and the
 * verified caller and hands off to `structure.ts`, which the workerd tests exercise
 * directly. A refusal reaches the page as its message.
 */

import { createServerFn } from '@tanstack/solid-start'
import { z } from 'zod'
import { requireUser } from './env.ts'
import { lifecycleOf } from './lifecycle-env.ts'
import * as structure from './structure.ts'

const id = z.string().min(1).max(64)
const title = z.string().trim().min(1).max(200)

export const setSectionHidden = createServerFn({ method: 'POST' })
	.inputValidator(z.object({ sectionId: id, hidden: z.boolean() }))
	.handler(async ({ data, context }) =>
		structure.setSectionHidden(await lifecycleOf(), {
			...data,
			userId: requireUser(context.userId),
		}),
	)

export const addSubsection = createServerFn({ method: 'POST' })
	.inputValidator(z.object({ parentId: id, title, afterId: id.nullable() }))
	.handler(async ({ data, context }) =>
		structure.addSubsection(await lifecycleOf(), { ...data, userId: requireUser(context.userId) }),
	)

export const renameSection = createServerFn({ method: 'POST' })
	.inputValidator(z.object({ sectionId: id, title }))
	.handler(async ({ data, context }) =>
		structure.renameSection(await lifecycleOf(), { ...data, userId: requireUser(context.userId) }),
	)

export const moveSection = createServerFn({ method: 'POST' })
	.inputValidator(z.object({ sectionId: id, parentId: id, beforeId: id.nullable() }))
	.handler(async ({ data, context }) =>
		structure.moveSection(await lifecycleOf(), { ...data, userId: requireUser(context.userId) }),
	)

export const deleteSection = createServerFn({ method: 'POST' })
	.inputValidator(z.object({ sectionId: id }))
	.handler(async ({ data, context }) =>
		structure.deleteSection(await lifecycleOf(), { ...data, userId: requireUser(context.userId) }),
	)

export const setPointOfCare = createServerFn({ method: 'POST' })
	.inputValidator(z.object({ sectionId: id, on: z.boolean() }))
	.handler(async ({ data, context }) =>
		structure.setPointOfCare(await lifecycleOf(), { ...data, userId: requireUser(context.userId) }),
	)
