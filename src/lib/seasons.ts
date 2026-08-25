import { supabase } from './supabase';
import { awardOffseasonBadgeIfNeeded } from './badges';
import { computeMakesAttemptsTotal, computeRepTallies, getCompletionHistory, isFreeThrowDrill, ShootingComposite } from './players';

export type Season = {
  id: string;
  playerId: string;
  label: string;
  isOffseason: boolean;
  startedAt: string;
  endedAt: string | null;
};

const SEASON_COLUMNS = 'id, player_id, label, is_offseason, started_at, ended_at';

function mapSeasonRow(row: {
  id: string;
  player_id: string;
  label: string;
  is_offseason: boolean;
  started_at: string;
  ended_at: string | null;
}): Season {
  return {
    id: row.id,
    playerId: row.player_id,
    label: row.label,
    isOffseason: row.is_offseason,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

export async function getActiveSeason(playerId: string): Promise<Season | null> {
  const { data, error } = await supabase
    .from('seasons')
    .select(SEASON_COLUMNS)
    .eq('player_id', playerId)
    .is('ended_at', null)
    .maybeSingle();
  if (error) throw error;
  return data ? mapSeasonRow(data) : null;
}

export async function listSeasonHistory(playerId: string): Promise<Season[]> {
  const { data, error } = await supabase
    .from('seasons')
    .select(SEASON_COLUMNS)
    .eq('player_id', playerId)
    .not('ended_at', 'is', null)
    .order('started_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapSeasonRow);
}

function defaultLabel(isOffseason: boolean): string {
  const month = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  return isOffseason ? `Offseason — ${month}` : `Season — ${month}`;
}

// The one real mutation this whole feature is built around: close
// whatever season is currently open (if any — the very first toggle ever
// for a player has nothing to close) and open a new one in the opposite
// mode. Two sequential awaited calls, not a transaction, but sequential
// is required here regardless: the close has to land before the open, or
// the open would violate seasons_one_active_per_player (both rows would
// have ended_at null at once). Returns the just-closed season (or null)
// so the caller can show an end-of-season recap before presenting the new
// one — the recap only makes sense here, at the exact moment the season
// actually closes, not as a separate screen someone has to remember to
// check.
async function switchSeason(
  playerId: string,
  toOffseason: boolean,
  label?: string
): Promise<{ closedSeason: Season | null; newSeason: Season }> {
  const active = await getActiveSeason(playerId);
  let closedSeason: Season | null = null;
  if (active) {
    const { data, error } = await supabase
      .from('seasons')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', active.id)
      .select(SEASON_COLUMNS)
      .single();
    if (error) throw error;
    closedSeason = mapSeasonRow(data);
  }

  const { data: newData, error: newError } = await supabase
    .from('seasons')
    .insert({ player_id: playerId, label: label?.trim() || defaultLabel(toOffseason), is_offseason: toOffseason })
    .select(SEASON_COLUMNS)
    .single();
  if (newError) throw newError;

  return { closedSeason, newSeason: mapSeasonRow(newData) };
}

export type SeasonSummary = {
  bestStreak: number;
  totalReps: number;
  freeThrows: ShootingComposite | null;
  shooting: ShootingComposite | null;
};

// The end-of-season recap and the Season History view both need the same
// shape of thing — this closed season's story in a few numbers — so it's
// one function, not two near-duplicates. Reuses the same computation
// helpers already proven for the live Home/Progress/coach stats views
// (computeMakesAttemptsTotal, computeRepTallies), fed this one season's
// history instead of all-time. Best-streak-within-the-season isn't quite
// calculateStreak's job (that one specifically anchors to "today," which
// has no meaning for a closed season) — it's just the longest run of
// consecutive calendar days in this season's own sorted date list.
export async function summarizeSeason(playerId: string, seasonId: string): Promise<SeasonSummary> {
  const history = await getCompletionHistory(playerId, seasonId);
  const dates = Array.from(new Set(history.map((h) => h.date))).sort();

  let bestStreak = dates.length > 0 ? 1 : 0;
  let run = 1;
  for (let i = 1; i < dates.length; i++) {
    const diffDays = Math.round((new Date(dates[i]).getTime() - new Date(dates[i - 1]).getTime()) / 86400000);
    run = diffDays === 1 ? run + 1 : 1;
    bestStreak = Math.max(bestStreak, run);
  }

  return {
    bestStreak,
    totalReps: computeRepTallies(history).reduce((sum, t) => sum + t.totalAttempts, 0),
    freeThrows: computeMakesAttemptsTotal(history, isFreeThrowDrill),
    shooting: computeMakesAttemptsTotal(history, (name) => !isFreeThrowDrill(name)),
  };
}

export function startOffseason(playerId: string, label?: string) {
  return switchSeason(playerId, true, label);
}

// Awards the offseason-completed badge here, not as a separate step the
// caller has to remember — this is the one place "an offseason just
// closed" is actually known. Only awards it if the closed season had real
// logged activity (count > 0), never for toggling offseason on and
// immediately back off.
export async function startInSeason(playerId: string, label?: string) {
  const result = await switchSeason(playerId, false, label);
  if (result.closedSeason?.isOffseason) {
    const { count, error } = await supabase
      .from('completions')
      .select('id', { count: 'exact', head: true })
      .eq('season_id', result.closedSeason.id);
    if (error) throw error;
    if ((count ?? 0) > 0) {
      await awardOffseasonBadgeIfNeeded(playerId, result.closedSeason.id);
    }
  }
  return result;
}
