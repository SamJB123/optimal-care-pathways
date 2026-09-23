/**
 * Uploaded files: a section's images, in the FILES bucket under
 * `images/<documentId>/<uuid>.<ext>`. Only a drafter (or above) of the document may add
 * one; reading is public (src/routes/files.$.ts), because a published page shows them.
 * An upload is never overwritten or deleted here: the key is new each time, so the URL
 * can be cached for good.
 */

import { createServerFn } from '@tanstack/solid-start'
import { eq } from 'drizzle-orm'
import { schema } from '#/db/index.ts'
import { ROLE_LADDER } from '#/lib/roles.ts'
import { documentRoleOf } from './access.ts'
import { envOf, requireUser } from './env.ts'

/** The image types a section may carry, and the extension each is stored under. */
export const IMAGE_TYPES = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/webp': 'webp',
	'image/gif': 'gif',
	'image/svg+xml': 'svg',
} as const satisfies Record<string, string>

export const IMAGE_ACCEPT = Object.keys(IMAGE_TYPES).join(',')
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024

const imageExtension = (type: string): string | null =>
	Object.entries(IMAGE_TYPES).find(([mime]) => mime === type)?.[1] ?? null

/** Why a file cannot be uploaded, in words for the drafter; null when it can. */
export function imageProblem(file: { type: string; size: number }): string | null {
	if (!imageExtension(file.type)) return 'Choose a PNG, JPEG, WebP, GIF or SVG image.'
	if (file.size === 0) return 'That file is empty.'
	if (file.size > IMAGE_MAX_BYTES)
		return 'That image is larger than 8 MB. Make it smaller and try again.'
	return null
}

/** The URL an uploaded file is served at. */
export const fileHref = (key: string): string => `/files/${key}`

/** Build the upload's form: the document it belongs to, and the file. */
export function imageUploadForm(documentId: string, file: File): FormData {
	const form = new FormData()
	form.set('documentId', documentId)
	form.set('file', file)
	return form
}

export const uploadImage = createServerFn({ method: 'POST' })
	.inputValidator((form: FormData) => {
		if (!(form instanceof FormData)) throw new Error('Send the image as a form.')
		const documentId = form.get('documentId')
		const file = form.get('file')
		if (typeof documentId !== 'string' || !/^[\w-]{1,64}$/.test(documentId))
			throw new Error('Which document is this image for?')
		if (!(file instanceof File)) throw new Error('Choose an image to upload.')
		return { documentId, file }
	})
	.handler(async ({ data, context }): Promise<{ src: string }> => {
		const userId = requireUser(context.userId)
		const { env, d } = await envOf()
		const document = (
			await d
				.select({ orgId: schema.documents.orgId })
				.from(schema.documents)
				.where(eq(schema.documents.id, data.documentId))
				.limit(1)
		)[0]
		if (!document) throw new Error('Document not found.')
		const role = await documentRoleOf(env.AUTH, d, userId, document.orgId)
		if (!role || ROLE_LADDER.indexOf(role) < ROLE_LADDER.indexOf('member'))
			throw new Error('Only a drafter of this document can add images to it.')
		const problem = imageProblem(data.file)
		if (problem) throw new Error(problem)
		const extension = imageExtension(data.file.type) ?? 'bin'
		const key = `images/${data.documentId}/${crypto.randomUUID()}.${extension}`
		await env.FILES.put(key, await data.file.arrayBuffer(), {
			httpMetadata: {
				contentType: data.file.type,
				cacheControl: 'public, max-age=31536000, immutable',
			},
			customMetadata: { uploadedBy: userId, name: data.file.name.slice(0, 200) },
		})
		return { src: fileHref(key) }
	})
