import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { useParentEntitlement } from '../lib/purchases';
import { getInstitutionalAccessByPlayer } from '../lib/institutionalAccess';
import StreakCalendar from '../components/StreakCalendar';
import {
  calculateStreak,
  CompletionHistoryEntry,
  computeMakesAttemptsTotal,
  computeRepTallies,
  computeShootingBreakdown,
  formatPlayerBio,
  getCompletionDates,
  getCompletionHistory,
  getPlayerNotes,
  isFreeThrowDrill,
  listMyPlayers,
  Player,
  PlayerNote,
  RepTally,
  ShootingBreakdownEntry,
  ShootingComposite,
} from '../lib/players';
import { mondayOfThisWeek } from '../lib/date';
import { deleteSeason, getActiveSeason, listSeasonHistory, renameSeason, Season, SeasonSummary, summarizeSeason } from '../lib/seasons';
import { BADGE_ICONS, BADGE_LABELS } from '../lib/badges';

// How many weeks of the visual calendar a Parent-membership viewer sees.
// Free tier sees 1 (this week only, same bound as the list view below) —
// the calendar is a rendering of the same paywalled history, not a new
// data path around it.
const CALENDAR_WEEKS_FULL = 12;
const CALENDAR_WEEKS_FREE = 1;

type PlayerProgress = {
  player: Player;
  streak: number;
  activeSeason: Season | null;
  visibleHistory: CompletionHistoryEntry[];
  hasMoreHistory: boolean;
  // Combines the account's RevenueCat parent_tier with this specific
  // player's institutional (Team/Program) access — see
  // src/lib/institutionalAccess.ts. A real family could have one kid
  // covered by a paid team and another kid not, so this is per-player,
  // not the outer hasParentTier hook value.
  hasFullAccess: boolean;
  allDates: string[];
  notes: PlayerNote[];
  freeThrows: ShootingComposite | null;
  shooting: ShootingComposite | null;
  repTallies: RepTally[];
  pastSeasons: Season[];
};

export default function ProgressScreen() {
  const navigation = useNavigation();
  const { hasParentTier, loading: entitlementLoading } = useParentEntitlement();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [progress, setProgress] = useState<PlayerProgress[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<{ title: string; entries: ShootingBreakdownEntry[] } | null>(null);
  const [seasonDetail, setSeasonDetail] = useState<{ season: Season; summary: SeasonSummary } | null>(null);
  const [loadingSeasonDetail, setLoadingSeasonDetail] = useState<string | null>(null);
  const [seasonRenameText, setSeasonRenameText] = useState('');
  const [savingSeasonRename, setSavingSeasonRename] = useState(false);
  const [deletingSeason, setDeletingSeason] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const players = await listMyPlayers();
      const weekStart = mondayOfThisWeek();
      const institutionalAccessByPlayer = await getInstitutionalAccessByPlayer(
        players.map((p) => p.id)
      );
      const data = await Promise.all(
        players.map(async (player) => {
          const [history, notes, pastSeasons, activeSeason] = await Promise.all([
            getCompletionHistory(player.id),
            getPlayerNotes(player.id),
            listSeasonHistory(player.id),
            getActiveSeason(player.id),
          ]);
          const dates = history.map((h) => h.date);
          // Current streak scopes to the active season, same as Home and
          // the coach stats modal — calendar/shooting/rep totals below
          // stay all-time on purpose (the career numbers Horizon 2's
          // recruiting-layer commitment depends on), this is the one
          // number that resets at a season boundary.
          const streakDates = activeSeason ? await getCompletionDates(player.id, activeSeason.id) : dates;
          const hasFullAccess = hasParentTier || institutionalAccessByPlayer[player.id] === true;
          const visibleHistory = hasFullAccess ? history : history.filter((h) => h.date >= weekStart);
          return {
            player,
            streak: calculateStreak(streakDates),
            activeSeason,
            visibleHistory,
            hasFullAccess,
            hasMoreHistory: !hasFullAccess && history.length > visibleHistory.length,
            allDates: dates,
            notes,
            freeThrows: computeMakesAttemptsTotal(visibleHistory, isFreeThrowDrill),
            shooting: computeMakesAttemptsTotal(visibleHistory, (name) => !isFreeThrowDrill(name)),
            repTallies: computeRepTallies(visibleHistory),
            pastSeasons,
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

  const openBreakdown = (
    title: string,
    history: CompletionHistoryEntry[],
    matches: (drillName: string) => boolean
  ) => {
    setBreakdown({ title, entries: computeShootingBreakdown(history, matches) });
  };

  const openSeasonDetail = async (playerId: string, season: Season) => {
    setLoadingSeasonDetail(season.id);
    try {
      const summary = await summarizeSeason(playerId, season.id);
      setSeasonDetail({ season, summary });
      setSeasonRenameText(season.label);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load season detail.');
    } finally {
      setLoadingSeasonDetail(null);
    }
  };

  // Real gap Jay caught: a past season's auto-generated label had no way
  // to change afterward either, not just the active one. Renaming here
  // (from the same detail view someone already opened to look at that
  // season) updates the row list too, not just this modal's own title.
  const handleSaveSeasonDetailRename = async () => {
    if (!seasonDetail || !seasonRenameText.trim()) return;
    setSavingSeasonRename(true);
    try {
      await renameSeason(seasonDetail.season.id, seasonRenameText.trim());
      const renamed = { ...seasonDetail.season, label: seasonRenameText.trim() };
      setSeasonDetail({ ...seasonDetail, season: renamed });
      setProgress((current) =>
        current.map((p) => ({
          ...p,
          pastSeasons: p.pastSeasons.map((s) => (s.id === renamed.id ? renamed : s)),
        }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename season.');
    } finally {
      setSavingSeasonRename(false);
    }
  };

  // Deletes only the season row/grouping — deleteSeason (lib/seasons.ts)
  // relies on completions.season_id's on-delete-set-null, so nothing a
  // player logged during this season is actually lost, it just falls back
  // into their all-time totals same as pre-Phase-3 history. Copy below says
  // exactly that, deliberately — the same "reassure, don't sound like a
  // delete-your-data warning" rule already used on the switch-season
  // confirmations. Gated to closed seasons only (deleteSeason itself
  // enforces this server-side too) — the active season is only ever
  // removed by switching, not by this button.
  const handleDeleteSeason = () => {
    if (!seasonDetail) return;
    const { season } = seasonDetail;
    Alert.alert(
      `Delete "${season.label}"?`,
      "This removes the season grouping only — any drills logged during it stay saved and still count toward the all-time totals, they just won't be grouped under this season name anymore. This can't be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Season',
          style: 'destructive',
          onPress: async () => {
            setDeletingSeason(true);
            try {
              await deleteSeason(season.id);
              setProgress((current) =>
                current.map((p) => ({
                  ...p,
                  pastSeasons: p.pastSeasons.filter((s) => s.id !== season.id),
                }))
              );
              setSeasonDetail(null);
            } catch (e) {
              Alert.alert('Could not delete season', e instanceof Error ? e.message : 'Something went wrong.');
            } finally {
              setDeletingSeason(false);
            }
          },
        },
      ]
    );
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
        progress.map(({ player, streak, activeSeason, visibleHistory, hasMoreHistory, hasFullAccess, allDates, notes, freeThrows, shooting, repTallies, pastSeasons }) => (
          <View key={player.id} style={styles.playerSection}>
            <Text style={styles.playerName}>{player.display_name}</Text>
            {formatPlayerBio(player) ? (
              <Text style={styles.playerBio}>{formatPlayerBio(player)}</Text>
            ) : null}
            <View style={styles.streakCard}>
              <Text style={styles.streakLabel}>
                Current streak{activeSeason ? ` · ${activeSeason.label}` : ''}
              </Text>
              <Text style={styles.streakValue}>
                {streak} {streak === 1 ? 'day' : 'days'}
              </Text>
            </View>

            {freeThrows ? (
              <Pressable
                style={styles.shootingCard}
                onPress={() => openBreakdown(`${player.display_name} — Free Throws`, visibleHistory, isFreeThrowDrill)}
              >
                <Text style={styles.streakLabel}>
                  Free Throws {hasFullAccess ? '(all-time)' : '(this week)'} · tap for detail
                </Text>
                <View style={styles.shootingRow}>
                  <Text style={styles.streakValue}>
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
                onPress={() =>
                  openBreakdown(`${player.display_name} — Shooting`, visibleHistory, (name) => !isFreeThrowDrill(name))
                }
              >
                <Text style={styles.streakLabel}>
                  Shooting {hasFullAccess ? '(all-time)' : '(this week)'} · tap for detail
                </Text>
                <View style={styles.shootingRow}>
                  <Text style={styles.streakValue}>
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
                <Text style={styles.repTalliesLabel}>
                  Total reps {hasFullAccess ? '(all-time)' : '(this week)'}
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
              weeks={hasFullAccess ? CALENDAR_WEEKS_FULL : CALENDAR_WEEKS_FREE}
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

            {pastSeasons.length > 0 ? (
              <View style={styles.seasonHistorySection}>
                <Text style={styles.historyLabel}>Season History</Text>
                {pastSeasons.map((s) => (
                  <Pressable
                    key={s.id}
                    style={styles.seasonRow}
                    onPress={() => openSeasonDetail(player.id, s)}
                    disabled={loadingSeasonDetail === s.id}
                  >
                    <Text style={styles.seasonRowLabel}>{s.label}</Text>
                    {loadingSeasonDetail === s.id ? (
                      <ActivityIndicator color={colors.primary} size="small" />
                    ) : (
                      <Text style={styles.seasonRowLink}>View →</Text>
                    )}
                  </Pressable>
                ))}
              </View>
            ) : null}

            <Text style={styles.historyLabel}>
              {hasFullAccess ? 'Full history' : 'This week'}
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

      <Modal
        visible={breakdown != null}
        transparent
        animationType="fade"
        onRequestClose={() => setBreakdown(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{breakdown?.title}</Text>
            <ScrollView style={styles.breakdownList}>
              {breakdown?.entries.length === 0 ? (
                <Text style={styles.placeholder}>Nothing logged yet.</Text>
              ) : (
                breakdown?.entries.map((e, i) => (
                  <View key={`${e.date}-${e.drillName}-${i}`} style={styles.breakdownRow}>
                    <View style={styles.breakdownRowText}>
                      <Text style={styles.breakdownDate}>{e.date}</Text>
                      <Text style={styles.breakdownDrill}>{e.drillName}</Text>
                    </View>
                    <Text style={styles.breakdownResult}>
                      {e.makes}/{e.attempts}
                    </Text>
                  </View>
                ))
              )}
            </ScrollView>
            <Pressable style={styles.smallButton} onPress={() => setBreakdown(null)}>
              <Text style={styles.smallButtonText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={seasonDetail != null}
        transparent
        animationType="fade"
        onRequestClose={() => setSeasonDetail(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.editButtonRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={seasonRenameText}
                onChangeText={setSeasonRenameText}
                placeholder="Season name"
                placeholderTextColor={colors.textMuted}
              />
              <Pressable
                style={[styles.smallButton, (!seasonRenameText.trim() || savingSeasonRename) && styles.buttonDisabled]}
                onPress={handleSaveSeasonDetailRename}
                disabled={!seasonRenameText.trim() || savingSeasonRename}
              >
                {savingSeasonRename ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.smallButtonText}>Rename</Text>
                )}
              </Pressable>
            </View>
            {seasonDetail ? (
              <View style={{ gap: 10 }}>
                <View style={styles.streakCard}>
                  <Text style={styles.streakLabel}>Best streak that season</Text>
                  <Text style={styles.streakValue}>
                    {seasonDetail.summary.bestStreak} {seasonDetail.summary.bestStreak === 1 ? 'day' : 'days'}
                  </Text>
                </View>
                {seasonDetail.summary.freeThrows ? (
                  <View style={styles.shootingCard}>
                    <Text style={styles.streakLabel}>Free Throws</Text>
                    <View style={styles.shootingRow}>
                      <Text style={styles.streakValue}>
                        {seasonDetail.summary.freeThrows.makes}/{seasonDetail.summary.freeThrows.attempts}
                      </Text>
                      <Text style={styles.shootingPercent}>
                        {Math.round(
                          (seasonDetail.summary.freeThrows.makes / seasonDetail.summary.freeThrows.attempts) * 100
                        )}
                        %
                      </Text>
                    </View>
                  </View>
                ) : null}
                {seasonDetail.summary.shooting ? (
                  <View style={styles.shootingCard}>
                    <Text style={styles.streakLabel}>Shooting</Text>
                    <View style={styles.shootingRow}>
                      <Text style={styles.streakValue}>
                        {seasonDetail.summary.shooting.makes}/{seasonDetail.summary.shooting.attempts}
                      </Text>
                      <Text style={styles.shootingPercent}>
                        {Math.round((seasonDetail.summary.shooting.makes / seasonDetail.summary.shooting.attempts) * 100)}%
                      </Text>
                    </View>
                  </View>
                ) : null}
                <Text style={styles.placeholder}>Total reps logged: {seasonDetail.summary.totalReps}</Text>
                {seasonDetail.summary.badges.length > 0 ? (
                  <View style={styles.seasonBadgesSection}>
                    <Text style={styles.repTalliesLabel}>Badges earned this season</Text>
                    <View style={styles.seasonBadgeRow}>
                      {seasonDetail.summary.badges.map((b) => (
                        <View key={b.id} style={styles.seasonBadgeChip}>
                          <Text style={styles.seasonBadgeChipText}>
                            {BADGE_ICONS[b.type]} {BADGE_LABELS[b.type]}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ) : null}
              </View>
            ) : null}
            <Pressable style={styles.smallButton} onPress={() => setSeasonDetail(null)}>
              <Text style={styles.smallButtonText}>Close</Text>
            </Pressable>
            <Pressable
              style={[styles.smallButton, styles.deleteSeasonButton, deletingSeason && styles.buttonDisabled]}
              onPress={handleDeleteSeason}
              disabled={deletingSeason}
            >
              {deletingSeason ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.smallButtonText}>Delete Season</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
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
  seasonHistorySection: { gap: 6 },
  seasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.surface,
  },
  seasonRowLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
  seasonRowLink: { fontSize: 13, fontWeight: '600', color: colors.accentDark },
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    gap: 12,
    maxHeight: '80%',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
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
  breakdownDate: { fontSize: 13, fontWeight: '700', color: colors.text },
  breakdownDrill: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  breakdownResult: { fontSize: 15, fontWeight: '700', color: colors.primary },
  smallButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  smallButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  buttonDisabled: { opacity: 0.6 },
  deleteSeasonButton: { backgroundColor: '#C4362B', marginTop: 8 },
  seasonBadgesSection: { gap: 6 },
  seasonBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  seasonBadgeChip: {
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#FFF8EA',
  },
  seasonBadgeChipText: { fontSize: 13, fontWeight: '600', color: colors.text },
  editButtonRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.background,
  },
});
