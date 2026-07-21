import * as Calendar from 'expo-calendar';

// Full calendar read+write access, NOT write-only. The build spec called
// for write-only, but the expo-calendar version SDK 54 actually pins
// (15.0.8) doesn't support it at all — its config plugin only recognizes
// full-access permission strings, confirmed by reading the plugin source
// directly, not just the (ahead-of-SDK-54) public docs. Decided July 20,
// 2026 to ship full access rather than force an unpinned package version
// or block on a future SDK. See DRILLSTREAK.md for the full writeup.
export async function requestCalendarWriteAccess(): Promise<boolean> {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  return status === Calendar.PermissionStatus.GRANTED;
}

export async function addDrillToCalendar(drillName: string, date: Date): Promise<void> {
  const granted = await requestCalendarWriteAccess();
  if (!granted) {
    throw new Error('Calendar permission was not granted.');
  }

  const defaultCalendar = await Calendar.getDefaultCalendarAsync();
  if (!defaultCalendar) {
    throw new Error('No default calendar found on this device.');
  }

  const startDate = new Date(date);
  startDate.setHours(9, 0, 0, 0);
  const endDate = new Date(startDate);
  endDate.setHours(startDate.getHours() + 1);

  await Calendar.createEventAsync(defaultCalendar.id, {
    title: drillName,
    startDate,
    endDate,
  });
}
