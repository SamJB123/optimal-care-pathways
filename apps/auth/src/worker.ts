/**
 * The pathways' auth worker entry: the canonical `@aicolab/better-auth` D1 AuthService,
 * extended with the one door this application needs beyond authentication —
 * notification email (decision 99). The auth worker already holds the Resend key and
 * the sender address for its one-time codes, so it is the one worker that sends mail;
 * the cms worker holds no mail credentials and calls this door over the service binding.
 *
 * Portal uses the D1 path; the PG path lives at
 * `@aicolab/better-auth/cloudflare/pg/worker` for deployments that bind Hyperdrive.
 */

import { AuthService as BaseAuthService } from '@aicolab/better-auth/cloudflare/d1/worker'
import { Resend } from 'resend'

export interface NotificationMail {
	to: string[]
	subject: string
	text: string
}

export type NotificationResult = { sent: number } | { sent: 0; skipped: 'no-recipients' | 'no-mail-key' }

export class AuthService extends BaseAuthService {
	/**
	 * Send one plain-text notification to each recipient. Without a Resend key (local
	 * dev) the mail is logged and reported skipped, never thrown: notifications are
	 * best-effort and the action that caused them has already committed.
	 */
	async sendNotification(mail: NotificationMail): Promise<NotificationResult> {
		const to = [...new Set(mail.to.map((a) => a.trim().toLowerCase()).filter(Boolean))]
		if (to.length === 0) return { sent: 0, skipped: 'no-recipients' }
		const key = this.env.RESEND_API_KEY
		if (!key) {
			console.log(`[DEV] notification to ${to.join(', ')}: ${mail.subject}\n${mail.text}`)
			return { sent: 0, skipped: 'no-mail-key' }
		}
		const resend = new Resend(key)
		const from = this.env.EMAIL_FROM_ADDRESS || 'noreply@aicolab.org'
		let sent = 0
		for (const recipient of to) {
			const result = await resend.emails.send({
				from,
				to: recipient,
				subject: mail.subject,
				text: mail.text,
			})
			if (result.error) console.error('[notification] send failed:', result.error)
			else sent++
		}
		return { sent }
	}
}

export default AuthService
