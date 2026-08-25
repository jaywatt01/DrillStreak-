import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { localDateString } from '../lib/date';

// Compact Mon-Sun row of dots — the roster-scale counterpart to
// StreakCalendar's full grid. One row per player is meant to fit next to
// their name in a list, so this only ever shows the current week, not
// months of history (that's what tapping through to the full stats modal
// is for). Same done/empty color language as StreakCalendar (colors.success
// / colors.border) so the two read as the same visual system, not two
// different conventions for the same idea.
const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DOT_SIZE = 16;

function mondayOf(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  return d;
}

type Props = {
  completedDates: string[]; // "YYYY-MM-DD", this week's completions only need to be passed in
};

export default function WeekDotsRow({ completedDates }: Props) {
  const completed = new Set(completedDates);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monday = mondayOf(today);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    const dateStr = localDateString(d);
    return { label: DAY_LABELS[i], done: completed.has(dateStr), isFuture: d > today };
  });

  return (
    <View style={styles.row}>
      {days.map((d, i) => (
        <View
          key={i}
          style={[styles.dot, d.isFuture ? styles.dotFuture : d.done ? styles.dotDone : styles.dotEmpty]}
        >
          <Text style={styles.dotLabel}>{d.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 4 },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotEmpty: { backgroundColor: colors.border },
  dotDone: { backgroundColor: colors.success },
  dotFuture: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  dotLabel: { fontSize: 8, fontWeight: '700', color: 'rgba(0,0,0,0.35)' },
});
