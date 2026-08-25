import { supabase } from './supabase';

// Bio + stats_visible_to_team were added 2026-08-25 for teammate profile
// viewing (see get_teammates in schema.sql) — the challenge picker (below)
// ignores them and always shows every teammate; a profile-browsing screen
// reads stats_visible_to_team to show "Private profile" for an opted-out
// teammate instead of hiding them from the list outright.
export type Teammate = {
  id: string;
  display_name: string;
  team_id: string;
  position: string | null;
  height: string | null;
  weight: string | null;
  grad_year: number | null;
  stats_visible_to_team: boolean;
};

export type Challenge = {
  id: string;
  teamId: string;
  challengerPlayerId: string;
  challengerName: string;
  challengerCompletions: number;
  opponentPlayerId: string;
  opponentName: string;
  opponentCompletions: number;
  // Null until accepted — the race hasn't actually started yet, so there's
  // no window to compute a score or days-left against.
  startsAt: string | null;
  endsAt: string | null;
  accepted: boolean;
};

function mapChallengeRow(row: any): Challenge {
  return {
    id: row.id,
    teamId: row.team_id,
    challengerPlayerId: row.challenger_player_id,
    challengerName: row.challenger_name,
    challengerCompletions: row.challenger_completions,
    opponentPlayerId: row.opponent_player_id,
    opponentName: row.opponent_name,
    opponentCompletions: row.opponent_completions,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    accepted: row.accepted,
  };
}

// Other players who share at least one team with playerId — the pool a
// challenge opponent gets picked from. Goes through the get_teammates RPC
// rather than a direct query because players_access RLS only lets a caller
// see a players row they own/guard or coach, never a teammate's.
export async function getTeammates(playerId: string): Promise<Teammate[]> {
  const { data, error } = await supabase.rpc('get_teammates', { p_player_id: playerId });
  if (error) throw error;
  return (data ?? []) as Teammate[];
}

// All challenges (pending or active, either side) involving playerId, with
// both players' names and completion counts already resolved server-side —
// see get_player_challenges in schema.sql for why this has to be an RPC
// rather than a nested select.
export async function getChallengesForPlayer(playerId: string): Promise<Challenge[]> {
  const { data, error } = await supabase.rpc('get_player_challenges', { p_player_id: playerId });
  if (error) throw error;
  return (data ?? []).map(mapChallengeRow);
}

// Deliberately does NOT set starts_at/ends_at — the race doesn't begin
// until the opponent actually accepts (see acceptChallenge below). Setting
// the window at creation time was a real bug: any drills the challenger
// already logged today, before sending the invite, counted toward their
// total the instant the challenge existed.
export async function createChallenge(
  teamId: string,
  challengerPlayerId: string,
  opponentPlayerId: string
): Promise<void> {
  const { error } = await supabase.from('challenges').insert({
    team_id: teamId,
    challenger_player_id: challengerPlayerId,
    opponent_player_id: opponentPlayerId,
  });
  if (error) throw error;
}

// This is where the 7-day window actually starts — both players begin at
// 0, counting only completions logged from this moment onward. Goes
// through the accept_challenge RPC rather than a client-side update so the
// start timestamp is set by the server's own clock (now()), not a
// client-supplied one — a client timestamp could be wrong, or backdated to
// inflate a score. This also closes the same-day bug the first fix missed:
// the RPC sets accepted_at (a real timestamp), and get_player_challenges
// counts from that moment, not from the day as a whole.
export async function acceptChallenge(challengeId: string): Promise<void> {
  const { error } = await supabase.rpc('accept_challenge', { p_challenge_id: challengeId });
  if (error) throw error;
}

// Same delete action covers three UI cases: declining a received invite,
// canceling one you sent, and quitting an already-active challenge early.
// Never touches completions — the underlying drill history for both
// players is completely unaffected either way.
export async function declineChallenge(challengeId: string): Promise<void> {
  const { error } = await supabase.from('challenges').delete().eq('id', challengeId);
  if (error) throw error;
}
