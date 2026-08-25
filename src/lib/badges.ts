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
  streak_7: 'Log a drill 7 days in a row.',
  streak_30: 'Log a drill 30 days in a row.',
  streak_60: 'Log a drill 60 days in a row.',
  streak_100: 'Log a drill 100 days in a row.',
  challenge_won: 'Win a head-to-head Challenge a Friend. Earn one every time you win.',
  offseason_completed: 'Log at least one drill during an offseason, then switch back to in-season.',
};

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

// Streak badges are singletons per player — `dedupe_key` is just the type
// itself, so a second award attempt at the same milestone (a re-render, a
// second device) upserts onto the same row instead of erroring or
// duplicating. Only awards the HIGHEST milestone actually crossed on this
// call — if a player jumps straight from 5 to 30 days (backfilled/edge
// case), they still only get the 30-day badge, not both 7 and 30 at once;
// the 7-day one simply never existed for them, same as a real player who
// hit 30 days without this feature existing yet at day 7.
export async function awardStreakBadgesIfNeeded(playerId: string, currentStreak: number): Promise<void> {
  const crossed = STREAK_MILESTONES.find((m) => currentStreak >= m.threshold);
  if (!crossed) return;
  const { error } = await supabase
    .from('badges')
    .upsert(
      { player_id: playerId, type: crossed.type, dedupe_key: crossed.type },
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
