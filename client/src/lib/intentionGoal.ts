import { getSupabase } from './supabase';

// One goal per person, room and completed round. Stable across tabs/reloads and
// lost responses, without storing intention text or overwriting an existing goal.
export async function intentionGoalId(userId: string, roomId: string, round: number): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(JSON.stringify(['duodoro:intention-goal:v1', userId, roomId, round]))));
  bytes[6] = (bytes[6] & 0x0f) | 0x80; // UUIDv8: application-defined hash layout.
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes.slice(0, 16), byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

const UNCONFIRMED = "Couldn't confirm your personal goal. Retry safely to check or save it.";
export async function saveIntentionGoal(userId: string, roomId: string, round: number, content: string): Promise<string | null> {
  const text = content.trim();
  if (!userId || !roomId || !Number.isSafeInteger(round) || round < 1 || !text || text.length > 160) {
    return "This intention can't be saved as a goal.";
  }
  try {
    const id = await intentionGoalId(userId, roomId, round);
    const sb = getSupabase();
    // Ignore duplicates rather than update: a retried carry-forward must never
    // replace a goal the user has since edited or marked done.
    const inserted = await sb.from('tasks').upsert({ id, owner_id: userId, room_code: null, content: text, is_done: false, is_shared: false },
      { onConflict: 'id', ignoreDuplicates: true }).select('id, owner_id, room_code, is_shared').maybeSingle();
    if (inserted.error) return UNCONFIRMED;
    const result = inserted.data ? inserted : await sb.from('tasks').select('id, owner_id, room_code, is_shared')
      .eq('id', id).eq('owner_id', userId).is('room_code', null).maybeSingle();
    return !result.error && result.data?.id === id && result.data.owner_id === userId && result.data.room_code === null && result.data.is_shared === false
      ? null : UNCONFIRMED;
  } catch { return UNCONFIRMED; }
}
