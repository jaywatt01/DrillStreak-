import { supabase } from './supabase';
import { mondayOfThisWeek, todayDateString, weekIndex } from './date';

export type Player = {
  id: string;
  display_name: string;
};

// Fallback event length for any drill with no set duration (custom or
// seeded). 30, not 60 — most drills in the seeded library run 5-10 min,
// and a blanket hour block overstates almost all of them.
export const DEFAULT_DRILL_MINUTES = 30;

export type Drill = {
  id: string;
  name: string;
  category: string | null;
  estimatedMinutes: number | null;
  videoUrl: string | null;
};

export type CustomDrill = Drill & { is_default: boolean };

export const DRILL_SELECT_COLUMNS = 'id, name, category, estimated_minutes, video_url';

// Maps a raw `drills` row (snake_case, as returned by supabase-js) to the
// camelCase Drill shape used throughout the app.
export function mapDrillRow(row: {
  id: string;
  name: string;
  category: string | null;
  estimated_minutes: number | null;
  video_url: string | null;
}): Drill {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    estimatedMinutes: row.estimated_minutes,
    videoUrl: row.video_url,
  };
}

export async function listMyPlayers(): Promise<Player[]> {
  const { data, error } = await supabase.rpc('list_my_players');
  if (error) throw error;
  return (data ?? []) as Player[];
}

export async function addPlayer(displayName: string): Promise<Player> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error('Not signed in');

  const { data, error } = await supabase
    .from('players')
    .insert({ display_name: displayName, created_by_user_id: userId })
    .select('id, display_name')
    .single();
  if (error) throw error;
  return data as Player;
}

export async function renamePlayer(playerId: string, displayName: string): Promise<void> {
  const { error } = await supabase
    .from('players')
    .update({ display_name: displayName })
    .eq('id', playerId);
  if (error) throw error;
}

export async function deletePlayer(playerId: string): Promise<void> {
  const { error } = await supabase.from('players').delete().eq('id', playerId);
  if (error) throw error;
}

export async function getMyCustomDrills(playerId: string): Promise<CustomDrill[]> {
  const { data, error } = await supabase
    .from('drills')
    .select(`${DRILL_SELECT_COLUMNS}, is_default`)
    .eq('player_id', playerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({ ...mapDrillRow(row), is_default: row.is_default as boolean }));
}

export async function renameDrill(
  drillId: string,
  name: string,
  category: string,
  videoUrl: string
): Promise<void> {
  const { error } = await supabase
    .from('drills')
    .update({ name, category: category.trim() || null, video_url: videoUrl.trim() || null })
    .eq('id', drillId);
  if (error) throw error;
}

export async function deleteDrill(drillId: string): Promise<void> {
  const { error } = await supabase.from('drills').delete().eq('id', drillId);
  if (error) {
    if (error.code === '23503') {
      throw new Error(
        "Can't delete — this drill already has logged completions or assignments, so its history is preserved."
      );
    }
    throw error;
  }
}

export async function addCustomDrill(
  name: string,
  category: string,
  playerId: string,
  estimatedMinutes: number | null,
  videoUrl: string | null
): Promise<Drill> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error('Not signed in');

  const { data, error } = await supabase
    .from('drills')
    .insert({
      name,
      category: category.trim() || null,
      created_by_user_id: userId,
      player_id: playerId,
      is_default: false,
      estimated_minutes: estimatedMinutes,
      video_url: videoUrl,
    })
    .select(DRILL_SELECT_COLUMNS)
    .single();
  if (error) throw error;
  return mapDrillRow(data);
}

// A drill as it appears on Home, carrying the coach's suggested
// time/duration for this week's assignment when there is one (team
// source only — a library drill has no per-assignment schedule, just
// whatever estimatedMinutes is set on the drill itself).
export type WeeklyDrill = Drill & { scheduledTime: string | null; scheduledDurationMinutes: number | null };

// Picks which video shows this week from a drill's candidate pool,
// deterministically — same pick for everyone until the following Monday,
// no stored "current index" anywhere. Pure function of the pool + the
// current week, so it's trivially testable and never needs a migration
// to change the cadence (see weekIndex in lib/date.ts for that).
export function pickRotatingVideo(urls: string[]): string | null {
  if (urls.length === 0) return null;
  return urls[weekIndex() % urls.length];
}

// Overrides each drill's videoUrl with its rotating pick when it has a
// video pool (drill_videos rows) — falls back to the drill's own single
// video_url (set at custom-drill creation/rename) when it doesn't, so
// custom drills work exactly as before, unaffected by rotation.
async function applyVideoRotation(drills: WeeklyDrill[]): Promise<WeeklyDrill[]> {
  const drillIds = drills.map((d) => d.id);
  if (drillIds.length === 0) return drills;

  const { data, error } = await supabase.from('drill_videos').select('drill_id, url').in('drill_id', drillIds);
  if (error) throw error;

  const poolsByDrill = new Map<string, string[]>();
  for (const row of data ?? []) {
    const id = row.drill_id as string;
    const existing = poolsByDrill.get(id) ?? [];
    existing.push(row.url as string);
    poolsByDrill.set(id, existing);
  }

  return drills.map((drill) => {
    const pool = poolsByDrill.get(drill.id);
    if (!pool || pool.length === 0) return drill;
    return { ...drill, videoUrl: pickRotatingVideo(pool) };
  });
}

export async function getWeeklyDrills(
  playerId: string
): Promise<{ drills: WeeklyDrill[]; source: 'team' | 'library' }> {
  const { data: memberships, error: membershipError } = await supabase
    .from('team_memberships')
    .select('team_id')
    .eq('player_id', playerId);
  if (membershipError) throw membershipError;

  const teamIds = (memberships ?? []).map((m) => m.team_id);

  if (teamIds.length > 0) {
    const { data: assignments, error: assignmentError } = await supabase
      .from('assignments')
      .select(`scheduled_time, duration_minutes, drills(${DRILL_SELECT_COLUMNS})`)
      .in('team_id', teamIds)
      .eq('week_of', mondayOfThisWeek());
    if (assignmentError) throw assignmentError;

    const drills = (assignments ?? [])
      .flatMap((a) => {
        const drillRow = Array.isArray(a.drills) ? a.drills[0] : a.drills;
        if (!drillRow) return [];
        return [
          {
            ...mapDrillRow(drillRow),
            scheduledTime: a.scheduled_time as string | null,
            scheduledDurationMinutes: a.duration_minutes as number | null,
          },
        ];
      })
      .filter((d): d is WeeklyDrill => d != null);

    const deduped = Array.from(new Map(drills.map((d) => [d.id, d])).values());
    if (deduped.length > 0) {
      return { drills: await applyVideoRotation(deduped), source: 'team' };
    }
  }

  const { data: libraryDrills, error: libraryError } = await supabase
    .from('drills')
    .select(DRILL_SELECT_COLUMNS)
    .or(`is_default.eq.true,player_id.eq.${playerId}`)
    .order('category');
  if (libraryError) throw libraryError;

  const libraryResult: WeeklyDrill[] = (libraryDrills ?? []).map((row) => ({
    ...mapDrillRow(row),
    scheduledTime: null,
    scheduledDurationMinutes: null,
  }));

  return {
    drills: await applyVideoRotation(libraryResult),
    source: 'library',
  };
}

export type CompletionHistoryDrill = { name: string; makes: number | null; attempts: number | null };
export type CompletionHistoryEntry = { date: string; drills: CompletionHistoryDrill[] };

// Full logged history for a player, most recent day first, each day's
// drills grouped together. Gating (current-week-only for free users) is
// the caller's responsibility — this always returns everything so the
// caller can also tell whether there's more history a paywall would unlock.
export async function getCompletionHistory(playerId: string): Promise<CompletionHistoryEntry[]> {
  const { data, error } = await supabase
    .from('completions')
    .select('date, makes, attempts, drills(name)')
    .eq('player_id', playerId)
    .order('date', { ascending: false });
  if (error) throw error;

  const byDate = new Map<string, CompletionHistoryDrill[]>();
  for (const row of data ?? []) {
    const drill = Array.isArray(row.drills) ? row.drills[0] : row.drills;
    if (!drill) continue;
    const date = row.date as string;
    const existing = byDate.get(date) ?? [];
    existing.push({
      name: drill.name as string,
      makes: row.makes as number | null,
      attempts: row.attempts as number | null,
    });
    byDate.set(date, existing);
  }
  return Array.from(byDate.entries()).map(([date, drills]) => ({ date, drills }));
}

export async function getCompletionDates(playerId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('completions')
    .select('date')
    .eq('player_id', playerId)
    .order('date', { ascending: false });
  if (error) throw error;
  return Array.from(new Set((data ?? []).map((c) => c.date as string)));
}

export function calculateStreak(sortedDescendingDates: string[]): number {
  if (sortedDescendingDates.length === 0) return 0;

  const today = todayDateString();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const mostRecent = sortedDescendingDates[0];
  if (mostRecent !== today && mostRecent !== yesterdayStr) {
    return 0;
  }

  let streak = 1;
  let cursor = new Date(mostRecent);
  for (let i = 1; i < sortedDescendingDates.length; i++) {
    cursor.setDate(cursor.getDate() - 1);
    const expected = cursor.toISOString().slice(0, 10);
    if (sortedDescendingDates[i] === expected) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

// Upsert with ignoreDuplicates so a double-tap, a race between two devices,
// or a retry after a dropped network response can't create a second
// completions row for the same player/drill/day (relies on the unique
// constraint added in the 2026-07-26 migration at the bottom of schema.sql).
export async function logCompletion(playerId: string, drillId: string): Promise<void> {
  const { error } = await supabase
    .from('completions')
    .upsert(
      { player_id: playerId, drill_id: drillId, date: todayDateString() },
      { onConflict: 'player_id,drill_id,date', ignoreDuplicates: true }
    );
  if (error) throw error;
}

export type DrillResult = { makes: number | null; attempts: number | null };

// Keyed by drill_id, so callers can both check "is this drill done today"
// (Map.has, same as the old Set) and read any result already logged for it.
export async function getTodayCompletions(playerId: string): Promise<Map<string, DrillResult>> {
  const { data, error } = await supabase
    .from('completions')
    .select('drill_id, makes, attempts')
    .eq('player_id', playerId)
    .eq('date', todayDateString());
  if (error) throw error;
  return new Map(
    (data ?? []).map((c) => [
      c.drill_id as string,
      { makes: c.makes as number | null, attempts: c.attempts as number | null },
    ])
  );
}

// Attaches an optional numeric result to today's already-logged completion
// for this drill (makes/attempts for shooting, or just `attempts` alone as
// a generic rep count for anything else). The completions row must already
// exist — call after logCompletion, not instead of it.
export async function logDrillResult(
  playerId: string,
  drillId: string,
  makes: number | null,
  attempts: number | null
): Promise<void> {
  const { error } = await supabase
    .from('completions')
    .update({ makes, attempts })
    .eq('player_id', playerId)
    .eq('drill_id', drillId)
    .eq('date', todayDateString());
  if (error) throw error;
}

// Undoes a mistaken "mark done" tap — deletes today's completion entirely
// (including any logged makes/attempts), not just resetting a flag, so the
// drill goes back to a real not-done state and can be marked done again.
export async function deleteCompletion(playerId: string, drillId: string): Promise<void> {
  const { error } = await supabase
    .from('completions')
    .delete()
    .eq('player_id', playerId)
    .eq('drill_id', drillId)
    .eq('date', todayDateString());
  if (error) throw error;
}
