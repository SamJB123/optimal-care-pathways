/**
 * A team's roles in words (lib/roles.ts's labels), for the team page, the join pages and
 * the mail the team functions send.
 */

import { ROLE_LABELS, type Role } from './roles.ts'

/** A role as a team calls it: the ladder's labels, except that the central team's owner
 *  leads no pathway. */
export const roleName = (role: Role, central: boolean): string => (central && role === 'owner' ? 'Lead' : ROLE_LABELS[role])

/** A role inside a sentence: "added as a drafter", "the only pathway lead". */
export const roleWord = (role: Role, central: boolean): string => roleName(role, central).toLowerCase()
