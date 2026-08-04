import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { useParentEntitlement } from '../lib/purchases';
import {
  calculateStreak,
  CompletionHistoryEntry,
  getCompletionHistory,
  listMyPlayers,
  Player,
} from '../lib/players';
import { mondayOfThisWeek } from '../lib/date';

type PlayerProgress = {
  player: Player;
  streak: number;
  visibleHistory: CompletionHistoryEntry[];
  hasMoreHistory: boolean;
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
          const history = await getCompletionHistory(player.id);
          const dates = history.map((h) => h.date);
          const visibleHistory = hasParentTier ? history : history.filter((h) => h.date >= weekStart);
          return {
            player,
            streak: calculateStreak(dates),
            visibleHistory,
            hasMoreHistory: !hasParentTier && history.length > visibleHistory.length,
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

  useEffect(() => {
    if (!entitlementLoading) load();
  }, [load, entitlementLoading]);

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
        progress.map(({ player, streak, visibleHistory, hasMoreHistory }) => (
          <View key={player.id} style={styles.playerSection}>
            <Text style={styles.playerName}>{player.display_name}</Text>
            <View style={styles.streakCard}>
              <Text style={styles.streakLabel}>Current streak</Text>
              <Text style={styles.streakValue}>
                {streak} {streak === 1 ? 'day' : 'days'}
              </Text>
            </View>

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
  streakCard: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    padding: 20,
  },
  streakLabel: { color: '#FFFFFF', fontSize: 14, opacity: 0.9 },
  streakValue: { color: colors.accent, fontSize: 32, fontWeight: '700', marginTop: 4 },
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
