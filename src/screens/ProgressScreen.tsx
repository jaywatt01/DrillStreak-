import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { useParentEntitlement } from '../lib/purchases';
import StreakCalendar from '../components/StreakCalendar';
import {
  calculateStreak,
  CompletionHistoryEntry,
  getCompletionHistory,
  getPlayerNotes,
  listMyPlayers,
  Player,
  PlayerNote,
} from '../lib/players';
import { mondayOfThisWeek } from '../lib/date';

// Joins whichever bio fields are actually set into one line — e.g.
// "Point Guard · 6'2" · 165 lbs · Class of 2027". Skips anything blank
// rather than showing an empty placeholder, and returns null (render
// nothing) if none of the four fields are filled in yet.
function formatPlayerBio(player: Player): string | null {
  const parts = [
    player.position,
    player.height,
    player.weight,
    player.grad_year != null ? `Class of ${player.grad_year}` : null,
  ].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(' · ') : null;
}

type ShootingComposite = { makes: number; attempts: number };

// Free throws are a distinct, recognized stat on their own (FT%), separate
// from field-shooting drills like spot-up or form shooting — split out by
// name match rather than a structured drill-type field, since drills don't
// have one (category is free text). Substring match so a custom drill
// named e.g. "FT line reps" or "Free Throw Practice" still counts.
function isFreeThrowDrill(drillName: string): boolean {
  return drillName.toLowerCase().includes('free throw');
}

// Sums every logged completion that has BOTH makes and attempts set — that
// pair is what marks an entry as shooting-type data (a rep-only drill like
// suicides or jump rope logs attempts alone, with makes left null, so it's
// excluded here — it gets its own tally instead, via computeRepTallies
// below, since there's no "make" for a sprint or a jump-rope rep and a
// percentage wouldn't mean anything for it). `matches` further splits
// shooting drills into two buckets (free throws vs. everything else) so
// the two composites below don't double-count the same completion.
// Computed from whatever history the viewer is currently allowed to see
// (visibleHistory, already tier-gated), not the unrestricted full history
// — same paywall boundary as everything else on this screen, not a back
// door around it. Returns null (render nothing) if that bucket has no
// data yet.
function computeMakesAttemptsTotal(
  history: CompletionHistoryEntry[],
  matches: (drillName: string) => boolean
): ShootingComposite | null {
  let makes = 0;
  let attempts = 0;
  for (const entry of history) {
    for (const drill of entry.drills) {
      if (drill.makes != null && drill.attempts != null && matches(drill.name)) {
        makes += drill.makes;
        attempts += drill.attempts;
      }
    }
  }
  return attempts > 0 ? { makes, attempts } : null;
}

type RepTally = { drillName: string; totalAttempts: number };

// The counterpart to computeShootingComposite above: totals attempts for
// every drill logged WITHOUT a makes value — jump rope reps, suicides,
// sprints, anything that's a rep count rather than a makes/attempts pair.
// Grouped and summed per drill name, most-logged drill first. A drill
// with a mix of makes/attempts entries AND attempts-only entries (unusual,
// but not prevented at the data layer) only contributes its attempts-only
// entries here — the makes/attempts ones are already counted in the
// shooting composite, and double-counting either way would overstate one
// of the two numbers.
function computeRepTallies(history: CompletionHistoryEntry[]): RepTally[] {
  const totals = new Map<string, number>();
  for (const entry of history) {
    for (const drill of entry.drills) {
      if (drill.attempts != null && drill.makes == null) {
        totals.set(drill.name, (totals.get(drill.name) ?? 0) + drill.attempts);
      }
    }
  }
  return Array.from(totals.entries())
    .map(([drillName, totalAttempts]) => ({ drillName, totalAttempts }))
    .sort((a, b) => b.totalAttempts - a.totalAttempts);
}

// How many weeks of the visual calendar a Parent-membership viewer sees.
// Free tier sees 1 (this week only, same bound as the list view below) —
// the calendar is a rendering of the same paywalled history, not a new
// data path around it.
const CALENDAR_WEEKS_FULL = 12;
const CALENDAR_WEEKS_FREE = 1;

type PlayerProgress = {
  player: Player;
  streak: number;
  visibleHistory: CompletionHistoryEntry[];
  hasMoreHistory: boolean;
  allDates: string[];
  notes: PlayerNote[];
  freeThrows: ShootingComposite | null;
  shooting: ShootingComposite | null;
  repTallies: RepTally[];
};

export default function ProgressScreen() {
  const navigation = useNavigation();
  const { hasParentTier, loading: entitlementLoading } = useParentEntitlement();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [progress, setProgress] = useState<PlayerProgress[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const players = await listMyPlayers();
      const weekStart = mondayOfThisWeek();
      const data = await Promise.all(
        players.map(async (player) => {
          const [history, notes] = await Promise.all([
            getCompletionHistory(player.id),
            getPlayerNotes(player.id),
          ]);
          const dates = history.map((h) => h.date);
          const visibleHistory = hasParentTier ? history : history.filter((h) => h.date >= weekStart);
          return {
            player,
            streak: calculateStreak(dates),
            visibleHistory,
            hasMoreHistory: !hasParentTier && history.length > visibleHistory.length,
            allDates: dates,
            notes,
            freeThrows: computeMakesAttemptsTotal(visibleHistory, isFreeThrowDrill),
            shooting: computeMakesAttemptsTotal(visibleHistory, (name) => !isFreeThrowDrill(name)),
            repTallies: computeRepTallies(visibleHistory),
          };
        })
      );
      setProgress(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load progress.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [hasParentTier]);

  useFocusEffect(
    useCallback(() => {
      if (!entitlementLoading) load();
    }, [load, entitlementLoading])
  );

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  if (loading || entitlementLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.sectionTitle}>Progress</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {progress.length === 0 ? (
        <Text style={styles.placeholder}>No players yet — add one from the Add a Player tab.</Text>
      ) : (
        progress.map(({ player, streak, visibleHistory, hasMoreHistory, allDates, notes, freeThrows, shooting, repTallies }) => (
          <View key={player.id} style={styles.playerSection}>
            <Text style={styles.playerName}>{player.display_name}</Text>
            {formatPlayerBio(player) ? (
              <Text style={styles.playerBio}>{formatPlayerBio(player)}</Text>
            ) : null}
            <View style={styles.streakCard}>
              <Text style={styles.streakLabel}>Current streak</Text>
              <Text style={styles.streakValue}>
                {streak} {streak === 1 ? 'day' : 'days'}
              </Text>
            </View>

            {freeThrows ? (
              <View style={styles.shootingCard}>
                <Text style={styles.streakLabel}>
                  Free Throws {hasParentTier ? '(all-time)' : '(this week)'}
                </Text>
                <View style={styles.shootingRow}>
                  <Text style={styles.streakValue}>
                    {freeThrows.makes}/{freeThrows.attempts}
                  </Text>
                  <Text style={styles.shootingPercent}>
                    {Math.round((freeThrows.makes / freeThrows.attempts) * 100)}%
                  </Text>
                </View>
              </View>
            ) : null}

            {shooting ? (
              <View style={styles.shootingCard}>
                <Text style={styles.streakLabel}>
                  Shooting {hasParentTier ? '(all-time)' : '(this week)'}
                </Text>
                <View style={styles.shootingRow}>
                  <Text style={styles.streakValue}>
                    {shooting.makes}/{shooting.attempts}
                  </Text>
                  <Text style={styles.shootingPercent}>
                    {Math.round((shooting.makes / shooting.attempts) * 100)}%
                  </Text>
                </View>
              </View>
            ) : null}

            {repTallies.length > 0 ? (
              <View style={styles.repTalliesCard}>
                <Text style={styles.repTalliesLabel}>
                  Total reps {hasParentTier ? '(all-time)' : '(this week)'}
                </Text>
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
              weeks={hasParentTier ? CALENDAR_WEEKS_FULL : CALENDAR_WEEKS_FREE}
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

            <Text style={styles.historyLabel}>
              {hasParentTier ? 'Full history' : 'This week'}
            </Text>
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
                onPress={() => navigation.navigate('Account' as never)}
              >
                <Text style={styles.upsellTitle}>See {player.display_name}'s full history</Text>
                <Text style={styles.upsellBody}>
                  Free shows this week only. Parent membership ($4.99/mo) unlocks everything
                  they've ever logged, for every linked player.
                </Text>
                <Text style={styles.upsellLink}>Upgrade in Account →</Text>
              </Pressable>
            ) : null}
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 16 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  error: { color: '#C4362B', fontSize: 13 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: colors.text },
  placeholder: { fontSize: 14, color: colors.textMuted, lineHeight: 20 },
  playerSection: { gap: 8, marginBottom: 8 },
  playerName: { fontSize: 20, fontWeight: '700', color: colors.text },
  playerBio: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginTop: -4 },
  streakCard: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    padding: 20,
  },
  shootingCard: {
    backgroundColor: colors.primaryDark,
    borderRadius: 16,
    padding: 20,
  },
  shootingRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 4 },
  shootingPercent: { color: colors.accent, fontSize: 20, fontWeight: '700' },
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
  streakLabel: { color: '#FFFFFF', fontSize: 14, opacity: 0.9 },
  streakValue: { color: colors.accent, fontSize: 32, fontWeight: '700', marginTop: 4 },
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
    backgroundColor: colors.surface,
  },
  historyDate: { fontSize: 13, fontWeight: '700', color: colors.text },
  historyDrills: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
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
});
