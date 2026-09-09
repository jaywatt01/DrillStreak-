import { CompletionHistoryEntry, getCompletionHistory } from './players';
import { listSeasonHistory } from './seasons';

export type FocusSuggestion = { category: string; pct: number; makes: number; attempts: number };

// Conditioning has no percentage to weigh (reps + time, not makes/
// attempts), so it can't share shootingPctByCategory's shape — this
// counts how many conditioning completions from the last in-season
// actually had a real reps or time logged (not just marked done with
// nothing recorded), the volume-based signal that low tracking itself is
// the offseason opportunity, same underlying "not enough real data yet"
// spirit as the shooting suggestion's 5-attempt minimum.
export type ConditioningFocusSuggestion = { trackedCount: number };

// Groups every shooting-type completion (has both makes AND attempts —
// same "shooting-type" test computeMakesAttemptsTotal in lib/players.ts
// uses) by the drill's category, summing makes/attempts per category. A
// rep-only drill (jump rope, suicides — attempts with no makes) has
// nothing to weigh a percentage against, so it's excluded here the same
// way it's excluded from the shooting composite everywhere else in this
// app — this is about shooting accuracy, not activity volume.
function shootingPctByCategory(history: CompletionHistoryEntry[]): Map<string, { makes: number; attempts: number }> {
  const totals = new Map<string, { makes: number; attempts: number }>();
  for (const entry of history) {
    for (const drill of entry.drills) {
      if (drill.makes == null || drill.attempts == null || !drill.category) continue;
      const existing = totals.get(drill.category) ?? { makes: 0, attempts: 0 };
      existing.makes += drill.makes;
      existing.attempts += drill.attempts;
      totals.set(drill.category, existing);
    }
  }
  return totals;
}

// The rule-based stats plan Jay asked for — deliberately NOT the harder
// AI-video-scan idea that's separately scoped and still at the Phase-0
// feasibility-spike stage (see DRILLSTREAK.md's Video/AI-tracking
// section). This only needs data that already exists: the most recently
// CLOSED in-season's shooting results, grouped by category, picking
// whichever category has the lowest make percentage (min 5 attempts, so
// a single lucky/unlucky rep doesn't produce a misleading recommendation)
// as the offseason focus. Returns null when there's nothing to base a
// suggestion on — no prior season, or no season had qualifying shooting
// data — rather than fabricating a generic "work on shooting" that isn't
// actually derived from this player's own numbers.
export async function getOffseasonFocusSuggestion(playerId: string): Promise<FocusSuggestion | null> {
  const history = await listSeasonHistory(playerId);
  const lastInSeason = history.find((s) => !s.isOffseason);
  if (!lastInSeason) return null;

  const seasonHistory = await getCompletionHistory(playerId, lastInSeason.id);
  const byCategory = shootingPctByCategory(seasonHistory);

  let weakest: FocusSuggestion | null = null;
  for (const [category, { makes, attempts }] of byCategory) {
    if (attempts < 5) continue;
    const pct = (makes / attempts) * 100;
    if (!weakest || pct < weakest.pct) {
      weakest = { category, pct: Math.round(pct), makes, attempts };
    }
  }
  return weakest;
}

// Same "last closed in-season, real data only" grounding as the shooting
// suggestion above, reframed for conditioning's different shape — see
// ConditioningFocusSuggestion's comment. Returns null when there's no
// prior season (nothing to check) or when the player already logged 5+
// real conditioning results last season (already tracking it well, no
// need to suggest it as a gap). Below 5 counts as under-tracked and
// worth suggesting explicitly.
export async function getConditioningFocusSuggestion(playerId: string): Promise<ConditioningFocusSuggestion | null> {
  const history = await listSeasonHistory(playerId);
  const lastInSeason = history.find((s) => !s.isOffseason);
  if (!lastInSeason) return null;

  const seasonHistory = await getCompletionHistory(playerId, lastInSeason.id);
  let trackedCount = 0;
  for (const entry of seasonHistory) {
    for (const drill of entry.drills) {
      if (drill.category !== 'conditioning') continue;
      if (drill.attempts != null || drill.durationSeconds != null) trackedCount++;
    }
  }
  return trackedCount < 5 ? { trackedCount } : null;
}
