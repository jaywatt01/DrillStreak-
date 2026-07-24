import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import {
  calculateStreak,
  DEFAULT_DRILL_MINUTES,
  getCompletionDates,
  getTodayCompletedDrillIds,
  getWeeklyDrills,
  listMyPlayers,
  logCompletion,
  Player,
  WeeklyDrill,
} from '../lib/players';
import { addDrillToCalendar } from '../lib/calendar';

type PlayerCardData = {
  player: Player;
  drills: WeeklyDrill[];
  source: 'team' | 'library';
  streak: number;
  completedToday: Set<string>;
};

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

  const load = useCallback(async () => {
    setError(null);
    try {
      const players = await listMyPlayers();
      const cardData = await Promise.all(
        players.map(async (player) => {
          const [{ drills, source }, dates, completedToday] = await Promise.all([
            getWeeklyDrills(player.id),
            getCompletionDates(player.id),
            getTodayCompletedDrillIds(player.id),
          ]);
          return {
            player,
            drills,
            source,
            streak: calculateStreak(dates),
            completedToday,
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

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const handleMarkComplete = async (playerId: string, drillId: string) => {
    setMarkingId(drillId);
    setError(null);
    try {
      await logCompletion(playerId, drillId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to log completion.');
    } finally {
      setMarkingId(null);
    }
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
        cards.map(({ player, drills, source, streak, completedToday }) => (
          <View key={player.id} style={styles.playerSection}>
            <Text style={styles.playerName}>{player.display_name}</Text>

            <View style={styles.streakCard}>
              <Text style={styles.streakLabel}>Current streak</Text>
              <Text style={styles.streakValue}>
                {streak} {streak === 1 ? 'day' : 'days'}
              </Text>
            </View>

            <Text style={styles.sectionTitle}>
              {source === 'team' ? "This week's assigned drills" : 'Drill library'}
            </Text>

            {drills.length === 0 ? (
              <Text style={styles.placeholder}>No drills available yet.</Text>
            ) : (
              drills.map((drill) => {
                const done = completedToday.has(drill.id);
                return (
                  <View key={drill.id} style={[styles.drillRow, done && styles.drillRowDone]}>
                    <Pressable
                      style={styles.drillRowMain}
                      onPress={() => handleMarkComplete(player.id, drill.id)}
                      disabled={markingId === drill.id}
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
                          {done ? '✓ Done' : 'Mark done'}
                        </Text>
                      )}
                    </Pressable>
                    <Pressable
                      style={styles.calendarButton}
                      onPress={() => openScheduler(drill)}
                      disabled={addingToCalendarId === drill.id}
                      hitSlop={8}
                    >
                      {addingToCalendarId === drill.id ? (
                        <ActivityIndicator color={colors.primary} size="small" />
                      ) : (
                        <Text style={styles.calendarButtonText}>📅</Text>
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
    borderColor: colors.accent,
    backgroundColor: '#FFF8EA',
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
  checkDone: { color: colors.accentDark, fontSize: 13, fontWeight: '700' },
  calendarButton: { paddingLeft: 8 },
  calendarButtonText: { fontSize: 20 },
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
  modalLabel: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginTop: 8 },
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
