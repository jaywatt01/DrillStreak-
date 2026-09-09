import { supabase } from './supabase';
import { Drill, DRILL_SELECT_COLUMNS, mapDrillRow } from './players';

// A player's own picks from a category picker or Quick Start — separate
// from coach assignments (assignments table) and calendar scheduling
// (scheduled_drills). getWeeklyDrills (lib/players.ts) merges this with
// assignments; nothing else needs to read it directly today.

// Upserts so re-tapping an already-added drill (a stale UI double-tap, or
// tapping the same drill from both Quick Start and its category picker) is
// a no-op rather than a duplicate-key error.
export async function selectDrillForPlayer(playerId: string, drillId: string): Promise<void> {
  const { error } = await supabase
    .from('player_drill_selections')
    .upsert({ player_id: playerId, drill_id: drillId }, { onConflict: 'player_id,drill_id', ignoreDuplicates: true });
  if (error) throw error;
}

export async function deselectDrillForPlayer(playerId: string, drillId: string): Promise<void> {
  const { error } = await supabase
    .from('player_drill_selections')
    .delete()
    .eq('player_id', playerId)
    .eq('drill_id', drillId);
  if (error) throw error;
}

// Not used by HomeScreen today (getWeeklyDrills already merges selections
// server-side) — exported for any future screen that needs the player's
// self-picked list on its own, without assignments mixed in.
export async function listSelectedDrills(playerId: string): Promise<Drill[]> {
  const { data, error } = await supabase
    .from('player_drill_selections')
    .select(`drills(${DRILL_SELECT_COLUMNS})`)
    .eq('player_id', playerId);
  if (error) throw error;
  return (data ?? []).flatMap((row) => {
    const drillRow = Array.isArray(row.drills) ? row.drills[0] : row.drills;
    return drillRow ? [mapDrillRow(drillRow)] : [];
  });
}
