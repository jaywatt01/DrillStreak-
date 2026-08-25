import { supabase } from './supabase';

export type BadgeType =
  | 'streak_7'
  | 'streak_30'
  | 'streak_60'
  | 'streak_100'
  | 'challenge_won'
  | 'offseason_completed';

export type Badge = {
  id: string;
  type: BadgeType;
  challengeId: string | null;
  earnedAt: string;
};

// Added 2026-08-25 (streak_60): a real gap Jay caught — 30 to 100 is a
// big jump with nothing in between to reward, a halfway-point milestone
// so a player still gets something before the big one.
const STREAK_MILESTONES: { threshold: number; type: BadgeType }[] = [
  { threshold: 100, type: 'streak_100' },
  { threshold: 60, type: 'streak_60' },
  { threshold: 30, type: 'streak_30' },
  { threshold: 7, type: 'streak_7' },
];

export const BADGE_LABELS: Record<BadgeType, string> = {
  streak_7: '7-day streak',
  streak_30: '30-day streak',
  streak_60: '60-day streak',
  streak_100: '100-day streak',
  challenge_won: 'Challenge won',
  offseason_completed: 'Offseason completed',
};

// One unique, non-overlapping emoji per badge — the streak series
// deliberately escalates (spark -> bolt -> star -> crown) so the four
// milestones read as a visible progression, not four random icons. The
// two "event" badges (challenge_won, offseason_completed) get icons that
// don't visually collide with the streak series or each other.
export const BADGE_ICONS: Record<BadgeType, string> = {
  streak_7: '🔥',
  streak_30: '⚡',
  streak_60: '🌟',
  streak_100: '👑',
  challenge_won: '🏆',
  offseason_completed: '🏀',
};

export const BADGE_HOW_TO_EARN: Record<BadgeType, string> = {
  streak_7: 'Log a drill 7 days in a row this season.',
  streak_30: 'Log a drill 30 days in a row this season.',
  streak_60: 'Log a drill 60 days in a row this season.',
  streak_100: 'Log a drill 100 days in a row this season.',
  challenge_won: 'Win a head-to-head Challenge a Friend. Earn one every time you win — lifetime count.',
  offseason_completed: 'Stay active through an offseason — roughly 2+ workouts a month. Lifetime count.',
};

// The 4 streak badges reset every season (Jay-requested, 2026-08-25) —
// matches the streak number itself already resetting at a season
// boundary, so a milestone has to be re-earned each season instead of
// staying lit forever after the first time. challenge_won and
// offseason_completed stay lifetime/career badges — a challenge window
// already runs independent of season boundaries by design (see
// DRILLSTREAK.md), and offseason_completed is already its own one-time-
// per-offseason event, not something that needs a season clock on top.
export const SEASON_SCOPED_BADGE_TYPES: BadgeType[] = ['streak_7', 'streak_30', 'streak_60', 'streak_100'];

// Fixed display order for the legend/catalog — not the same as object key
// order (not guaranteed), and not earned-date order (that's listBadges'
// job). Streak progression first, then the two event badges.
export const BADGE_CATALOG_ORDER: BadgeType[] = [
  'streak_7',
  'streak_30',
  'streak_60',
  'streak_100',
  'challenge_won',
  'offseason_completed',
];

function mapBadgeRow(row: { id: string; type: string; challenge_id: string | null; earned_at: string }): Badge {
  return { id: row.id, type: row.type as BadgeType, challengeId: row.challenge_id, earnedAt: row.earned_at };
}

export async function listBadges(playerId: string): Promise<Badge[]> {
  const { data, error } = await supabase
    .from('badges')
    .select('id, type, challenge_id, earned_at')
    .eq('player_id', playerId)
    .order('earned_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapBadgeRow);
}

// A season's date range, structurally typed rather than importing Season
// from seasons.ts — seasons.ts already imports from this file (badges),
// so importing Season back here would be circular.
export type SeasonRange = { startedAt: string; endedAt: string | null };

export function filterBadgesInRange(badges: Badge[], range: SeasonRange): Badge[] {
  const start = new Date(range.startedAt).getTime();
  const end = range.endedAt ? new Date(range.endedAt).getTime() : Date.now();
  return badges.filter((b) => {
    const earnedAt = new Date(b.earnedAt).getTime();
    return earnedAt >= start && earnedAt <= end;
  });
}

// What should actually render as "earned" on Home/Account: every
// lifetime-type badge (challenge_won, offseason_completed — never
// filtered), plus only the season-scoped streak badges earned within the
// given active season. No active season at all (player never toggled
// seasons) falls back to showing everything, same all-time behavior as
// before this feature existed — full backward compatibility.
export function filterCurrentBadges(allBadges: Badge[], activeSeason: SeasonRange | null): Badge[] {
  if (!activeSeason) return allBadges;
  return allBadges.filter((b) => {
    if (!SEASON_SCOPED_BADGE_TYPES.includes(b.type)) return true;
    return filterBadgesInRange([b], activeSeason).length > 0;
  });
}

// Streak badges used to be singletons per player (dedupe_key = the type
// itself) so they'd only ever be earned once, lifetime. Now that they
// reset each season (see SEASON_SCOPED_BADGE_TYPES above), dedupe_key
// folds in the season id so the SAME milestone can be re-earned as a new,
// distinct row once a new season starts — the upsert still protects
// against a duplicate award within the SAME season (a re-render, a second
// device), just no longer across season boundaries. No active season
// (player never toggled seasons) falls back to the original global
// singleton key — unchanged behavior for anyone not using seasons at all.
// Only awards the HIGHEST milestone actually crossed on this call — if a
// player jumps straight from 5 to 30 days (backfilled/edge case), they
// still only get the 30-day badge, not both 7 and 30 at once.
export async function awardStreakBadgesIfNeeded(
  playerId: string,
  currentStreak: number,
  seasonId?: string
): Promise<void> {
  const crossed = STREAK_MILESTONES.find((m) => currentStreak >= m.threshold);
  if (!crossed) return;
  const dedupeKey = seasonId ? `${crossed.type}:${seasonId}` : crossed.type;
  const { error } = await supabase
    .from('badges')
    .upsert(
      { player_id: playerId, type: crossed.type, dedupe_key: dedupeKey },
      { onConflict: 'player_id,dedupe_key', ignoreDuplicates: true }
    );
  if (error) throw error;
}

// One badge per completed offseason (dedupe_key keyed by the closed
// season's id, not a singleton) — a player who does this every year
// should collect one each time, same shape as challenge_won. Called from
// seasons.ts's startInSeason flow only when the just-closed season was
// (a) actually an offseason and (b) had real activity logged in it — no
// participation trophy for toggling offseason on and immediately back off
// without doing anything.
export async function awardOffseasonBadgeIfNeeded(playerId: string, offseasonId: string): Promise<void> {
  const { error } = await supabase
    .from('badges')
    .upsert(
      {
        player_id: playerId,
        type: 'offseason_completed',
        dedupe_key: `offseason_completed:${offseasonId}`,
      },
      { onConflict: 'player_id,dedupe_key', ignoreDuplicates: true }
    );
  if (error) throw error;
}

export async function awardChallengeWonBadgeIfNeeded(playerId: string, challengeId: string): Promise<void> {
  const { error } = await supabase
    .from('badges')
    .upsert(
      {
        player_id: playerId,
        type: 'challenge_won',
        dedupe_key: `challenge_won:${challengeId}`,
        challenge_id: challengeId,
      },
      { onConflict: 'player_id,dedupe_key', ignoreDuplicates: true }
    );
  if (error) throw error;
}
