import { supabase } from './supabase';
import { DRILL_SELECT_COLUMNS, Drill, mapDrillRow, matchesPrimaryDrillFilter } from './players';

// Every category currently present across the default library + a
// player's own custom drills, e.g. ["ballhandling", "conditioning",
// "shooting"] — sourced from real drill data (drills.category), never a
// fixed hardcoded list, so a coach/player adding a custom drill with a new
// category name automatically gets a chip for it next time. Sorted
// alphabetically for a stable chip order.
// sport scopes the shared default library to this player's own sport
// (added 2026-09-10 alongside baseball/softball) — a player's own custom
// drills (player_id match) still show regardless, same as before.
export async function listDrillCategories(playerId: string, sport: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('drills')
    .select('category')
    .or(`and(is_default.eq.true,sport.eq.${sport}),player_id.eq.${playerId}`);
  if (error) throw error;
  const categories = new Set(
    (data ?? [])
      .map((row) => (row.category as string | null)?.trim())
      .filter((c): c is string => !!c)
  );
  return Array.from(categories).sort();
}

// The player's full visible drill pool (default library + their own custom
// drills) regardless of what's assigned this week — the workout builder
// needs to offer everything a player could pick, not just this week's
// team assignments. Same filter shape as getWeeklyDrills' library
// fallback in lib/players.ts, extracted here since the builder needs it
// unconditionally, not just when there's no team assignment.
export async function listAllDrills(playerId: string, sport: string): Promise<Drill[]> {
  const { data, error } = await supabase
    .from('drills')
    .select(DRILL_SELECT_COLUMNS)
    .or(`and(is_default.eq.true,sport.eq.${sport}),player_id.eq.${playerId}`)
    .order('category');
  if (error) throw error;
  return (data ?? []).map(mapDrillRow);
}

// Quick Start, 2026-09-09 v2 — real correction from Jay's on-device
// feedback on v1 (which listed 3 full drill rows up top): with a 10-20
// player roster, spending that much vertical space above the actual roster
// list recreates the scroll fatigue this whole feature exists to avoid.
// Now a chip produces one random drill on tap instead of pre-listing
// suggestions — same "give me something fast" intent, a fraction of the
// footprint (one small chip per option instead of a full row each).
// Re-tapping the same chip re-rolls (no memory kept) rather than showing
// the same pick twice in a row.
//
// 2026-09-11: generalized from category-only to whichever field is
// primary for the sport (matchesPrimaryDrillFilter, lib/players.ts) —
// Quick Start now offers positions for volleyball/soccer, same as the
// "What to work on today" picker below it, instead of staying
// category-based while everything else on the screen flipped.
export function pickRandomDrillFromPrimary(allDrills: Drill[], sport: string, primaryValue: string): Drill | null {
  const matching = allDrills.filter((d) => matchesPrimaryDrillFilter(d, sport, primaryValue));
  if (matching.length === 0) return null;
  return matching[Math.floor(Math.random() * matching.length)];
}

export type WorkoutTemplate = {
  id: string;
  name: string;
  drills: Drill[];
};

export async function listWorkoutTemplates(playerId: string): Promise<WorkoutTemplate[]> {
  const { data, error } = await supabase
    .from('workout_templates')
    .select(`id, name, workout_template_drills(sort_order, drills(${DRILL_SELECT_COLUMNS}))`)
    .eq('player_id', playerId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  return (data ?? []).map((row) => {
    const templateDrills = Array.isArray(row.workout_template_drills) ? row.workout_template_drills : [];
    const drills = templateDrills
      .slice()
      .sort((a, b) => (a.sort_order as number) - (b.sort_order as number))
      .flatMap((td) => {
        const drillRow = Array.isArray(td.drills) ? td.drills[0] : td.drills;
        return drillRow ? [mapDrillRow(drillRow)] : [];
      });
    return { id: row.id as string, name: row.name as string, drills };
  });
}

// Creates the template row, then its ordered drill links — two inserts,
// not a transaction, but safe as a two-step sequence: if the second insert
// fails, the template exists with zero drills rather than a partial drill
// list, which is an obviously-broken, easy-to-notice state (an empty
// workout), not a silently-wrong one.
export async function createWorkoutTemplate(
  playerId: string,
  name: string,
  drillIds: string[]
): Promise<string> {
  const { data, error } = await supabase
    .from('workout_templates')
    .insert({ player_id: playerId, name })
    .select('id')
    .single();
  if (error) throw error;
  const templateId = data.id as string;

  if (drillIds.length > 0) {
    const { error: drillsError } = await supabase
      .from('workout_template_drills')
      .insert(drillIds.map((drillId, i) => ({ template_id: templateId, drill_id: drillId, sort_order: i })));
    if (drillsError) throw drillsError;
  }

  return templateId;
}

// Replaces the whole drill list rather than diffing it — a workout builder
// is a short list (typically 2-6 drills), so delete-then-reinsert is
// simpler than computing an add/remove/reorder diff and just as correct.
export async function updateWorkoutTemplate(
  templateId: string,
  name: string,
  drillIds: string[]
): Promise<void> {
  const { error: renameError } = await supabase.from('workout_templates').update({ name }).eq('id', templateId);
  if (renameError) throw renameError;

  const { error: deleteError } = await supabase
    .from('workout_template_drills')
    .delete()
    .eq('template_id', templateId);
  if (deleteError) throw deleteError;

  if (drillIds.length > 0) {
    const { error: insertError } = await supabase
      .from('workout_template_drills')
      .insert(drillIds.map((drillId, i) => ({ template_id: templateId, drill_id: drillId, sort_order: i })));
    if (insertError) throw insertError;
  }
}

export async function deleteWorkoutTemplate(templateId: string): Promise<void> {
  const { error } = await supabase.from('workout_templates').delete().eq('id', templateId);
  if (error) throw error;
}
