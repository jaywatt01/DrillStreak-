import { supabase } from './supabase';
import { mondayOfThisWeek } from './date';
import { DRILL_SELECT_COLUMNS, Drill, mapDrillRow } from './players';

export type Team = {
  id: string;
  name: string;
  invite_code: string;
};

export type RosterPlayer = {
  id: string;
  display_name: string;
  membershipId: string;
};

export type AssignedDrill = Drill & {
  assignmentId: string;
  scheduledTime: string | null;
  durationMinutes: number | null;
};

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
    .select('id, players(id, display_name)')
    .eq('team_id', teamId);
  if (error) throw error;

  return (data ?? [])
    .flatMap((row) => {
      const player = Array.isArray(row.players) ? row.players[0] : row.players;
      return player ? [{ ...player, membershipId: row.id as string }] : [];
    })
    .filter((p): p is RosterPlayer => p != null);
}

export async function renameTeam(teamId: string, name: string): Promise<void> {
  const { error } = await supabase.from('teams').update({ name }).eq('id', teamId);
  if (error) throw error;
}

export async function deleteTeam(teamId: string): Promise<void> {
  const { error } = await supabase.from('teams').delete().eq('id', teamId);
  if (error) throw error;
}

export async function removeFromRoster(membershipId: string): Promise<void> {
  const { error } = await supabase.from('team_memberships').delete().eq('id', membershipId);
  if (error) throw error;
}

export async function getAvailableDrills(): Promise<Drill[]> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;

  const { data, error } = await supabase
    .from('drills')
    .select(DRILL_SELECT_COLUMNS)
    .or(`is_default.eq.true,created_by_user_id.eq.${userId}`)
    .order('category');
  if (error) throw error;
  return (data ?? []).map(mapDrillRow);
}

export async function getWeeklyTeamAssignments(teamId: string): Promise<AssignedDrill[]> {
  const { data, error } = await supabase
    .from('assignments')
    .select(`id, scheduled_time, duration_minutes, drills(${DRILL_SELECT_COLUMNS})`)
    .eq('team_id', teamId)
    .eq('week_of', mondayOfThisWeek());
  if (error) throw error;

  return (data ?? [])
    .flatMap((a) => {
      const drill = Array.isArray(a.drills) ? a.drills[0] : a.drills;
      if (!drill) return [];
      return [
        {
          ...mapDrillRow(drill),
          assignmentId: a.id as string,
          scheduledTime: a.scheduled_time as string | null,
          durationMinutes: a.duration_minutes as number | null,
        },
      ];
    })
    .filter((d): d is AssignedDrill => d != null);
}

export async function assignDrillToTeam(
  teamId: string,
  drillId: string,
  scheduledTime: string | null = null,
  durationMinutes: number | null = null
): Promise<void> {
  const { error } = await supabase.from('assignments').insert({
    team_id: teamId,
    drill_id: drillId,
    week_of: mondayOfThisWeek(),
    scheduled_time: scheduledTime,
    duration_minutes: durationMinutes,
  });
  if (error) throw error;
}

// Lets a coach set/change the suggested time and duration for a drill
// already assigned to their team this week — becomes the default a
// player's calendar picker pre-fills to, not a push to their calendar.
export async function updateAssignmentSchedule(
  assignmentId: string,
  scheduledTime: string | null,
  durationMinutes: number | null
): Promise<void> {
  const { error } = await supabase
    .from('assignments')
    .update({ scheduled_time: scheduledTime, duration_minutes: durationMinutes })
    .eq('id', assignmentId);
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
