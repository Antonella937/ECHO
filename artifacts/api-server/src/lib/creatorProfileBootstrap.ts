import { clerkClient } from '@clerk/express';
import { pool } from '@workspace/db';

/** Every admitted ECHO account gets a private, searchable Creator Hub profile.
 * Never copy a third-party avatar or publish an email address.
 */
export async function ensureCreatorProfile(ownerId: string): Promise<void> {
  const existing = await pool.query('SELECT 1 FROM echo_creator_profiles WHERE owner_id=$1', [ownerId]);
  if (existing.rowCount) return;
  const client = clerkClient;
  const user = await client.users.getUser(ownerId);
  const email = user.emailAddresses.find(item => item.id === user.primaryEmailAddressId)?.emailAddress
    ?? user.emailAddresses[0]?.emailAddress ?? '';
  const local = email.split('@')[0].toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 30);
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  const displayName = (name || user.username || local || 'ECHO Creator').slice(0, 80);
  const suffix = ownerId.replace(/[^a-z0-9]/gi, '').slice(-10).toLowerCase();
  const base = /^[a-z0-9._]{3,30}$/.test(local) ? local : 'creator';
  const candidates = [...new Set([base, (base.slice(0, 18) + '_' + suffix).slice(0, 30), ('creator_' + suffix).slice(0, 30)])];
  for (const username of candidates) {
    try {
      await pool.query(
        `INSERT INTO echo_creator_profiles(owner_id,display_name,username,username_key,visibility,message_privacy,bio)
         VALUES($1,$2,$3,lower($3),'private','requests','') ON CONFLICT(owner_id) DO NOTHING`,
        [ownerId, displayName, username],
      );
      return;
    } catch (error) {
      if ((error as { code?: string }).code !== '23505') throw error;
    }
  }
  throw new Error('CREATOR_PROFILE_USERNAME_UNAVAILABLE');
}
