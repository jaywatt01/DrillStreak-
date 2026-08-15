// The device's own local calendar day as "YYYY-MM-DD" — deliberately NOT
// via .toISOString(), which converts to UTC first. Real bug found
// 2026-08-15: a drill logged in the evening in a US timezone landed under
// tomorrow's UTC date (todayDateString used to be `new
// Date().toISOString().slice(0,10)`), while the streak calendar computed
// "today" from local midnight — the two disagreed every evening, so a
// same-day completion could show in history/streak (both driven by the
// same UTC-based "today") but never light up on the calendar (driven by
// local-calendar "today"), or land on a cell hidden as a future date.
// getFullYear/getMonth/getDate are local-time accessors in JS, so building
// the string from them sidesteps the UTC conversion entirely — every
// date-as-string in this app should go through this, not .toISOString().
export function localDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function mondayOfThisWeek(): string {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday, 1 = Monday, ...
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  return localDateString(monday);
}

export function todayDateString(): string {
  return localDateString(new Date());
}

// A stable, ever-incrementing week number, ticking over every Monday —
// used to deterministically rotate drill videos without storing any
// "current index" anywhere. Same value for every user in the same week,
// so a rotating video changes for everyone together, not per-device.
export function weekIndex(): number {
  const monday = new Date(mondayOfThisWeek());
  const epoch = new Date('2026-01-05'); // an arbitrary fixed Monday reference point
  const days = Math.round((monday.getTime() - epoch.getTime()) / 86400000);
  return Math.floor(days / 7);
}
