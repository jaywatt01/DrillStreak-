import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import {
  calculateStreak,
  Drill,
  getCompletionDates,
  getTodayCompletedDrillIds,
  getWeeklyDrills,
  listMyPlayers,
  logCompletion,
  Player,
} from '../lib/players';

type PlayerCardData = {
  player: Player;
  drills: Drill[];
  source: 'team' | 'library';
  streak: number;
  completedToday: Set<string>;
};

export default function HomeScreen() {
  const navigation = useNavigation();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cards, setCards] = useState<PlayerCardData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);

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
                  <Pressable
                    key={drill.id}
                    style={[styles.drillRow, done && styles.drillRowDone]}
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
                );
              })
            )}
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
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.surface,
  },
  drillRowDone: {
    borderColor: colors.accent,
    backgroundColor: '#FFF8EA',
  },
  drillRowText: { flex: 1, marginRight: 12 },
  drillName: { fontSize: 15, fontWeight: '600', color: colors.text },
  drillCategory: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  checkPending: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  checkDone: { color: colors.accentDark, fontSize: 13, fontWeight: '700' },
});
