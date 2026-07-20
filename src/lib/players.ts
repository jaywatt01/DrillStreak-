import { supabase } from './supabase';
import { mondayOfThisWeek, todayDateString } from './date';

export type Player = {
  id: string;
  display_name: string;
};

export type Drill = {
  id: string;
  name: string;
  category: string | null;
};

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

export async function addCustomDrill(name: string, category: string): Promise<Drill> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error('Not signed in');

  const { data, error } = await supabase
    .from('drills')
    .insert({
      name,
      category: category.trim() || null,
      created_by_user_id: userId,
      is_default: false,
    })
    .select('id, name, category')
    .single();
  if (error) throw error;
  return data as Drill;
}

export async function getWeeklyDrills(playerId: string): Promise<{ drills: Drill[]; source: 'team' | 'library' }> {
  const { data: memberships, error: membershipError } = await supabase
    .from('team_memberships')
    .select('team_id')
    .eq('player_id', playerId);
  if (membershipError) throw membershipError;

  const teamIds = (memberships ?? []).map((m) => m.team_id);

  if (teamIds.length > 0) {
    const { data: assignments, error: assignmentError } = await supabase
      .from('assignments')
      .select('drills(id, name, category)')
      .in('team_id', teamIds)
      .eq('week_of', mondayOfThisWeek());
    if (assignmentError) throw assignmentError;

    const drills = (assignments ?? [])
      .flatMap((a) => (Array.isArray(a.drills) ? a.drills : a.drills ? [a.drills] : []))
      .filter((d): d is Drill => d != null);

    const deduped = Array.from(new Map(drills.map((d) => [d.id, d])).values());
    if (deduped.length > 0) {
      return { drills: deduped, source: 'team' };
    }
  }

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  const { data: libraryDrills, error: libraryError } = await supabase
    .from('drills')
    .select('id, name, category')
    .or(`is_default.eq.true,created_by_user_id.eq.${userId}`)
    .order('category');
  if (libraryError) throw libraryError;

  return { drills: (libraryDrills ?? []) as Drill[], source: 'library' };
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
