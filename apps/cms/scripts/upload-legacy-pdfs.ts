/**
 * Puts the previous editions' PDFs (legacy/source, decision 139) into the files bucket
 * under legacy/<file>, where /files/legacy/<file> serves them to readers of the edition
 * as printed. They are not the site's static files, so a deploy does not carry them.
 *
 *   pnpm r2:legacy:local    — the local dev bucket (.wrangler/state)
 *   pnpm r2:legacy:remote   — the deployed bucket (a deploy step, run with approval)
 *
 * Re-running replaces each object with the same bytes; a PDF's key never changes.
 */

import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const BUCKET = 'ocp-cms-files'
const where = process.argv[2]
if (where !== '--local' && where !== '--remote') {
	console.error('usage: tsx scripts/upload-legacy-pdfs.ts --local | --remote')
	process.exit(2)
}
const appDir = join(import.meta.dirname, '..')
const sourceDir = join(appDir, 'legacy', 'source')
const files = readdirSync(sourceDir).filter((f) => f.endsWith('.pdf'))
for (const file of files) {
	execFileSync(
		'pnpm',
		[
			'exec',
			'wrangler',
			'r2',
			'object',
			'put',
			`${BUCKET}/legacy/${file}`,
			'--file',
			join(sourceDir, file),
			'--content-type',
			'application/pdf',
			'--cache-control',
			'public, max-age=31536000, immutable',
			...(where === '--local' ? ['--local', '--persist-to', join(appDir, '.wrangler', 'state')] : ['--remote']),
		],
		{ stdio: ['ignore', 'ignore', 'inherit'], cwd: appDir },
	)
	console.log(`legacy/${file}`)
}
console.log(`${files.length} PDFs put in ${BUCKET} (${where.slice(2)}).`)
