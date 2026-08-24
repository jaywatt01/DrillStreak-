import { supabase } from './supabase';
import { localDateString, mondayOfThisWeek, todayDateString, weekIndex } from './date';

// height/weight are free text (e.g. "6'2\"", "165 lbs") rather than a
// structured unit — matches this app's low-friction self-report philosophy
// everywhere else (completions, makes/attempts) rather than forcing a
// unit-conversion decision. position is free text too, not a fixed enum —
// the app is deliberately sport-agnostic (see the Theme section in
// DRILLSTREAK.md), and a basketball-specific position list would break that.
export type Player = {
  id: string;
  display_name: string;
  height: string | null;
  weight: string | null;
  grad_year: number | null;
  position: string | null;
};

export const PLAYER_SELECT_COLUMNS = 'id, display_name, height, weight, grad_year, position';

// Joins whichever bio fields are actually set into one line — e.g.
// "Point Guard · 6'2" · 165 lbs · Class of 2027". Skips anything blank
// rather than showing an empty placeholder, and returns null (render
// nothing) if none of the four fields are filled in yet. Shared between
// Progress and Home so both screens read the exact same formatting —
// moved here from ProgressScreen.tsx rather than duplicated a second time.
export function formatPlayerBio(player: Player): string | null {
  const parts = [
    player.position,
    player.height,
    player.weight,
    player.grad_year != null ? `Class of ${player.grad_year}` : null,
  ].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export type ShootingComposite = { makes: number; attempts: number };

// Free throws are a distinct, recognized stat on their own (FT%), separate
// from field-shooting drills like spot-up or form shooting — split out by
// name match rather than a structured drill-type field, since drills don't
// have one (category is free text). Substring match so a custom drill
// named e.g. "FT line reps" or "Free Throw Practice" still counts.
export function isFreeThrowDrill(drillName: string): boolean {
  return drillName.toLowerCase().includes('free throw');
}

// Sums every logged completion that has BOTH makes and attempts set — that
// pair is what marks an entry as shooting-type data (a rep-only drill like
// suicides or jump rope logs attempts alone, with makes left null, so it's
// excluded here — it gets its own tally instead, via computeRepTallies
// below, since there's no "make" for a sprint or a jump-rope rep and a
// percentage wouldn't mean anything for it). `matches` further splits
// shooting drills into two buckets (free throws vs. everything else) so
// the two composites don't double-count the same completion. Returns null
// (render nothing) if that bucket has no data yet. Shared between
// Progress (player/parent view, tier-gated history) and the coach roster
// view (RLS-gated history) — both just pass whatever history they're
// actually allowed to see; this function doesn't know or care which.
export function computeMakesAttemptsTotal(
  history: CompletionHistoryEntry[],
  matches: (drillName: string) => boolean
): ShootingComposite | null {
  let makes = 0;
  let attempts = 0;
  for (const entry of history) {
    for (const drill of entry.drills) {
      if (drill.makes != null && drill.attempts != null && matches(drill.name)) {
        makes += drill.makes;
        attempts += drill.attempts;
      }
    }
  }
  return attempts > 0 ? { makes, attempts } : null;
}

export type ShootingBreakdownEntry = { date: string; drillName: string; makes: number; attempts: number };

// The per-entry counterpart to computeMakesAttemptsTotal — same matching
// logic, but returns the individual contributing rows instead of a sum, so
// tapping a Free Throws/Shooting card can show exactly which days and
// drills made up that total. `history` is already ordered most-recent-day
// first (see getCompletionHistory), so no re-sort needed here.
export function computeShootingBreakdown(
  history: CompletionHistoryEntry[],
  matches: (drillName: string) => boolean
): ShootingBreakdownEntry[] {
  const entries: ShootingBreakdownEntry[] = [];
  for (const entry of history) {
    for (const drill of entry.drills) {
      if (drill.makes != null && drill.attempts != null && matches(drill.name)) {
        entries.push({ date: entry.date, drillName: drill.name, makes: drill.makes, attempts: drill.attempts });
      }
    }
  }
  return entries;
}

export type RepTally = { drillName: string; totalAttempts: number };

// The counterpart to computeMakesAttemptsTotal above: totals attempts for
// every drill logged WITHOUT a makes value — jump rope reps, suicides,
// sprints, anything that's a rep count rather than a makes/attempts pair.
// Grouped and summed per drill name, most-logged drill first. A drill
// with a mix of makes/attempts entries AND attempts-only entries (unusual,
// but not prevented at the data layer) only contributes its attempts-only
// entries here — the makes/attempts ones are already counted in the
// shooting composite, and double-counting either way would overstate one
// of the two numbers.
export function computeRepTallies(history: CompletionHistoryEntry[]): RepTally[] {
  const totals = new Map<string, number>();
  for (const entry of history) {
    for (const drill of entry.drills) {
      if (drill.attempts != null && drill.makes == null) {
        totals.set(drill.name, (totals.get(drill.name) ?? 0) + drill.attempts);
      }
    }
  }
  return Array.from(totals.entries())
    .map(([drillName, totalAttempts]) => ({ drillName, totalAttempts }))
    .sort((a, b) => b.totalAttempts - a.totalAttempts);
}

// Fallback event length for any drill with no set duration (custom or
// seeded). 30, not 60 — most drills in the seeded library run 5-10 min,
// and a blanket hour block overstates almost all of them.
export const DEFAULT_DRILL_MINUTES = 30;

export type Drill = {
  id: string;
  name: string;
  category: string | null;
  estimatedMinutes: number | null;
  videoUrl: string | null;
};

export type CustomDrill = Drill & { is_default: boolean };

export const DRILL_SELECT_COLUMNS = 'id, name, category, estimated_minutes, video_url';

// Maps a raw `drills` row (snake_case, as returned by supabase-js) to the
// camelCase Drill shape used throughout the app.
export function mapDrillRow(row: {
  id: string;
  name: string;
  category: string | null;
  estimated_minutes: number | null;
  video_url: string | null;
}): Drill {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    estimatedMinutes: row.estimated_minutes,
    videoUrl: row.video_url,
  };
}

export async function listMyPlayers(): Promise<Player[]> {
  const { data, error } = await supabase.rpc('list_my_players');
  if (error) throw error;
  return (data ?? []) as Player[];
}

export async function addPlayer(displayName: string): Promise<Player> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error('Not signed in');

  const { data, error } = await supabase
    .from('players')
    .insert({ display_name: displayName, created_by_user_id: userId })
    .select(PLAYER_SELECT_COLUMNS)
    .single();
  if (error) throw error;
  return data as Player;
}

export type PlayerProfileUpdate = {
  displayName: string;
  height: string | null;
  weight: string | null;
  gradYear: number | null;
  position: string | null;
};

// Replaces the old narrower renamePlayer — same call site (AddPlayerScreen's
// player edit form), now covering the recruitment-profile bio fields too.
export async function updatePlayerProfile(playerId: string, update: PlayerProfileUpdate): Promise<void> {
  const { error } = await supabase
    .from('players')
    .update({
      display_name: update.displayName,
      height: update.height,
      weight: update.weight,
      grad_year: update.gradYear,
      position: update.position,
    })
    .eq('id', playerId);
  if (error) throw error;
}

export async function deletePlayer(playerId: string): Promise<void> {
  const { error } = await supabase.from('players').delete().eq('id', playerId);
  if (error) throw error;
}

export async function getMyCustomDrills(playerId: string): Promise<CustomDrill[]> {
  const { data, error } = await supabase
    .from('drills')
    .select(`${DRILL_SELECT_COLUMNS}, is_default`)
    .eq('player_id', playerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({ ...mapDrillRow(row), is_default: row.is_default as boolean }));
}

export async function renameDrill(
  drillId: string,
  name: string,
  category: string,
  videoUrl: string
): Promise<void> {
  const { error } = await supabase
    .from('drills')
    .update({ name, category: category.trim() || null, video_url: videoUrl.trim() || null })
    .eq('id', drillId);
  if (error) throw error;
}

export async function deleteDrill(drillId: string): Promise<void> {
  const { error } = await supabase.from('drills').delete().eq('id', drillId);
  if (error) {
    if (error.code === '23503') {
      throw new Error(
        "Can't delete — this drill already has logged completions or assignments, so its history is preserved."
      );
    }
    throw error;
  }
}

export async function addCustomDrill(
  name: string,
  category: string,
  playerId: string,
  estimatedMinutes: number | null,
  videoUrl: string | null
): Promise<Drill> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error('Not signed in');

  const { data, error } = await supabase
    .from('drills')
    .insert({
      name,
      category: category.trim() || null,
      created_by_user_id: userId,
      player_id: playerId,
      is_default: false,
      estimated_minutes: estimatedMinutes,
      video_url: videoUrl,
    })
    .select(DRILL_SELECT_COLUMNS)
    .single();
  if (error) throw error;
  return mapDrillRow(data);
}

// A drill as it appears on Home, carrying the coach's suggested
// time/duration for this week's assignment when there is one (team
// source only — a library drill has no per-assignment schedule, just
// whatever estimatedMinutes is set on the drill itself).
export type WeeklyDrill = Drill & { scheduledTime: string | null; scheduledDurationMinutes: number | null };

// Picks which video shows this week from a drill's candidate pool,
// deterministically — same pick for everyone until the following Monday,
// no stored "current index" anywhere. Pure function of the pool + the
// current week, so it's trivially testable and never needs a migration
// to change the cadence (see weekIndex in lib/date.ts for that).
export function pickRotatingVideo(urls: string[]): string | null {
  if (urls.length === 0) return null;
  return urls[weekIndex() % urls.length];
}

// Overrides each drill's videoUrl with its rotating pick when it has a
// video pool (drill_videos rows) — falls back to the drill's own single
// video_url (set at custom-drill creation/rename) when it doesn't, so
// custom drills work exactly as before, unaffected by rotation.
async function applyVideoRotation(drills: WeeklyDrill[]): Promise<WeeklyDrill[]> {
  const drillIds = drills.map((d) => d.id);
  if (drillIds.length === 0) return drills;

  const { data, error } = await supabase.from('drill_videos').select('drill_id, url').in('drill_id', drillIds);
  if (error) throw error;

  const poolsByDrill = new Map<string, string[]>();
  for (const row of data ?? []) {
    const id = row.drill_id as string;
    const existing = poolsByDrill.get(id) ?? [];
    existing.push(row.url as string);
    poolsByDrill.set(id, existing);
  }

  return drills.map((drill) => {
    const pool = poolsByDrill.get(drill.id);
    if (!pool || pool.length === 0) return drill;
    return { ...drill, videoUrl: pickRotatingVideo(pool) };
  });
}

export async function getWeeklyDrills(
  playerId: string
): Promise<{ drills: WeeklyDrill[]; source: 'team' | 'library' }> {
  const { data: memberships, error: membershipError } = await supabase
    .from('team_memberships')
    .select('team_id')
    .eq('player_id', playerId);
  if (membershipError) throw membershipError;

  const teamIds = (memberships ?? []).map((m) => m.team_id);

  if (teamIds.length > 0) {
    const { data: assignments, error: assignmentError } = await supabase
      .from('assignments')
      .select(`scheduled_time, duration_minutes, drills(${DRILL_SELECT_COLUMNS})`)
      .in('team_id', teamIds)
      .eq('week_of', mondayOfThisWeek());
    if (assignmentError) throw assignmentError;

    const drills = (assignments ?? [])
      .flatMap((a) => {
        const drillRow = Array.isArray(a.drills) ? a.drills[0] : a.drills;
        if (!drillRow) return [];
        return [
          {
            ...mapDrillRow(drillRow),
            scheduledTime: a.scheduled_time as string | null,
            scheduledDurationMinutes: a.duration_minutes as number | null,
          },
        ];
      })
      .filter((d): d is WeeklyDrill => d != null);

    const deduped = Array.from(new Map(drills.map((d) => [d.id, d])).values());
    if (deduped.length > 0) {
      return { drills: await applyVideoRotation(deduped), source: 'team' };
    }
  }

  const { data: libraryDrills, error: libraryError } = await supabase
    .from('drills')
    .select(DRILL_SELECT_COLUMNS)
    .or(`is_default.eq.true,player_id.eq.${playerId}`)
    .order('category');
  if (libraryError) throw libraryError;

  const libraryResult: WeeklyDrill[] = (libraryDrills ?? []).map((row) => ({
    ...mapDrillRow(row),
    scheduledTime: null,
    scheduledDurationMinutes: null,
  }));

  return {
    drills: await applyVideoRotation(libraryResult),
    source: 'library',
  };
}

export type CompletionHistoryDrill = { name: string; makes: number | null; attempts: number | null };
export type CompletionHistoryEntry = { date: string; drills: CompletionHistoryDrill[] };

// Full logged history for a player, most recent day first, each day's
// drills grouped together. Gating (current-week-only for free users) is
// the caller's responsibility — this always returns everything so the
// caller can also tell whether there's more history a paywall would unlock.
export async function getCompletionHistory(playerId: string): Promise<CompletionHistoryEntry[]> {
  const { data, error } = await supabase
    .from('completions')
    .select('date, makes, attempts, drills(name)')
    .eq('player_id', playerId)
    .order('date', { ascending: false });
  if (error) throw error;

  const byDate = new Map<string, CompletionHistoryDrill[]>();
  for (const row of data ?? []) {
    const drill = Array.isArray(row.drills) ? row.drills[0] : row.drills;
    if (!drill) continue;
    const date = row.date as string;
    const existing = byDate.get(date) ?? [];
    existing.push({
      name: drill.name as string,
      makes: row.makes as number | null,
      attempts: row.attempts as number | null,
    });
    byDate.set(date, existing);
  }
  return Array.from(byDate.entries()).map(([date, drills]) => ({ date, drills }));
}

export async function getCompletionDates(playerId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('completions')
    .select('date')
    .eq('player_id', playerId)
    .order('date', { ascending: false });
  if (error) throw error;
  return Array.from(new Set((data ?? []).map((c) => c.date as string)));
}

export type PlayerNote = { note: string; updatedAt: string };

// Every coach note on this player, most recently updated first — a player
// can be on multiple teams/coaches, so this can return more than one. Not
// gated behind parent_tier (see player_notes RLS in schema.sql): coach
// notes are coach-authored content about the player, not app-usage
// history, so the free/parent-tier history paywall doesn't apply.
export async function getPlayerNotes(playerId: string): Promise<PlayerNote[]> {
  const { data, error } = await supabase
    .from('player_notes')
    .select('note, updated_at')
    .eq('player_id', playerId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({ note: row.note as string, updatedAt: row.updated_at as string }));
}

export function calculateStreak(sortedDescendingDates: string[]): number {
  if (sortedDescendingDates.length === 0) return 0;

  const today = todayDateString();
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = localDateString(yesterdayDate);

  const mostRecent = sortedDescendingDates[0];
  if (mostRecent !== today && mostRecent !== yesterdayStr) {
    return 0;
  }

  let streak = 1;
  // Built from the parsed year/month/day, not `new Date(mostRecent)` —
  // parsing a bare "YYYY-MM-DD" string parses it as UTC midnight per the
  // JS spec, not local midnight, which is exactly the class of bug fixed
  // in lib/date.ts (see localDateString's comment).
  const [mostRecentYear, mostRecentMonth, mostRecentDay] = mostRecent.split('-').map(Number);
  let cursor = new Date(mostRecentYear, mostRecentMonth - 1, mostRecentDay);
  for (let i = 1; i < sortedDescendingDates.length; i++) {
    cursor.setDate(cursor.getDate() - 1);
    const expected = localDateString(cursor);
    if (sortedDescendingDates[i] === expected) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

// Upsert with ignoreDuplicates so a double-tap, a race between two devices,
// or a retry after a dropped network response can't create a second
// completions row for the same player/drill/day (relies on the unique
// constraint added in the 2026-07-26 migration at the bottom of schema.sql).
export async function logCompletion(playerId: string, drillId: string): Promise<void> {
  const { error } = await supabase
    .from('completions')
    .upsert(
      { player_id: playerId, drill_id: drillId, date: todayDateString() },
      { onConflict: 'player_id,drill_id,date', ignoreDuplicates: true }
    );
  if (error) throw error;
}

export type DrillResult = { makes: number | null; attempts: number | null };

// Keyed by drill_id, so callers can both check "is this drill done today"
// (Map.has, same as the old Set) and read any result already logged for it.
export async function getTodayCompletions(playerId: string): Promise<Map<string, DrillResult>> {
  const { data, error } = await supabase
    .from('completions')
    .select('drill_id, makes, attempts')
    .eq('player_id', playerId)
    .eq('date', todayDateString());
  if (error) throw error;
  return new Map(
    (data ?? []).map((c) => [
      c.drill_id as string,
      { makes: c.makes as number | null, attempts: c.attempts as number | null },
    ])
  );
}

// Attaches an optional numeric result to today's already-logged completion
// for this drill (makes/attempts for shooting, or just `attempts` alone as
// a generic rep count for anything else). The completions row must already
// exist — call after logCompletion, not instead of it.
export async function logDrillResult(
  playerId: string,
  drillId: string,
  makes: number | null,
  attempts: number | null
): Promise<void> {
  const { error } = await supabase
    .from('completions')
    .update({ makes, attempts })
    .eq('player_id', playerId)
    .eq('drill_id', drillId)
    .eq('date', todayDateString());
  if (error) throw error;
}

// Undoes a mistaken "mark done" tap — deletes today's completion entirely
// (including any logged makes/attempts), not just resetting a flag, so the
// drill goes back to a real not-done state and can be marked done again.
export async function deleteCompletion(playerId: string, drillId: string): Promise<void> {
  const { error } = await supabase
    .from('completions')
    .delete()
    .eq('player_id', playerId)
    .eq('drill_id', drillId)
    .eq('date', todayDateString());
  if (error) throw error;
}
