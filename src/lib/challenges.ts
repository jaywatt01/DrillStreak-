import { supabase } from './supabase';

export type Teammate = {
  id: string;
  display_name: string;
  team_id: string;
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
  startsAt: string;
  endsAt: string;
  accepted: boolean;
};

const CHALLENGE_LENGTH_DAYS = 7;

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

export async function createChallenge(
  teamId: string,
  challengerPlayerId: string,
  opponentPlayerId: string
): Promise<void> {
  const startsAt = new Date();
  const endsAt = new Date(startsAt);
  endsAt.setDate(endsAt.getDate() + CHALLENGE_LENGTH_DAYS);
  const { error } = await supabase.from('challenges').insert({
    team_id: teamId,
    challenger_player_id: challengerPlayerId,
    opponent_player_id: opponentPlayerId,
    starts_at: startsAt.toISOString().slice(0, 10),
    ends_at: endsAt.toISOString().slice(0, 10),
  });
  if (error) throw error;
}

export async function acceptChallenge(challengeId: string): Promise<void> {
  const { error } = await supabase.from('challenges').update({ accepted: true }).eq('id', challengeId);
  if (error) throw error;
}

// Also used to cancel a still-pending challenge you sent yourself — same
// action (delete the row) either way.
export async function declineChallenge(challengeId: string): Promise<void> {
  const { error } = await supabase.from('challenges').delete().eq('id', challengeId);
  if (error) throw error;
}
