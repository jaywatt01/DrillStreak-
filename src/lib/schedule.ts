import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { removeDrillFromCalendar } from './calendar';

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
): Promise<string> {
  const { data, error } = await supabase
    .from('scheduled_drills')
    .insert({
      player_id: playerId,
      drill_name: drillName,
      scheduled_at: scheduledAt.toISOString(),
      duration_minutes: durationMinutes,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

// Local-only map of scheduled_drills.id -> this device's expo-calendar
// event id — same reasoning and shape as teamEvents.ts's calendar map. A
// scheduled drill is created and deleted by the same person on the same
// device (unlike a team event, which a coach can delete remotely), so
// there's no cross-device lazy-sync case to handle here — deleting just
// removes the calendar event immediately, in the same call.
const CALENDAR_MAP_STORAGE_KEY = 'drillstreak:scheduledDrillCalendarMap';

async function readCalendarMap(): Promise<Record<string, string>> {
  const raw = await AsyncStorage.getItem(CALENDAR_MAP_STORAGE_KEY);
  return raw ? JSON.parse(raw) : {};
}

async function writeCalendarMap(map: Record<string, string>): Promise<void> {
  await AsyncStorage.setItem(CALENDAR_MAP_STORAGE_KEY, JSON.stringify(map));
}

export async function recordScheduledDrillCalendarEvent(
  scheduledDrillId: string,
  calendarEventId: string
): Promise<void> {
  const map = await readCalendarMap();
  map[scheduledDrillId] = calendarEventId;
  await writeCalendarMap(map);
}

// Real gap Jay caught testing on Android, Sept 5, 2026: once a drill was
// scheduled/added to the calendar, there was no way to remove it from
// within the app at all — the only option was deleting it from the
// phone's native Calendar app directly. Deletes both halves: the server
// row (so it stops showing on the Home dashboard) and, if this device is
// the one that scheduled it, the matching calendar event too.
export async function deleteScheduledDrill(scheduledDrillId: string): Promise<void> {
  const { error } = await supabase.from('scheduled_drills').delete().eq('id', scheduledDrillId);
  if (error) throw error;

  const map = await readCalendarMap();
  const calendarEventId = map[scheduledDrillId];
  if (calendarEventId) {
    await removeDrillFromCalendar(calendarEventId);
    delete map[scheduledDrillId];
    await writeCalendarMap(map);
  }
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
