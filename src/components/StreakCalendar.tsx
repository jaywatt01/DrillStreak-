import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

// Visual consistency record — reads in two seconds instead of a raw
// number, per the recruitment-layer plan in DRILLSTREAK.md (Horizon 2:
// "a visual consistency record, not just a number"). Weeks run left
// (oldest) to right (most recent, ending today), each column a week,
// each cell a day — same reading direction as a calendar, not GitHub's
// convention, so it matches how a parent/coach/recruiter already reads a
// week.

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const CELL_SIZE = 12;
const CELL_GAP = 3;

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type Cell = { date: string; done: boolean; isFuture: boolean };

type Props = {
  completedDates: string[]; // "YYYY-MM-DD", any order, duplicates fine
  weeks?: number; // how many weeks back to show, including the current week
};

export default function StreakCalendar({ completedDates, weeks = 12 }: Props) {
  const completed = new Set(completedDates);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const gridStart = startOfWeek(today);
  gridStart.setDate(gridStart.getDate() - (weeks - 1) * 7);

  const columns: Cell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: Cell[] = [];
    for (let d = 0; d < 7; d++) {
      const cellDate = new Date(gridStart);
      cellDate.setDate(cellDate.getDate() + w * 7 + d);
      const dateStr = toDateString(cellDate);
      col.push({ date: dateStr, done: completed.has(dateStr), isFuture: cellDate > today });
    }
    columns.push(col);
  }

  return (
    <View style={styles.wrapper}>
      <View style={styles.dayLabels}>
        {DAY_LABELS.map((label, i) => (
          <Text key={i} style={styles.dayLabel}>
            {label}
          </Text>
        ))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.grid}>
          {columns.map((col, w) => (
            <View key={w} style={styles.column}>
              {col.map((cell) => (
                <View
                  key={cell.date}
                  style={[
                    styles.cell,
                    cell.isFuture ? styles.cellFuture : cell.done ? styles.cellDone : styles.cellEmpty,
                  ]}
                />
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flexDirection: 'row' },
  dayLabels: { gap: CELL_GAP, marginRight: 6 },
  dayLabel: {
    fontSize: 9,
    color: colors.textMuted,
    height: CELL_SIZE,
    lineHeight: CELL_SIZE,
  },
  grid: { flexDirection: 'row', gap: CELL_GAP },
  column: { gap: CELL_GAP },
  cell: { width: CELL_SIZE, height: CELL_SIZE, borderRadius: 3 },
  cellEmpty: { backgroundColor: colors.border },
  cellDone: { backgroundColor: colors.success },
  cellFuture: { backgroundColor: 'transparent' },
});
