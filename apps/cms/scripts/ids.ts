import { createHash } from 'node:crypto'

/**
 * A deterministic UUID for a canonical key: SHA-256 of `ocp:<kind>:<key>`, laid out as a
 * version-5-style UUID. The same template entry always seeds the same row, so re-seeding
 * replaces rather than duplicates.
 */
export function deterministicId(kind: string, key: string): string {
	const hex = createHash('sha256').update(`ocp:${kind}:${key}`).digest('hex')
	const variant = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16)
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
