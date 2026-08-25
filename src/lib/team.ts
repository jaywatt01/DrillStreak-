import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { mondayOfThisWeek } from './date';
import { DRILL_SELECT_COLUMNS, Drill, mapDrillRow } from './players';

export type Team = {
  id: string;
  name: string;
  invite_code: string;
  prompt_for_results: boolean;
};

export type RosterPlayer = {
  id: string;
  display_name: string;
  membershipId: string;
  // The account connected to this player row — a self-signed-up player's
  // own account, or the parent/guardian who created the profile for them.
  // Used for the "Message" quick-DM shortcut on the roster row (jumps
  // straight into that thread in Team Chat) — doesn't attempt to resolve
  // a second guardian if one exists via guardianships, just the primary
  // creator.
  contactUserId: string;
};

export type AssignedDrill = Drill & {
  assignmentId: string;
  scheduledTime: string | null;
  durationMinutes: number | null;
};

export type RosterCompletion = {
  id: string;
  date: string;
  playerId: string;
  playerName: string;
  drillName: string;
};

export async function getMyTeam(): Promise<Team | null> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error('Not signed in');

  const { data, error } = await supabase
    .from('teams')
    .select('id, name, invite_code, prompt_for_results')
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
    .select('id, name, invite_code, prompt_for_results')
    .single();
  if (error) throw error;
  return data as Team;
}

// Coach-level nudge (see schema.sql for the full reasoning): when on, a
// player marking a team-assigned drill done gets the result-logging modal
// opened automatically instead of needing a second tap. Still skippable —
// this is a default, not a requirement to mark the drill done at all.
export async function setPromptForResults(teamId: string, value: boolean): Promise<void> {
  const { error } = await supabase.from('teams').update({ prompt_for_results: value }).eq('id', teamId);
  if (error) throw error;
}

// The team(s) this player belongs to, with names — for the badge-share
// picker, which needs to know where "share to team" can actually post.
// Direct query against team_memberships is fine here (not an RPC like
// get_teammates needs) because team_memberships_access already grants an
// owner/guardian read access to their OWN player's membership rows —
// this only ever asks about a player the caller already owns/guards.
export async function getPlayerTeams(playerId: string): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from('team_memberships')
    .select('teams(id, name)')
    .eq('player_id', playerId);
  if (error) throw error;
  return (data ?? [])
    .flatMap((row) => {
      const team = Array.isArray(row.teams) ? row.teams[0] : row.teams;
      return team ? [{ id: team.id as string, name: team.name as string }] : [];
    });
}

export async function getRoster(teamId: string): Promise<RosterPlayer[]> {
  const { data, error } = await supabase
    .from('team_memberships')
    .select('id, players(id, display_name, created_by_user_id)')
    .eq('team_id', teamId);
  if (error) throw error;

  return (data ?? [])
    .flatMap((row) => {
      const player = Array.isArray(row.players) ? row.players[0] : row.players;
      if (!player) return [];
      return [
        {
          id: player.id as string,
          display_name: player.display_name as string,
          membershipId: row.id as string,
          contactUserId: player.created_by_user_id as string,
        },
      ];
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

// True if any team this player belongs to has the result-prompt nudge on.
// A player on multiple teams with mixed settings gets prompted — safer to
// over-prompt (still skippable) than silently ignore one coach's setting.
//
// Goes through the player_has_prompt_for_results RPC rather than a direct
// embedded select, because teams RLS intentionally restricts SELECT on
// `teams` to the owning coach (to keep invite codes private) — a
// player-side `team_memberships -> teams(prompt_for_results)` embed
// silently comes back null for every non-coach caller, which is why the
// auto-popup never fired for real players even with the toggle on. The RPC
// bypasses that restriction for this one boolean while re-verifying the
// caller owns/guards this player, so it can't be used to probe other
// players' teams.
export async function getPromptForResultsForPlayer(playerId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('player_has_prompt_for_results', { p_player_id: playerId });
  if (error) throw error;
  return data === true;
}

// This coach's own note for a player — deliberately scoped to
// coach_user_id = the caller, not just player_id, so a player on multiple
// teams editing here can't see or overwrite a different coach's note (see
// player_notes' unique(player_id, coach_user_id) and RLS in schema.sql).
export async function getMyNoteForPlayer(playerId: string): Promise<string> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error('Not signed in');

  const { data, error } = await supabase
    .from('player_notes')
    .select('note')
    .eq('player_id', playerId)
    .eq('coach_user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data?.note as string) ?? '';
}

// Upserts this coach's note for a player. Passing an empty/whitespace-only
// note deletes the row instead — an empty note isn't a note worth keeping,
// and this avoids leaving stale empty rows a player would otherwise see
// rendered as a blank note.
export async function saveMyNoteForPlayer(playerId: string, note: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error('Not signed in');

  const trimmed = note.trim();
  if (!trimmed) {
    const { error } = await supabase
      .from('player_notes')
      .delete()
      .eq('player_id', playerId)
      .eq('coach_user_id', userId);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from('player_notes')
    .upsert(
      { player_id: playerId, coach_user_id: userId, note: trimmed, updated_at: new Date().toISOString() },
      { onConflict: 'player_id,coach_user_id' }
    );
  if (error) throw error;
}

export async function getRosterCompletionsThisWeek(rosterPlayerIds: string[]): Promise<RosterCompletion[]> {
  if (rosterPlayerIds.length === 0) return [];

  const { data, error } = await supabase
    .from('completions')
    .select('id, date, player_id, players(display_name), drills(name)')
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
        playerId: row.player_id as string,
        playerName: player.display_name as string,
        drillName: drill.name as string,
      };
    })
    .filter((c): c is RosterCompletion => c != null);
}

// Real UX gap Jay caught (2026-08-25): the Team Overview dots and the
// roster activity feed only ever refreshed on tab focus/pull-to-refresh —
// fine for switching between tabs, but not for a coach staying on My Team
// while a player logs a drill elsewhere on the same account. `completions`
// has no team_id column to filter on server-side the way
// subscribeToTeamMessages does, so this subscribes unfiltered and relies
// on completions' own RLS to scope what actually gets delivered per
// session — same Realtime-respects-RLS behavior already confirmed and
// relied on for team_messages. `event: '*'` (not just INSERT) so an
// undone/deleted completion clears a dot live too, not just a newly
// logged one. Caller just re-runs its own load() on any change rather
// than trying to patch state incrementally — the payload doesn't carry
// enough (no player display name) to update rosterCompletions in place
// without a second lookup anyway.
export function subscribeToRosterCompletions(onChange: () => void): RealtimeChannel {
  return supabase
    .channel('roster-completions')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'completions' }, () => onChange())
    .subscribe();
}
