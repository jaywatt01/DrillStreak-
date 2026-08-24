import { supabase } from './supabase';

// The name Team Chat shows for this account instead of a generic role
// label ("Coach"/"Parent of Jayden") — see list_team_contacts in
// schema.sql for where it's actually consumed. Not the same thing as a
// player's display_name (lib/players.ts): this is the ADULT account's own
// name, set once from Account and reused everywhere the account appears.
export async function getMyDisplayName(): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return null;

  const { data, error } = await supabase.from('profiles').select('display_name').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return (data?.display_name as string | null) ?? null;
}

// Upsert, not update — covers both a brand-new profiles row (an account
// that predates this table, or signed up before ever setting a name) and
// editing an existing one, in one call.
export async function setMyDisplayName(name: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error('Not signed in');

  const { error } = await supabase
    .from('profiles')
    .upsert({ user_id: userId, display_name: name.trim() || null }, { onConflict: 'user_id' });
  if (error) throw error;
}
