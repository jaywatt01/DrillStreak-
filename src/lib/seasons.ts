import { supabase } from './supabase';
import { awardOffseasonBadgeIfNeeded, Badge, filterBadgesInRange, listBadges } from './badges';
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

// Renames any season — active or already closed. Added 2026-08-25, real
// gap Jay caught: the auto-generated label ("Season — August 2026") was
// always usable but never editable, at creation or after. Same RLS as
// everything else here (owner/guardian or coach), no new policy needed —
// this is just a plain update on a row those policies already cover.
export async function renameSeason(seasonId: string, label: string): Promise<void> {
  const trimmed = label.trim();
  if (!trimmed) return;
  const { error } = await supabase.from('seasons').update({ label: trimmed }).eq('id', seasonId);
  if (error) throw error;
}

// Exported so the UI can pre-fill a label input with the same default
// this would fall back to, before the season actually exists to rename.
export function defaultLabel(isOffseason: boolean): string {
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
  badges: Badge[];
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
//
// Badges added 2026-08-25, real gap Jay caught: badges have no season_id
// column (never needed one for anything else), so "earned during this
// season" is derived here by filtering the player's badges against the
// season's own started_at/ended_at range rather than a stored join —
// cheap since a player only ever has a handful of badges, and avoids a
// migration for a read-only, display-only grouping.
export async function summarizeSeason(playerId: string, seasonId: string): Promise<SeasonSummary> {
  const [history, seasonRow, allBadges] = await Promise.all([
    getCompletionHistory(playerId, seasonId),
    supabase.from('seasons').select('started_at, ended_at').eq('id', seasonId).single(),
    listBadges(playerId),
  ]);
  if (seasonRow.error) throw seasonRow.error;
  const dates = Array.from(new Set(history.map((h) => h.date))).sort();

  let bestStreak = dates.length > 0 ? 1 : 0;
  let run = 1;
  for (let i = 1; i < dates.length; i++) {
    const diffDays = Math.round((new Date(dates[i]).getTime() - new Date(dates[i - 1]).getTime()) / 86400000);
    run = diffDays === 1 ? run + 1 : 1;
    bestStreak = Math.max(bestStreak, run);
  }

  const badges = filterBadgesInRange(allBadges, {
    startedAt: seasonRow.data.started_at,
    endedAt: seasonRow.data.ended_at,
  });

  return {
    bestStreak,
    totalReps: computeRepTallies(history).reduce((sum, t) => sum + t.totalAttempts, 0),
    freeThrows: computeMakesAttemptsTotal(history, isFreeThrowDrill),
    shooting: computeMakesAttemptsTotal(history, (name) => !isFreeThrowDrill(name)),
    badges,
  };
}

// Removes only the season row itself — never the completions logged
// during it. completions.season_id references seasons(id) on delete set
// null, so any drill logged in a deleted season simply falls back into
// the player's unsegmented/all-time bucket (the same bucket every
// completion lived in before seasons existed) instead of being lost.
// Guarded to closed seasons only (`ended_at` not null) at the query
// level, not just by what the UI happens to show — deleting the
// currently active season would leave a player with no open season row,
// which the rest of this feature (the partial unique index, the
// completion-tagging trigger) doesn't expect.
export async function deleteSeason(seasonId: string): Promise<void> {
  const { error } = await supabase.from('seasons').delete().eq('id', seasonId).not('ended_at', 'is', null);
  if (error) throw error;
}

// Reverses a season switch a player/coach didn't mean to make — the
// specific "I fat-fingered the toggle" case, distinct from deleteSeason
// above (which is a deliberate cleanup of an old season, not an undo of
// the most recent action). Re-points any completions logged in the
// brief accidentally-created season back onto the reopened one, deletes
// the accidental season, then reopens the previous one — done as a
// single Postgres function (see schema.sql) rather than three sequential
// client calls so the three writes can't be left half-applied by a
// mid-sequence failure, and so the delete-before-reopen ordering (required
// by seasons_one_active_per_player) is enforced server-side, not just by
// caller discipline.
export async function undoSeasonSwitch(previousSeasonId: string, newSeasonId: string): Promise<void> {
  const { error } = await supabase.rpc('undo_season_switch', {
    p_previous_season_id: previousSeasonId,
    p_new_season_id: newSeasonId,
  });
  if (error) throw error;
}

export function startOffseason(playerId: string, label?: string) {
  return switchSeason(playerId, true, label);
}

// Real threshold change, 2026-08-25, Jay-requested after testing the
// original version himself: any single logged drill during an offseason
// used to earn this badge (deliberately low-friction for the first
// version). Jay's own read was that one workout was too easy — he asked
// for something closer to "2 or 3 times a month" of sustained offseason
// activity. This operationalizes that as roughly 2 completions per 30
// days the offseason actually spanned (the low end of his range, so a
// mostly-but-not-perfectly consistent player can still earn it), with a
// floor of 2 total so a very short offseason isn't a free badge. The
// exact number is a judgment call within the range Jay gave, not something
// he specified to the digit — easy to retune if 2/month reads as too easy
// or too hard once real players hit it.
function minOffseasonCompletionsFor(season: Season): number {
  if (!season.endedAt) return 2;
  const durationDays = Math.max(
    1,
    (new Date(season.endedAt).getTime() - new Date(season.startedAt).getTime()) / 86400000
  );
  return Math.max(2, Math.ceil((durationDays / 30) * 2));
}

// Awards the offseason-completed badge here, not as a separate step the
// caller has to remember — this is the one place "an offseason just
// closed" is actually known.
export async function startInSeason(playerId: string, label?: string) {
  const result = await switchSeason(playerId, false, label);
  if (result.closedSeason?.isOffseason) {
    const { count, error } = await supabase
      .from('completions')
      .select('id', { count: 'exact', head: true })
      .eq('season_id', result.closedSeason.id);
    if (error) throw error;
    if ((count ?? 0) >= minOffseasonCompletionsFor(result.closedSeason)) {
      await awardOffseasonBadgeIfNeeded(playerId, result.closedSeason.id);
    }
  }
  return result;
}
