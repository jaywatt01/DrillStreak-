import { supabase } from './supabase';
import { DRILL_SELECT_COLUMNS, Drill, mapDrillRow } from './players';

// Every category currently present across the default library + a
// player's own custom drills, e.g. ["ballhandling", "conditioning",
// "shooting"] — sourced from real drill data (drills.category), never a
// fixed hardcoded list, so a coach/player adding a custom drill with a new
// category name automatically gets a chip for it next time. Sorted
// alphabetically for a stable chip order.
export async function listDrillCategories(playerId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('drills')
    .select('category')
    .or(`is_default.eq.true,player_id.eq.${playerId}`);
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
export async function listAllDrills(playerId: string): Promise<Drill[]> {
  const { data, error } = await supabase
    .from('drills')
    .select(DRILL_SELECT_COLUMNS)
    .or(`is_default.eq.true,player_id.eq.${playerId}`)
    .order('category');
  if (error) throw error;
  return (data ?? []).map(mapDrillRow);
}

// The "what to work on today" suggestion — 2-3 drills matching a chosen
// category, from the same visible-drill pool as the category list above.
// `limit` defaults to 3 per the brainstormed "2-3 workouts in that area"
// shape; category match is exact (drills already store one flat category
// string, no sub-tagging), case-sensitive since listDrillCategories is the
// only source of category values a chip UI would ever pass in here.
export async function getSuggestedDrillsForCategory(
  playerId: string,
  category: string,
  limit = 3
): Promise<Drill[]> {
  const { data, error } = await supabase
    .from('drills')
    .select(DRILL_SELECT_COLUMNS)
    .or(`is_default.eq.true,player_id.eq.${playerId}`)
    .eq('category', category)
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(mapDrillRow);
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
