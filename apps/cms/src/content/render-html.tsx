/**
 * A body as static HTML (decision 97): the same Solid renderer the pages use, run to a
 * string in the Worker at publish time, so the published HTML is exactly what the site
 * shows. Server-only: the client never needs a string.
 */

import { renderToString } from '@solidjs/web'
import type { DerivedView } from './derived.ts'
import { RenderedBody } from './render.tsx'
import type { JsonNode } from './schema.ts'

export function renderBodyHtml(body: JsonNode, derived: DerivedView): string {
	return renderToString(() => <RenderedBody body={body} derived={derived} />)
}
