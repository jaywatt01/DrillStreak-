import { supabase } from './supabase';
import { AVAILABLE_SPORTS, listMyPlayers } from './players';

// The sport switcher (2026-09-10) — Jay's real redesign of the original
// "show every sport at once" approach built earlier the same day, which
// didn't scale past 2 sports (Quick Start alone would need one section
// per sport, "I'll be scrolling through that before I even get to the
// players"). Instead the whole app shows one sport at a time, switchable
// from Home/Account — every screen filters its players/teams to
// getActiveSport()'s value. Nothing about any other sport's data is ever
// hidden from the database, just from view until switched back to.

export type SportOption = {
  value: string;
  label: string;
  // Whether this account already has a player or team in this sport —
  // the switcher shows every real sport regardless (so starting a brand
  // new one is reachable), just distinguishes "switch to" from "start."
  hasData: boolean;
};

// Only used the first time an account with no profiles.active_sport set
// yet needs one — every account that existed before this feature. Picks
// whichever sport the account already has the most of (players first,
// falling back to the coach's own oldest team), defaulting to basketball
// only if there's truly nothing yet (a brand new account).
async function inferActiveSport(userId: string): Promise<string> {
  const players = await listMyPlayers();
  if (players.length > 0) {
    const counts = new Map<string, number>();
    for (const p of players) counts.set(p.sport, (counts.get(p.sport) ?? 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0][0];
  }
  const { data: team } = await supabase
    .from('teams')
    .select('sport')
    .eq('coach_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (team?.sport as string | undefined) ?? 'basketball';
}

// Reads the account's current active sport, settling (and persisting) an
// inferred one on first call if none was ever set — a write-on-read, so
// the inference logic above only ever runs once per account rather than
// on every single load. Upsert only ever touches the active_sport column
// (Supabase's merge-duplicates upsert), never clobbers display_name or
// the age-attestation fields on an existing profiles row.
export async function getActiveSport(): Promise<string> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return 'basketball';

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('active_sport')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;

  if (profile?.active_sport) return profile.active_sport;

  const inferred = await inferActiveSport(userId);
  await supabase.from('profiles').upsert({ user_id: userId, active_sport: inferred });
  return inferred;
}

export async function setActiveSport(sport: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error('Not signed in');
  const { error } = await supabase.from('profiles').upsert({ user_id: userId, active_sport: sport });
  if (error) throw error;
}

// Every sport with real content today, each flagged with whether this
// account already has a player or team in it. Powers the switcher modal —
// existing sports show as "switch to," others as "start."
export async function listSportsForAccount(): Promise<SportOption[]> {
  const realSports = AVAILABLE_SPORTS.filter((s) => !s.comingSoon);
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return realSports.map((s) => ({ value: s.value, label: s.label, hasData: false }));

  const [players, teamsResult] = await Promise.all([
    listMyPlayers(),
    supabase.from('teams').select('sport').eq('coach_user_id', userId),
  ]);
  const sportsWithData = new Set<string>([
    ...players.map((p) => p.sport),
    ...((teamsResult.data ?? []).map((t) => t.sport as string)),
  ]);
  return realSports.map((s) => ({ value: s.value, label: s.label, hasData: sportsWithData.has(s.value) }));
}
