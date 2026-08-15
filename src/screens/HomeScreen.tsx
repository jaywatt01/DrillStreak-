import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import {
  calculateStreak,
  DEFAULT_DRILL_MINUTES,
  deleteCompletion,
  DrillResult,
  getCompletionDates,
  getTodayCompletions,
  getWeeklyDrills,
  listMyPlayers,
  logCompletion,
  logDrillResult,
  Player,
  WeeklyDrill,
} from '../lib/players';
import { addDrillToCalendar } from '../lib/calendar';
import { getPromptForResultsForPlayer } from '../lib/team';
import {
  acceptChallenge,
  Challenge,
  createChallenge,
  declineChallenge,
  getChallengesForPlayer,
  getTeammates,
  Teammate,
} from '../lib/challenges';

type PlayerCardData = {
  player: Player;
  drills: WeeklyDrill[];
  source: 'team' | 'library';
  streak: number;
  completedToday: Map<string, DrillResult>;
  promptForResults: boolean;
  challenges: Challenge[];
};

// Only meaningful once a challenge is accepted (endsAt set) — pending
// challenges never call this.
function daysLeft(endsAt: string | null): number {
  if (!endsAt) return 0;
  return Math.max(0, Math.ceil((new Date(endsAt).getTime() - new Date().getTime()) / 86400000));
}

// "8/10" if both are set, "8 reps" if just a rep count was logged, null
// if no result was logged for this completion at all.
function formatResult(result: DrillResult | undefined): string | null {
  if (!result) return null;
  if (result.makes != null && result.attempts != null) return `${result.makes}/${result.attempts}`;
  if (result.attempts != null) return `${result.attempts} reps`;
  return null;
}

// Parses a Postgres `time` column value ("HH:MM:SS") onto today's date.
// Falls back to the current time if the drill has no coach-set schedule.
function timeForToday(scheduledTime: string | null): Date {
  const date = new Date();
  if (scheduledTime) {
    const [hours, minutes] = scheduledTime.split(':').map(Number);
    date.setHours(hours, minutes, 0, 0);
  }
  return date;
}

export default function HomeScreen() {
  const navigation = useNavigation();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cards, setCards] = useState<PlayerCardData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [addingToCalendarId, setAddingToCalendarId] = useState<string | null>(null);
  const [schedulingFor, setSchedulingFor] = useState<WeeklyDrill | null>(null);
  const [pickerTime, setPickerTime] = useState(new Date());
  const [pickerDuration, setPickerDuration] = useState(String(DEFAULT_DRILL_MINUTES));
  const [loggingResultFor, setLoggingResultFor] = useState<{ playerId: string; drill: WeeklyDrill } | null>(null);
  const [resultMakes, setResultMakes] = useState('');
  const [resultAttempts, setResultAttempts] = useState('');
  const [savingResult, setSavingResult] = useState(false);
  const [challengingFor, setChallengingFor] = useState<string | null>(null);
  const [teammates, setTeammates] = useState<Teammate[]>([]);
  const [loadingTeammates, setLoadingTeammates] = useState(false);
  const [creatingChallengeId, setCreatingChallengeId] = useState<string | null>(null);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const players = await listMyPlayers();
      const cardData = await Promise.all(
        players.map(async (player) => {
          const [{ drills, source }, dates, completedToday, promptForResults, challenges] = await Promise.all([
            getWeeklyDrills(player.id),
            getCompletionDates(player.id),
            getTodayCompletions(player.id),
            getPromptForResultsForPlayer(player.id),
            getChallengesForPlayer(player.id),
          ]);
          return {
            player,
            drills,
            source,
            streak: calculateStreak(dates),
            completedToday,
            promptForResults,
            challenges,
          };
        })
      );
      setCards(cardData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // useFocusEffect, not useEffect — a tab navigator keeps every screen
  // mounted in the background, so a plain useEffect only ever fires once
  // on first mount. That's why switching tabs never showed a change made
  // elsewhere (a new player, a new team, a logged drill) without a manual
  // pull-to-refresh — this re-loads every time the tab is actually
  // navigated to, not just the first time.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const handleMarkComplete = async (playerId: string, drill: WeeklyDrill, promptForResults: boolean) => {
    setMarkingId(drill.id);
    setError(null);
    try {
      await logCompletion(playerId, drill.id);
      await load();
      // Coach-level nudge, not a gate: open the result modal automatically
      // so logging a result takes one tap instead of two, but it's still
      // just as skippable via Cancel as tapping the chart icon manually.
      if (promptForResults) {
        openResultLogger(playerId, drill, undefined);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to log completion.');
    } finally {
      setMarkingId(null);
    }
  };

  // Undo for an accidental "mark done" tap. Confirmed first since this is a
  // real delete — any logged makes/attempts for today go with it, and the
  // drill goes back to not-done (can be marked done again after).
  const handleUnmarkComplete = (playerId: string, drill: WeeklyDrill) => {
    Alert.alert(
      'Remove this completion?',
      `"${drill.name}" will go back to not done today. Any makes/attempts you logged for it will be lost.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setMarkingId(drill.id);
            try {
              await deleteCompletion(playerId, drill.id);
              await load();
            } catch (e) {
              Alert.alert('Could not remove', e instanceof Error ? e.message : 'Something went wrong.');
            } finally {
              setMarkingId(null);
            }
          },
        },
      ]
    );
  };

  const openResultLogger = (playerId: string, drill: WeeklyDrill, existing: DrillResult | undefined) => {
    setResultMakes(existing?.makes != null ? String(existing.makes) : '');
    setResultAttempts(existing?.attempts != null ? String(existing.attempts) : '');
    setLoggingResultFor({ playerId, drill });
  };

  const handleSaveResult = async () => {
    if (!loggingResultFor) return;
    const makes = resultMakes.trim() ? parseInt(resultMakes, 10) : null;
    const attempts = resultAttempts.trim() ? parseInt(resultAttempts, 10) : null;
    const invalid = (raw: string, parsed: number | null) => raw.trim() && (!Number.isFinite(parsed) || (parsed as number) < 0);
    if (invalid(resultMakes, makes) || invalid(resultAttempts, attempts)) {
      Alert.alert('Invalid number', 'Makes and attempts must be zero or a positive number.');
      return;
    }
    setSavingResult(true);
    try {
      await logDrillResult(loggingResultFor.playerId, loggingResultFor.drill.id, makes, attempts);
      setLoggingResultFor(null);
      await load();
    } catch (e) {
      Alert.alert('Could not save result', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSavingResult(false);
    }
  };

  const openChallengePicker = async (playerId: string) => {
    setChallengingFor(playerId);
    setLoadingTeammates(true);
    try {
      setTeammates(await getTeammates(playerId));
    } catch (e) {
      Alert.alert('Could not load teammates', e instanceof Error ? e.message : 'Something went wrong.');
      setChallengingFor(null);
    } finally {
      setLoadingTeammates(false);
    }
  };

  const handleCreateChallenge = async (teammate: Teammate) => {
    if (!challengingFor) return;
    setCreatingChallengeId(teammate.id);
    try {
      await createChallenge(teammate.team_id, challengingFor, teammate.id);
      setChallengingFor(null);
      await load();
    } catch (e) {
      Alert.alert('Could not send challenge', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setCreatingChallengeId(null);
    }
  };

  const handleAcceptChallenge = async (challengeId: string) => {
    setRespondingId(challengeId);
    try {
      await acceptChallenge(challengeId);
      await load();
    } catch (e) {
      Alert.alert('Could not accept challenge', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setRespondingId(null);
    }
  };

  const handleDeclineChallenge = async (challengeId: string) => {
    setRespondingId(challengeId);
    try {
      await declineChallenge(challengeId);
      await load();
    } catch (e) {
      Alert.alert('Could not remove challenge', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setRespondingId(null);
    }
  };

  // Quitting an active challenge is confirmed (unlike declining/canceling a
  // still-pending one) — it ends something the other player is actively
  // in, without asking them. Doesn't touch either player's drill history,
  // only the challenge record itself.
  const handleQuitChallenge = (challengeId: string, opponentName: string) => {
    Alert.alert(
      'Quit this challenge?',
      `This ends the challenge with ${opponentName} for both of you. Your drill history isn't affected.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Quit', style: 'destructive', onPress: () => handleDeclineChallenge(challengeId) },
      ]
    );
  };

  const openScheduler = (drill: WeeklyDrill) => {
    setPickerTime(timeForToday(drill.scheduledTime));
    setPickerDuration(String(drill.scheduledDurationMinutes ?? drill.estimatedMinutes ?? DEFAULT_DRILL_MINUTES));
    setSchedulingFor(drill);
  };

  const handlePickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') {
      // Android's picker is a self-dismissing dialog, not an inline control —
      // a cancel tap fires 'dismissed' with no date, so close our modal too.
      if (event.type === 'dismissed') {
        setSchedulingFor(null);
        return;
      }
    }
    if (selected) setPickerTime(selected);
  };

  const handleConfirmSchedule = async () => {
    if (!schedulingFor) return;
    const minutes = parseInt(pickerDuration, 10);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      Alert.alert('Invalid duration', 'Enter a duration in minutes greater than 0.');
      return;
    }

    const drill = schedulingFor;
    setSchedulingFor(null);
    setAddingToCalendarId(drill.id);
    try {
      await addDrillToCalendar(drill.name, pickerTime, minutes);
      Alert.alert('Added to calendar', `"${drill.name}" was added to your calendar.`);
    } catch (e) {
      Alert.alert(
        'Could not add to calendar',
        e instanceof Error ? e.message : 'Something went wrong.'
      );
    } finally {
      setAddingToCalendarId(null);
    }
  };

  if (loading) {
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
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {cards.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.sectionTitle}>No players yet</Text>
          <Text style={styles.placeholder}>
            Add a player, join a team with a coach's invite code, or add a
            custom drill from the Add a Player tab to get started.
          </Text>
          <Pressable
            style={styles.addButton}
            onPress={() => navigation.navigate('Add a Player' as never)}
          >
            <Text style={styles.addButtonText}>Go to Add a Player</Text>
          </Pressable>
        </View>
      ) : (
        cards.map(({ player, drills, source, streak, completedToday, promptForResults, challenges }) => (
          <View key={player.id} style={styles.playerSection}>
            <Text style={styles.playerName}>{player.display_name}</Text>

            <View style={styles.streakCard}>
              <Text style={styles.streakLabel}>Current streak</Text>
              <Text style={styles.streakValue}>
                {streak} {streak === 1 ? 'day' : 'days'}
              </Text>
            </View>

            <View style={styles.challengesSection}>
              <Text style={styles.sectionTitle}>Challenges</Text>
              {challenges.map((c) => {
                const isChallenger = c.challengerPlayerId === player.id;
                const opponentName = isChallenger ? c.opponentName : c.challengerName;
                const myCount = isChallenger ? c.challengerCompletions : c.opponentCompletions;
                const theirCount = isChallenger ? c.opponentCompletions : c.challengerCompletions;
                const ended = daysLeft(c.endsAt) === 0;
                const responding = respondingId === c.id;

                if (!c.accepted && !isChallenger) {
                  // Received, not yet responded to.
                  return (
                    <View key={c.id} style={styles.challengeRow}>
                      <Text style={styles.challengeText}>{c.challengerName} challenged you!</Text>
                      <View style={styles.modalButtonRow}>
                        <Pressable
                          style={[styles.smallButton, styles.smallButtonSecondary]}
                          onPress={() => handleDeclineChallenge(c.id)}
                          disabled={responding}
                        >
                          <Text style={styles.smallButtonSecondaryText}>Decline</Text>
                        </Pressable>
                        <Pressable
                          style={styles.smallButton}
                          onPress={() => handleAcceptChallenge(c.id)}
                          disabled={responding}
                        >
                          {responding ? (
                            <ActivityIndicator color="#FFFFFF" size="small" />
                          ) : (
                            <Text style={styles.smallButtonText}>Accept</Text>
                          )}
                        </Pressable>
                      </View>
                    </View>
                  );
                }

                if (!c.accepted && isChallenger) {
                  // Sent, waiting on the other player.
                  return (
                    <View key={c.id} style={styles.challengeRow}>
                      <Text style={styles.challengeText}>Waiting for {opponentName} to accept…</Text>
                      <Pressable onPress={() => handleDeclineChallenge(c.id)} disabled={responding} hitSlop={8}>
                        <Text style={styles.challengeCancel}>{responding ? '…' : 'Cancel'}</Text>
                      </Pressable>
                    </View>
                  );
                }

                // Accepted — active or ended.
                return (
                  <View key={c.id} style={styles.challengeRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.challengeText}>
                        vs {opponentName}: You {myCount} · {opponentName} {theirCount}
                      </Text>
                      <Text style={styles.challengeSubtext}>
                        {ended
                          ? myCount === theirCount
                            ? 'Tied'
                            : myCount > theirCount
                            ? 'You won! 🏆'
                            : `${opponentName} won`
                          : `${daysLeft(c.endsAt)} ${daysLeft(c.endsAt) === 1 ? 'day' : 'days'} left`}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => (ended ? handleDeclineChallenge(c.id) : handleQuitChallenge(c.id, opponentName))}
                      disabled={responding}
                      hitSlop={8}
                    >
                      <Text style={styles.challengeCancel}>{responding ? '…' : ended ? 'Remove' : 'Quit'}</Text>
                    </Pressable>
                  </View>
                );
              })}
              <Pressable style={styles.challengeButton} onPress={() => openChallengePicker(player.id)}>
                <Text style={styles.challengeButtonText}>+ Challenge a teammate</Text>
              </Pressable>
            </View>

            <Text style={styles.sectionTitle}>
              {source === 'team' ? "This week's assigned drills" : 'Drill library'}
            </Text>

            {drills.length === 0 ? (
              <Text style={styles.placeholder}>No drills available yet.</Text>
            ) : (
              drills.map((drill) => {
                const done = completedToday.has(drill.id);
                const result = formatResult(completedToday.get(drill.id));
                return (
                  <View key={drill.id} style={[styles.drillRow, done && styles.drillRowDone]}>
                    <Pressable
                      style={styles.drillRowMain}
                      onPress={() => handleMarkComplete(player.id, drill, promptForResults)}
                      disabled={markingId === drill.id || done}
                    >
                      <View style={styles.drillRowText}>
                        <Text style={styles.drillName}>{drill.name}</Text>
                        {drill.category ? (
                          <Text style={styles.drillCategory}>{drill.category}</Text>
                        ) : null}
                      </View>
                      {markingId === drill.id ? (
                        <ActivityIndicator color={colors.primary} />
                      ) : (
                        <Text style={done ? styles.checkDone : styles.checkPending}>
                          {done ? `✓ Done${result ? ` · ${result}` : ''}` : 'Mark done'}
                        </Text>
                      )}
                    </Pressable>
                    {drill.videoUrl ? (
                      <Pressable
                        style={styles.iconButton}
                        onPress={() => Linking.openURL(drill.videoUrl!)}
                        hitSlop={8}
                      >
                        <Text style={styles.iconButtonText}>▶️</Text>
                      </Pressable>
                    ) : null}
                    {done ? (
                      <Pressable
                        style={styles.iconButton}
                        onPress={() => openResultLogger(player.id, drill, completedToday.get(drill.id))}
                        hitSlop={8}
                      >
                        <Text style={styles.iconButtonText}>📊</Text>
                      </Pressable>
                    ) : null}
                    {done ? (
                      <Pressable
                        style={styles.iconButton}
                        onPress={() => handleUnmarkComplete(player.id, drill)}
                        disabled={markingId === drill.id}
                        hitSlop={8}
                      >
                        <Text style={styles.iconButtonText}>↩️</Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      style={styles.iconButton}
                      onPress={() => openScheduler(drill)}
                      disabled={addingToCalendarId === drill.id}
                      hitSlop={8}
                    >
                      {addingToCalendarId === drill.id ? (
                        <ActivityIndicator color={colors.primary} size="small" />
                      ) : (
                        <Text style={styles.iconButtonText}>📅</Text>
                      )}
                    </Pressable>
                  </View>
                );
              })
            )}
          </View>
        ))
      )}

      <Modal
        visible={schedulingFor != null}
        transparent
        animationType="fade"
        onRequestClose={() => setSchedulingFor(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{schedulingFor?.name}</Text>
            <Text style={styles.modalLabel}>Time</Text>
            <DateTimePicker
              value={pickerTime}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={handlePickerChange}
            />
            <Text style={styles.modalLabel}>Duration (minutes)</Text>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              value={pickerDuration}
              onChangeText={setPickerDuration}
            />
            <View style={styles.modalButtonRow}>
              <Pressable
                style={[styles.smallButton, styles.smallButtonSecondary]}
                onPress={() => setSchedulingFor(null)}
              >
                <Text style={styles.smallButtonSecondaryText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.smallButton} onPress={handleConfirmSchedule}>
                <Text style={styles.smallButtonText}>Add to Calendar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={loggingResultFor != null}
        transparent
        animationType="fade"
        onRequestClose={() => setLoggingResultFor(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{loggingResultFor?.drill.name}</Text>
            <Text style={styles.modalHint}>
              Optional — log a result if it applies (makes/attempts for
              shooting, or just attempts for a rep count). Leave blank to
              skip.
            </Text>
            <Text style={styles.modalLabel}>Makes</Text>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              placeholder="Optional"
              placeholderTextColor={colors.textMuted}
              value={resultMakes}
              onChangeText={setResultMakes}
            />
            <Text style={styles.modalLabel}>Attempts / Reps</Text>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              placeholder="Optional"
              placeholderTextColor={colors.textMuted}
              value={resultAttempts}
              onChangeText={setResultAttempts}
            />
            <View style={styles.modalButtonRow}>
              <Pressable
                style={[styles.smallButton, styles.smallButtonSecondary]}
                onPress={() => setLoggingResultFor(null)}
              >
                <Text style={styles.smallButtonSecondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.smallButton, savingResult && styles.buttonDisabled]}
                onPress={handleSaveResult}
                disabled={savingResult}
              >
                {savingResult ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.smallButtonText}>Save</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={challengingFor != null}
        transparent
        animationType="fade"
        onRequestClose={() => setChallengingFor(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Challenge a teammate</Text>
            <Text style={styles.modalHint}>
              A 7-day head-to-head on total drills completed. They'll need to accept before it starts.
            </Text>
            {loadingTeammates ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} />
            ) : teammates.length === 0 ? (
              <Text style={styles.placeholder}>
                No teammates found yet — join a team to challenge someone.
              </Text>
            ) : (
              teammates.map((t) => (
                <Pressable
                  key={t.id}
                  style={styles.teammateRow}
                  onPress={() => handleCreateChallenge(t)}
                  disabled={creatingChallengeId != null}
                >
                  <Text style={styles.teammateName}>{t.display_name}</Text>
                  {creatingChallengeId === t.id ? (
                    <ActivityIndicator color={colors.primary} size="small" />
                  ) : (
                    <Text style={styles.checkPending}>Challenge</Text>
                  )}
                </Pressable>
              ))
            )}
            <Pressable
              style={[styles.smallButton, styles.smallButtonSecondary, { marginTop: 12 }]}
              onPress={() => setChallengingFor(null)}
            >
              <Text style={styles.smallButtonSecondaryText}>Close</Text>
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
  emptyState: { gap: 12 },
  playerSection: { gap: 10, marginBottom: 8 },
  playerName: { fontSize: 20, fontWeight: '700', color: colors.text },
  streakCard: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    padding: 20,
  },
  streakLabel: { color: '#FFFFFF', fontSize: 14, opacity: 0.9 },
  streakValue: { color: colors.accent, fontSize: 32, fontWeight: '700', marginTop: 4 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: colors.text },
  placeholder: { fontSize: 14, color: colors.textMuted, lineHeight: 20 },
  addButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  addButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  drillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingRight: 12,
    backgroundColor: colors.surface,
  },
  drillRowDone: {
    borderColor: colors.success,
    backgroundColor: '#EAF7EE',
  },
  drillRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  drillRowText: { flex: 1, marginRight: 12 },
  drillName: { fontSize: 15, fontWeight: '600', color: colors.text },
  drillCategory: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  checkPending: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  checkDone: { color: colors.successDark, fontSize: 13, fontWeight: '700' },
  iconButton: { paddingLeft: 8 },
  iconButtonText: { fontSize: 20 },
  challengesSection: { gap: 8 },
  challengeRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  challengeText: { fontSize: 14, fontWeight: '600', color: colors.text, flexShrink: 1 },
  challengeSubtext: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  challengeCancel: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
  challengeButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  challengeButtonText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  teammateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  teammateName: { fontSize: 15, fontWeight: '600', color: colors.text },
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
    gap: 8,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 4 },
  modalHint: { fontSize: 12, color: colors.textMuted, lineHeight: 16 },
  modalLabel: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginTop: 8 },
  buttonDisabled: { opacity: 0.6 },
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
  modalButtonRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  smallButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  smallButtonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  smallButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  smallButtonSecondaryText: { color: colors.text, fontSize: 14, fontWeight: '600' },
});
