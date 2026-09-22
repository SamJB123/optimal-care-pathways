/**
 * The published-content capability over capnweb (decision 122): the same operations as
 * methods on an RpcTarget, for first-party callers on the app's existing socket. Each
 * method is one line that delegates to the table entry of the same name, so the
 * surface cannot drift from REST or MCP; capnweb exposes prototype methods only, which
 * is why these are written out rather than generated onto an instance.
 */

import { callOperation } from '@aicolab/app-kit/api'
import { RpcTarget } from 'capnweb-experimental-hibernation'
import type { z } from 'zod'
import {
	fetchItem,
	getComposed,
	getDocument,
	getDocumentFull,
	getSection,
	listDocuments,
	listVersions,
	search,
} from './operations.ts'
import type { ApiContext } from './published.ts'

type In<Op extends { input: z.ZodObject }> = z.input<Op['input']>

export class PublishedApi extends RpcTarget {
	readonly #ctx: ApiContext

	constructor(ctx: ApiContext) {
		super()
		this.#ctx = ctx
	}

	list_documents(input: In<typeof listDocuments> = {}) {
		return callOperation(listDocuments, input, this.#ctx)
	}

	get_document(input: In<typeof getDocument>) {
		return callOperation(getDocument, input, this.#ctx)
	}

	get_section(input: In<typeof getSection>) {
		return callOperation(getSection, input, this.#ctx)
	}

	get_document_full(input: In<typeof getDocumentFull>) {
		return callOperation(getDocumentFull, input, this.#ctx)
	}

	list_versions(input: In<typeof listVersions>) {
		return callOperation(listVersions, input, this.#ctx)
	}

	get_composed(input: In<typeof getComposed>) {
		return callOperation(getComposed, input, this.#ctx)
	}

	search(input: In<typeof search>) {
		return callOperation(search, input, this.#ctx)
	}

	fetch(input: In<typeof fetchItem>) {
		return callOperation(fetchItem, input, this.#ctx)
	}
}
