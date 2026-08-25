import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import StreakCalendar from './StreakCalendar';
import {
  calculateStreak,
  CompletionHistoryEntry,
  computeMakesAttemptsTotal,
  computeRepTallies,
  computeShootingBreakdown,
  getCompletionDates,
  getCompletionHistory,
  getPlayerNotes,
  isFreeThrowDrill,
  PlayerNote,
  RepTally,
  ShootingBreakdownEntry,
  ShootingComposite,
} from '../lib/players';
import { getActiveSeason, Season } from '../lib/seasons';

// How much calendar history to render — matches ProgressScreen's
// parent-tier view. What actually shows up in `history` is already gated
// server-side by the completions_coach_read RLS policy (current week only,
// unless this coach has a real multi-family roster or doesn't own/guard
// this player) — this component just renders whatever it's handed, same
// as ProgressScreen does for its own tier gating.
const CALENDAR_WEEKS = 12;

type Props = {
  playerId: string;
  playerName: string;
  onClose: () => void;
};

// Coach-facing counterpart to ProgressScreen's per-player card — same
// shared computation helpers (lib/players.ts), same visual shape, but
// reached from My Team instead of Progress, and with no client-side
// parent_tier check: how much history actually comes back is entirely
// up to the completions_coach_read RLS policy on the server.
export default function CoachPlayerStatsModal({ playerId, playerName, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<CompletionHistoryEntry[]>([]);
  const [allDates, setAllDates] = useState<string[]>([]);
  const [activeSeason, setActiveSeason] = useState<Season | null>(null);
  const [streakDates, setStreakDates] = useState<string[]>([]);
  const [notes, setNotes] = useState<PlayerNote[]>([]);
  const [breakdown, setBreakdown] = useState<{ title: string; entries: ShootingBreakdownEntry[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, n, season] = await Promise.all([
        getCompletionHistory(playerId),
        getPlayerNotes(playerId),
        getActiveSeason(playerId),
      ]);
      setHistory(h);
      setAllDates(h.map((entry) => entry.date));
      setNotes(n);
      setActiveSeason(season);
      // "Current streak" scopes to the active season once one exists
      // (same reasoning as Home/Progress — a fresh-start feel at a season
      // boundary, without touching a row of the underlying history), but
      // the calendar/shooting/rep totals above stay all-time on purpose —
      // this is the one place both the season-scoped number AND the
      // career totals are visible together.
      setStreakDates(season ? await getCompletionDates(playerId, season.id) : h.map((entry) => entry.date));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load stats.');
    } finally {
      setLoading(false);
    }
  }, [playerId]);

  useEffect(() => {
    load();
  }, [load]);

  const streak = calculateStreak(streakDates);
  const freeThrows: ShootingComposite | null = computeMakesAttemptsTotal(history, isFreeThrowDrill);
  const shooting: ShootingComposite | null = computeMakesAttemptsTotal(history, (name) => !isFreeThrowDrill(name));
  const repTallies: RepTally[] = computeRepTallies(history);

  const openBreakdown = (title: string, matches: (drillName: string) => boolean) => {
    setBreakdown({ title, entries: computeShootingBreakdown(history, matches) });
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>{playerName}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={styles.closeLink}>Close</Text>
            </Pressable>
          </View>

          {loading ? (
            <ActivityIndicator color={colors.primary} style={styles.spinner} />
          ) : error ? (
            <Text style={styles.error}>{error}</Text>
          ) : (
            <ScrollView contentContainerStyle={styles.scrollContent}>
              <View style={styles.streakCard}>
                <Text style={styles.cardLabel}>
                  Current streak{activeSeason ? ` · ${activeSeason.label}` : ''}
                </Text>
                <Text style={styles.cardValue}>
                  {streak} {streak === 1 ? 'day' : 'days'}
                </Text>
              </View>

              {freeThrows ? (
                <Pressable
                  style={styles.shootingCard}
                  onPress={() => openBreakdown(`${playerName} — Free Throws`, isFreeThrowDrill)}
                >
                  <Text style={styles.cardLabel}>Free Throws · tap for detail</Text>
                  <View style={styles.shootingRow}>
                    <Text style={styles.cardValue}>
                      {freeThrows.makes}/{freeThrows.attempts}
                    </Text>
                    <Text style={styles.shootingPercent}>
                      {Math.round((freeThrows.makes / freeThrows.attempts) * 100)}%
                    </Text>
                  </View>
                </Pressable>
              ) : null}

              {shooting ? (
                <Pressable
                  style={styles.shootingCard}
                  onPress={() => openBreakdown(`${playerName} — Shooting`, (name) => !isFreeThrowDrill(name))}
                >
                  <Text style={styles.cardLabel}>Shooting · tap for detail</Text>
                  <View style={styles.shootingRow}>
                    <Text style={styles.cardValue}>
                      {shooting.makes}/{shooting.attempts}
                    </Text>
                    <Text style={styles.shootingPercent}>
                      {Math.round((shooting.makes / shooting.attempts) * 100)}%
                    </Text>
                  </View>
                </Pressable>
              ) : null}

              {repTallies.length > 0 ? (
                <View style={styles.repTalliesCard}>
                  <Text style={styles.repTalliesLabel}>Total reps</Text>
                  {repTallies.map((t) => (
                    <View key={t.drillName} style={styles.repTallyRow}>
                      <Text style={styles.repTallyName}>{t.drillName}</Text>
                      <Text style={styles.repTallyValue}>{t.totalAttempts}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              <StreakCalendar completedDates={allDates} weeks={CALENDAR_WEEKS} />

              {notes.length > 0 ? (
                <View style={styles.notesSection}>
                  {notes.map((n) => (
                    <View key={n.updatedAt} style={styles.noteCard}>
                      <Text style={styles.noteLabel}>Coach's note</Text>
                      <Text style={styles.noteText}>{n.note}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              <Text style={styles.historyLabel}>History</Text>
              {history.length === 0 ? (
                <Text style={styles.placeholder}>Nothing logged yet.</Text>
              ) : (
                history.map((entry) => (
                  <View key={entry.date} style={styles.historyRow}>
                    <Text style={styles.historyDate}>{entry.date}</Text>
                    <Text style={styles.historyDrills}>
                      {entry.drills
                        .map((d) => {
                          const result =
                            d.makes != null && d.attempts != null
                              ? `${d.makes}/${d.attempts}`
                              : d.attempts != null
                                ? `${d.attempts} reps`
                                : null;
                          return result ? `${d.name} (${result})` : d.name;
                        })
                        .join(', ')}
                    </Text>
                  </View>
                ))
              )}
            </ScrollView>
          )}

          <Modal
            visible={breakdown != null}
            transparent
            animationType="fade"
            onRequestClose={() => setBreakdown(null)}
          >
            <View style={styles.overlay}>
              <View style={styles.card}>
                <Text style={styles.title}>{breakdown?.title}</Text>
                <ScrollView style={styles.breakdownList}>
                  {breakdown?.entries.length === 0 ? (
                    <Text style={styles.placeholder}>Nothing logged yet.</Text>
                  ) : (
                    breakdown?.entries.map((e, i) => (
                      <View key={`${e.date}-${e.drillName}-${i}`} style={styles.breakdownRow}>
                        <View style={styles.breakdownRowText}>
                          <Text style={styles.historyDate}>{e.date}</Text>
                          <Text style={styles.historyDrills}>{e.drillName}</Text>
                        </View>
                        <Text style={styles.shootingPercent}>
                          {e.makes}/{e.attempts}
                        </Text>
                      </View>
                    ))
                  )}
                </ScrollView>
                <Pressable style={styles.closeButton} onPress={() => setBreakdown(null)}>
                  <Text style={styles.closeButtonText}>Close</Text>
                </Pressable>
              </View>
            </View>
          </Modal>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    maxHeight: '85%',
    gap: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  closeLink: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  spinner: { marginVertical: 20 },
  error: { color: '#C4362B', fontSize: 13 },
  scrollContent: { gap: 12, paddingBottom: 4 },
  placeholder: { fontSize: 14, color: colors.textMuted, lineHeight: 20 },
  streakCard: { backgroundColor: colors.primary, borderRadius: 16, padding: 20 },
  shootingCard: { backgroundColor: colors.primaryDark, borderRadius: 16, padding: 20 },
  shootingRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 4 },
  shootingPercent: { color: colors.accent, fontSize: 20, fontWeight: '700' },
  cardLabel: { color: '#FFFFFF', fontSize: 14, opacity: 0.9 },
  cardValue: { color: colors.accent, fontSize: 32, fontWeight: '700', marginTop: 4 },
  repTalliesCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    backgroundColor: colors.surface,
    gap: 6,
  },
  repTalliesLabel: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  repTallyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  repTallyName: { fontSize: 14, color: colors.text, flex: 1, marginRight: 12 },
  repTallyValue: { fontSize: 14, fontWeight: '700', color: colors.primary },
  notesSection: { gap: 8 },
  noteCard: {
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 12,
    padding: 14,
    backgroundColor: '#FFF8EA',
    gap: 2,
  },
  noteLabel: { fontSize: 12, fontWeight: '700', color: colors.accentDark },
  noteText: { fontSize: 14, color: colors.text, lineHeight: 20, marginTop: 2 },
  historyLabel: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginTop: 4 },
  historyRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.background,
  },
  historyDate: { fontSize: 13, fontWeight: '700', color: colors.text },
  historyDrills: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  breakdownList: { maxHeight: 400 },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.background,
    marginBottom: 8,
  },
  breakdownRowText: { flex: 1, marginRight: 12 },
  closeButton: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  closeButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
});
