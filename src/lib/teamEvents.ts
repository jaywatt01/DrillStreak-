import * as Calendar from 'expo-calendar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { requestCalendarWriteAccess } from './calendar';

// Local-only map of team_events.id -> this device's expo-calendar event id.
// Deliberately per-device, never server-stored: an expo-calendar event id
// only means something on the device that created it, and each person who
// taps "Add to my calendar" gets their own separate copy on their own
// phone — there's no single shared "the" calendar-event id for a team
// event the way there is for the team_events row itself.
const CALENDAR_MAP_STORAGE_KEY = 'drillstreak:teamEventCalendarMap';

async function readCalendarMap(): Promise<Record<string, string>> {
  const raw = await AsyncStorage.getItem(CALENDAR_MAP_STORAGE_KEY);
  return raw ? JSON.parse(raw) : {};
}

async function writeCalendarMap(map: Record<string, string>): Promise<void> {
  await AsyncStorage.setItem(CALENDAR_MAP_STORAGE_KEY, JSON.stringify(map));
}

// Every team_events.id this device has personally added to its own
// calendar, regardless of team — used to render "already added" state and
// as the candidate set for syncDeletedTeamEventsFromCalendar below.
export async function getLocallyAddedEventIds(): Promise<Set<string>> {
  return new Set(Object.keys(await readCalendarMap()));
}

export type TeamEvent = {
  id: string;
  teamId: string;
  title: string;
  eventType: string | null;
  eventDate: string; // "YYYY-MM-DD"
  eventTime: string | null; // "HH:MM:SS"
  location: string | null;
  notes: string | null;
  createdByUserId: string;
};

const TEAM_EVENT_COLUMNS =
  'id, team_id, title, event_type, event_date, event_time, location, notes, created_by_user_id';

function mapEventRow(row: {
  id: string;
  team_id: string;
  title: string;
  event_type: string | null;
  event_date: string;
  event_time: string | null;
  location: string | null;
  notes: string | null;
  created_by_user_id: string;
}): TeamEvent {
  return {
    id: row.id,
    teamId: row.team_id,
    title: row.title,
    eventType: row.event_type,
    eventDate: row.event_date,
    eventTime: row.event_time,
    location: row.location,
    notes: row.notes,
    createdByUserId: row.created_by_user_id,
  };
}

// Upcoming first (today forward), soonest at the top — matches how a
// season schedule actually gets read, not most-recently-created.
export async function getUpcomingTeamEvents(teamId: string): Promise<TeamEvent[]> {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const { data, error } = await supabase
    .from('team_events')
    .select(TEAM_EVENT_COLUMNS)
    .eq('team_id', teamId)
    .gte('event_date', todayStr)
    .order('event_date', { ascending: true })
    .order('event_time', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []).map(mapEventRow);
}

export type TeamEventInput = {
  title: string;
  eventType: string | null;
  eventDate: string;
  eventTime: string | null;
  location: string | null;
  notes: string | null;
};

// Coach-only per team_events_coach_insert RLS.
export async function createTeamEvent(teamId: string, input: TeamEventInput): Promise<TeamEvent> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error('Not signed in');

  const { data, error } = await supabase
    .from('team_events')
    .insert({
      team_id: teamId,
      title: input.title,
      event_type: input.eventType,
      event_date: input.eventDate,
      event_time: input.eventTime,
      location: input.location,
      notes: input.notes,
      created_by_user_id: userId,
    })
    .select(TEAM_EVENT_COLUMNS)
    .single();
  if (error) throw error;
  return mapEventRow(data);
}

export async function deleteTeamEvent(eventId: string): Promise<void> {
  const { error } = await supabase.from('team_events').delete().eq('id', eventId);
  if (error) throw error;
}

// Writes a team event straight to whichever device is running the app —
// same expo-calendar plumbing already used for drill reminders
// (addDrillToCalendar in lib/calendar.ts), not a new integration. There is
// no server-side push to a player's/parent's personal calendar app; each
// account taps "Add to my calendar" on their own device, same model as the
// existing drill-scheduling feature. Stores the resulting local calendar
// event id so a second tap doesn't create a duplicate, and so
// syncDeletedTeamEventsFromCalendar below can clean it up if the team
// event is later deleted.
export async function addTeamEventToCalendar(event: TeamEvent): Promise<void> {
  const map = await readCalendarMap();
  if (map[event.id]) return; // already added on this device — no-op, not an error

  const granted = await requestCalendarWriteAccess();
  if (!granted) {
    throw new Error('Calendar permission was not granted.');
  }

  const defaultCalendar = await Calendar.getDefaultCalendarAsync();
  if (!defaultCalendar) {
    throw new Error('No default calendar found on this device.');
  }

  const [year, month, day] = event.eventDate.split('-').map(Number);
  const [hours, minutes] = event.eventTime ? event.eventTime.split(':').map(Number) : [9, 0];
  const startDate = new Date(year, month - 1, day, hours, minutes);
  // No stated duration for a game/practice/meal the way a drill has one —
  // defaults to a 1-hour block, editable by the user in their own calendar
  // app afterward same as any manually-added event.
  const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);

  const calendarEventId = await Calendar.createEventAsync(defaultCalendar.id, {
    title: event.title,
    startDate,
    endDate,
    location: event.location ?? undefined,
    notes: event.notes ?? undefined,
  });

  map[event.id] = calendarEventId;
  await writeCalendarMap(map);
}

// Reconciles this device's own calendar against team_events that have
// since been deleted server-side. There's no way to push a delete into
// someone else's phone the instant a coach removes an event — expo-
// calendar (and iOS/Android calendar APIs generally) only ever touch the
// calendar of the device the code is running on — so each device that has
// ever added a team event cleans up its own copy the next time it loads
// the calendar, not instantly for everyone at once. Only ever looks at
// ids this device itself added (map keys), so it can't touch or even see
// any other event on the user's personal calendar.
export async function syncDeletedTeamEventsFromCalendar(): Promise<void> {
  const map = await readCalendarMap();
  const trackedIds = Object.keys(map);
  if (trackedIds.length === 0) return;

  const { data, error } = await supabase.from('team_events').select('id').in('id', trackedIds);
  if (error) throw error;
  const stillExisting = new Set((data ?? []).map((row) => row.id as string));

  let changed = false;
  for (const id of trackedIds) {
    if (!stillExisting.has(id)) {
      try {
        await Calendar.deleteEventAsync(map[id]);
      } catch {
        // Already gone from the device's Calendar app (e.g. the user
        // deleted it manually themselves) — the end state we wanted
        // either way, not an error worth surfacing.
      }
      delete map[id];
      changed = true;
    }
  }
  if (changed) await writeCalendarMap(map);
}
