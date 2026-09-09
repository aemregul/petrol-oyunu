/**
 * Who gets the admin panel (Emre, 2026-09-09: the test panel is gone, an
 * owner's panel takes its place). Membership comes from .env — a list of
 * Firebase user ids, or of e-mails as a convenience — so the code carries
 * no names. The panel only ever touches the admin's own save, so this is
 * a door for the owner, not a wall against anyone: nothing behind it can
 * reach another player's game.
 */

import { AccountProfile } from './account';

const env = import.meta.env as Record<string, string | undefined>;

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

/** Pure, for the tests: does this account appear in either list? */
export function accountIsAdmin(
  account: AccountProfile | null,
  uids: string[],
  emails: string[]
): boolean {
  if (!account || account.provider === 'guest') return false;
  if (uids.includes(account.uid.toLowerCase())) return true;
  const email = account.email?.toLowerCase();
  return !!email && emails.includes(email);
}

export function isAdmin(account: AccountProfile | null): boolean {
  return accountIsAdmin(account, list(env.VITE_ADMIN_UIDS), list(env.VITE_ADMIN_EMAILS));
}
