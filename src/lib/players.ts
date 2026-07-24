import { supabase } from './supabase';
import { mondayOfThisWeek, todayDateString } from './date';

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
};

export type CustomDrill = Drill & { is_default: boolean };

export const DRILL_SELECT_COLUMNS = 'id, name, category, estimated_minutes';

// Maps a raw `drills` row (snake_case, as returned by supabase-js) to the
// camelCase Drill shape used throughout the app.
export function mapDrillRow(row: {
  id: string;
  name: string;
  category: string | null;
  estimated_minutes: number | null;
}): Drill {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    estimatedMinutes: row.estimated_minutes,
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

export async function renameDrill(drillId: string, name: string, category: string): Promise<void> {
  const { error } = await supabase
    .from('drills')
    .update({ name, category: category.trim() || null })
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
  estimatedMinutes: number | null
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
      return { drills: deduped, source: 'team' };
    }
  }

  const { data: libraryDrills, error: libraryError } = await supabase
    .from('drills')
    .select(DRILL_SELECT_COLUMNS)
    .or(`is_default.eq.true,player_id.eq.${playerId}`)
    .order('category');
  if (libraryError) throw libraryError;

  return {
    drills: (libraryDrills ?? []).map((row) => ({
      ...mapDrillRow(row),
      scheduledTime: null,
      scheduledDurationMinutes: null,
    })),
    source: 'library',
  };
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

export async function logCompletion(playerId: string, drillId: string): Promise<void> {
  const { error } = await supabase
    .from('completions')
    .insert({ player_id: playerId, drill_id: drillId, date: todayDateString() });
  if (error) throw error;
}

export async function getTodayCompletedDrillIds(playerId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('completions')
    .select('drill_id')
    .eq('player_id', playerId)
    .eq('date', todayDateString());
  if (error) throw error;
  return new Set((data ?? []).map((c) => c.drill_id as string));
}
