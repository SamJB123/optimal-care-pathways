/**
 * The published-HTML renderer as the workerd test pool sees it (vitest.config.ts aliases
 * `#/content/render-html.tsx` here): the real one is Solid JSX compiled for the server,
 * which that pool does not compile and the node project proves. This one renders a body's
 * text in the same wrapper, enough for tests to see that HTML came back.
 */

import type { DerivedView } from '#/content/derived.ts'
import type { JsonNode } from '#/content/schema.ts'

const plain = (node: JsonNode): string =>
	node.type === 'text' ? (node.text ?? '') : (node.content ?? []).map(plain).join('')

export function renderBodyHtml(body: JsonNode, _derived: DerivedView): string {
	return `<div class="ocp-body">${plain(body)}</div>`
}
