export function mondayOfThisWeek(): string {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday, 1 = Monday, ...
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}

export function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
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
