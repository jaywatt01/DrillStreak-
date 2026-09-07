import { Platform } from 'react-native';
import * as Calendar from 'expo-calendar';

// Full calendar read+write access, NOT write-only. The build spec called
// for write-only, but the expo-calendar version SDK 54 actually pins
// (15.0.8) doesn't support it at all — its config plugin only recognizes
// full-access permission strings, confirmed by reading the plugin source
// directly, not just the (ahead-of-SDK-54) public docs. Decided July 20,
// 2026 to ship full access rather than block on a future SDK. See
// DRILLSTREAK.md for the full writeup.
export async function requestCalendarWriteAccess(): Promise<boolean> {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  return status === Calendar.PermissionStatus.GRANTED;
}

// Real bug caught on the first Android device test, Sept 5, 2026:
// Calendar.getDefaultCalendarAsync() is iOS-only — Android has no single
// "default calendar" concept (multiple calendar accounts/sources can
// exist), so the call threw immediately on Android, blocking the feature
// entirely on that platform. Fixed by asking for the device's actual
// calendar list on Android and picking a real writable one, instead of
// assuming an API that only ever existed on one platform.
async function getTargetCalendarId(): Promise<string> {
  if (Platform.OS === 'ios') {
    const defaultCalendar = await Calendar.getDefaultCalendarAsync();
    if (!defaultCalendar) {
      throw new Error('No default calendar found on this device.');
    }
    return defaultCalendar.id;
  }

  // Real bug found Sept 6, 2026 on a real device (BLU View Speed Ultra):
  // the drill saved successfully (confirmed by the app's own cancel/delete
  // working) but never showed up in Google Calendar. Root cause CONFIRMED
  // LIVE via a temporary diagnostic log against Jay's real device (removed
  // once confirmed, not left in) — the phone had a bundled offline "PC
  // Sync" local-account calendar marked isPrimary: true, completely
  // separate from the real jaywatt01@gmail.com Google account calendar
  // (also present, also writable, but isPrimary: false at the time).
  // `allowsModifications && isPrimary` picked "PC Sync" every time — and
  // Google Calendar's app doesn't display local, non-account calendars by
  // default, so the event was real but invisible in the one app anyone
  // actually checks. Prefers a writable calendar backed by a real synced
  // account (`source.isLocalAccount` is not true) before falling back to
  // primary-only, then to any writable calendar at all. Confirmed on
  // Jay's device: correctly skips "PC Sync," picks the real Google
  // account calendar, the drill shows up in Google Calendar, and
  // deleting it in the app deletes the real calendar event too.
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const writable = calendars.filter((c) => c.allowsModifications);
  const target =
    writable.find((c) => c.isPrimary && c.source?.isLocalAccount !== true) ??
    writable.find((c) => c.source?.isLocalAccount !== true) ??
    writable.find((c) => c.isPrimary) ??
    writable[0];
  if (!target) {
    throw new Error('No writable calendar found on this device.');
  }
  return target.id;
}

// Returns the device's own calendar event id — callers that want to be
// able to delete this specific event later (see deleteScheduledDrill in
// lib/schedule.ts) need to hold onto it themselves; expo-calendar has no
// way to look an event back up by title/time after the fact.
export async function addDrillToCalendar(
  drillName: string,
  startDate: Date,
  durationMinutes: number
): Promise<string> {
  const granted = await requestCalendarWriteAccess();
  if (!granted) {
    throw new Error('Calendar permission was not granted.');
  }

  const calendarId = await getTargetCalendarId();

  const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);

  return Calendar.createEventAsync(calendarId, {
    title: drillName,
    startDate,
    endDate,
  });
}

export async function removeDrillFromCalendar(calendarEventId: string): Promise<void> {
  try {
    await Calendar.deleteEventAsync(calendarEventId);
  } catch {
    // Already gone from the device's Calendar app (e.g. the user deleted
    // it manually themselves) — the end state we wanted either way, same
    // reasoning as syncDeletedTeamEventsFromCalendar in lib/teamEvents.ts.
  }
}
