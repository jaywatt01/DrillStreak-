import { supabase } from './supabase';
import { mondayOfThisWeek } from './date';
import { Drill } from './players';

export type Team = {
  id: string;
  name: string;
  invite_code: string;
};

export type RosterPlayer = {
  id: string;
  display_name: string;
};

export type AssignedDrill = Drill & { assignmentId: string };

export type RosterCompletion = {
  id: string;
  date: string;
  playerName: string;
  drillName: string;
};

export async function getMyTeam(): Promise<Team | null> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error('Not signed in');

  const { data, error } = await supabase
    .from('teams')
    .select('id, name, invite_code')
    .eq('coach_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as Team | null;
}

export async function createTeam(name: string): Promise<Team> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error('Not signed in');

  const { data, error } = await supabase
    .from('teams')
    .insert({ name, coach_user_id: userId })
    .select('id, name, invite_code')
    .single();
  if (error) throw error;
  return data as Team;
}

export async function getRoster(teamId: string): Promise<RosterPlayer[]> {
  const { data, error } = await supabase
    .from('team_memberships')
    .select('players(id, display_name)')
    .eq('team_id', teamId);
  if (error) throw error;

  return (data ?? [])
    .flatMap((row) => (Array.isArray(row.players) ? row.players : row.players ? [row.players] : []))
    .filter((p): p is RosterPlayer => p != null);
}

export async function getAvailableDrills(): Promise<Drill[]> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;

  const { data, error } = await supabase
    .from('drills')
    .select('id, name, category')
    .or(`is_default.eq.true,created_by_user_id.eq.${userId}`)
    .order('category');
  if (error) throw error;
  return (data ?? []) as Drill[];
}

export async function getWeeklyTeamAssignments(teamId: string): Promise<AssignedDrill[]> {
  const { data, error } = await supabase
    .from('assignments')
    .select('id, drills(id, name, category)')
    .eq('team_id', teamId)
    .eq('week_of', mondayOfThisWeek());
  if (error) throw error;

  return (data ?? [])
    .flatMap((a) => {
      const drill = Array.isArray(a.drills) ? a.drills[0] : a.drills;
      return drill ? [{ ...drill, assignmentId: a.id }] : [];
    })
    .filter((d): d is AssignedDrill => d != null);
}

export async function assignDrillToTeam(teamId: string, drillId: string): Promise<void> {
  const { error } = await supabase
    .from('assignments')
    .insert({ team_id: teamId, drill_id: drillId, week_of: mondayOfThisWeek() });
  if (error) throw error;
}

export async function unassignDrill(assignmentId: string): Promise<void> {
  const { error } = await supabase.from('assignments').delete().eq('id', assignmentId);
  if (error) throw error;
}

export async function joinTeamByInviteCode(inviteCode: string, playerId: string): Promise<void> {
  const { error } = await supabase.rpc('redeem_team_invite', {
    p_invite_code: inviteCode,
    p_player_id: playerId,
  });
  if (error) throw error;
}

export async function getRosterCompletionsThisWeek(rosterPlayerIds: string[]): Promise<RosterCompletion[]> {
  if (rosterPlayerIds.length === 0) return [];

  const { data, error } = await supabase
    .from('completions')
    .select('id, date, players(display_name), drills(name)')
    .in('player_id', rosterPlayerIds)
    .gte('date', mondayOfThisWeek())
    .order('date', { ascending: false });
  if (error) throw error;

  return (data ?? [])
    .map((row) => {
      const player = Array.isArray(row.players) ? row.players[0] : row.players;
      const drill = Array.isArray(row.drills) ? row.drills[0] : row.drills;
      if (!player || !drill) return null;
      return {
        id: row.id as string,
        date: row.date as string,
        playerName: player.display_name as string,
        drillName: drill.name as string,
      };
    })
    .filter((c): c is RosterCompletion => c != null);
}
