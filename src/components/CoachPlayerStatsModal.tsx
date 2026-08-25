import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import StreakCalendar from './StreakCalendar';
import BadgeLegend from './BadgeLegend';
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
import { mondayOfThisWeek } from '../lib/date';
import { getActiveSeason, Season } from '../lib/seasons';
import { Badge, filterCurrentBadges, listBadges } from '../lib/badges';

// How much calendar history to render. For the coach/teammate paths (no
// hasParentTier passed), what shows up in `history` is already gated
// server-side by completions_coach_read/completions_teammate_read RLS, so
// a fixed full-width calendar is correct there — this component just
// renders whatever it's handed. For the self-view path (hasParentTier
// passed), the calendar needs the SAME free/paid split ProgressScreen
// already applies (CALENDAR_WEEKS_FULL/FREE there) — real gap found and
// fixed 2026-08-25: this constant was hardcoded to the full width
// regardless of tier, so a free-tier account viewing their own profile
// through the new self-view door would've seen 12 weeks of calendar
// instead of the 1 week Progress caps them to for the same data.
const CALENDAR_WEEKS_FULL = 12;
const CALENDAR_WEEKS_FREE = 1;

type Props = {
  playerId: string;
  playerName: string;
  onClose: () => void;
  // Only pass this when opening the modal for the account's OWN player
  // (the "tap your name on Home" path, added 2026-08-25) — it gates
  // history/shooting/reps the same way ProgressScreen already does for a
  // free-tier account. Omit it (leave undefined) for the existing coach
  // and teammate call sites: those were never about the OWNER's own
  // subscription tier, and completions_coach_read/completions_teammate_read
  // RLS already governs how much comes back for them. Real gap caught
  // before shipping the self-view feature: this modal had no client-side
  // tier gate at all, because it was only ever reached through paths RLS
  // already restricted server-side — wiring it up for self-view without
  // this prop would have let a free-tier account see their own full
  // history here, bypassing the $4.99/mo paywall ProgressScreen enforces
  // for the exact same data.
  hasParentTier?: boolean;
};

// Coach-facing counterpart to ProgressScreen's per-player card — same
// shared computation helpers (lib/players.ts), same visual shape, but
// reached from My Team instead of Progress. completions_coach_read /
// completions_teammate_read RLS governs how much comes back for those two
// paths; the optional hasParentTier prop above only matters for the third,
// newer self-view path (see its comment).
export default function CoachPlayerStatsModal({ playerId, playerName, onClose, hasParentTier }: Props) {
  const navigation = useNavigation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<CompletionHistoryEntry[]>([]);
  const [allDates, setAllDates] = useState<string[]>([]);
  const [activeSeason, setActiveSeason] = useState<Season | null>(null);
  const [streakDates, setStreakDates] = useState<string[]>([]);
  const [notes, setNotes] = useState<PlayerNote[]>([]);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [breakdown, setBreakdown] = useState<{ title: string; entries: ShootingBreakdownEntry[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, n, season, b] = await Promise.all([
        getCompletionHistory(playerId),
        getPlayerNotes(playerId),
        getActiveSeason(playerId),
        listBadges(playerId),
      ]);
      setHistory(h);
      setAllDates(h.map((entry) => entry.date));
      setNotes(n);
      setActiveSeason(season);
      setBadges(b);
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
  // Only the self-view path (hasParentTier explicitly false) slices — the
  // coach/teammate paths pass nothing and see whatever RLS already sends.
  const weekStart = mondayOfThisWeek();
  const visibleHistory = hasParentTier === false ? history.filter((h) => h.date >= weekStart) : history;
  const hasMoreHistory = hasParentTier === false && history.length > visibleHistory.length;
  const freeThrows: ShootingComposite | null = computeMakesAttemptsTotal(visibleHistory, isFreeThrowDrill);
  const shooting: ShootingComposite | null = computeMakesAttemptsTotal(
    visibleHistory,
    (name) => !isFreeThrowDrill(name)
  );
  const repTallies: RepTally[] = computeRepTallies(visibleHistory);
  const currentSeasonBadges = filterCurrentBadges(badges, activeSeason);

  const openBreakdown = (title: string, matches: (drillName: string) => boolean) => {
    setBreakdown({ title, entries: computeShootingBreakdown(visibleHistory, matches) });
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

              <StreakCalendar
                completedDates={allDates}
                weeks={hasParentTier === false ? CALENDAR_WEEKS_FREE : CALENDAR_WEEKS_FULL}
              />

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

              {badges.length > 0 ? (
                <View style={styles.badgesSection}>
                  <Text style={styles.repTalliesLabel}>Badges</Text>
                  <BadgeLegend currentSeasonBadges={currentSeasonBadges} allBadges={badges} />
                </View>
              ) : null}

              <Text style={styles.historyLabel}>History</Text>
              {visibleHistory.length === 0 ? (
                <Text style={styles.placeholder}>Nothing logged yet.</Text>
              ) : (
                visibleHistory.map((entry) => (
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

              {hasMoreHistory ? (
                <Pressable
                  style={styles.upsellCard}
                  onPress={() => {
                    onClose();
                    navigation.navigate('Account' as never);
                  }}
                >
                  <Text style={styles.upsellTitle}>See {playerName}'s full history</Text>
                  <Text style={styles.upsellBody}>
                    Free shows this week only. Parent membership ($4.99/mo) unlocks everything
                    they've ever logged, for every linked player.
                  </Text>
                  <Text style={styles.upsellLink}>Upgrade in Account →</Text>
                </Pressable>
              ) : null}
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
  badgesSection: { gap: 8 },
  upsellCard: {
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 12,
    padding: 14,
    backgroundColor: '#FFF8EA',
    gap: 4,
  },
  upsellTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  upsellBody: { fontSize: 13, color: colors.textMuted, lineHeight: 18 },
  upsellLink: { fontSize: 13, fontWeight: '700', color: colors.primary, marginTop: 2 },
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
