import { supabase } from './supabase';

export type ScheduledDrill = {
  id: string;
  playerId: string;
  drillName: string;
  scheduledAt: string;
  durationMinutes: number;
};

const SCHEDULED_DRILL_COLUMNS = 'id, player_id, drill_name, scheduled_at, duration_minutes';

function mapScheduledDrillRow(row: {
  id: string;
  player_id: string;
  drill_name: string;
  scheduled_at: string;
  duration_minutes: number;
}): ScheduledDrill {
  return {
    id: row.id,
    playerId: row.player_id,
    drillName: row.drill_name,
    scheduledAt: row.scheduled_at,
    durationMinutes: row.duration_minutes,
  };
}

// Written alongside (not instead of) the existing device-calendar export
// in lib/calendar.ts — that one only ever reaches the device running the
// app, and the app never reads it back (confirmed by re-reading
// addDrillToCalendar directly), so a player-scheduled drill was invisible
// to the app itself the moment the OS calendar event was created. Real
// gap Jay caught 2026-08-25: the Home dashboard's schedule view needs its
// own server-side record to show anything for a player-scheduled
// (non-coach-assigned) drill, since coach assignments (the `assignments`
// table) only ever carry a suggested time-of-day for the whole week, not
// a specific date the way this does.
export async function recordScheduledDrill(
  playerId: string,
  drillName: string,
  scheduledAt: Date,
  durationMinutes: number
): Promise<void> {
  const { error } = await supabase.from('scheduled_drills').insert({
    player_id: playerId,
    drill_name: drillName,
    scheduled_at: scheduledAt.toISOString(),
    duration_minutes: durationMinutes,
  });
  if (error) throw error;
}

// Upcoming first (today forward), soonest at the top — same ordering
// convention as getUpcomingTeamEvents in lib/teamEvents.ts, so the two
// merge cleanly into one chronological list on the dashboard.
export async function getUpcomingScheduledDrills(playerId: string): Promise<ScheduledDrill[]> {
  const { data, error } = await supabase
    .from('scheduled_drills')
    .select(SCHEDULED_DRILL_COLUMNS)
    .eq('player_id', playerId)
    .gte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapScheduledDrillRow);
}
