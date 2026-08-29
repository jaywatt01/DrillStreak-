import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import CoachPlayerStatsModal from '../components/CoachPlayerStatsModal';
import TeammatesModal from '../components/TeammatesModal';
import BadgeIconStrip from '../components/BadgeIconStrip';
import { calculateStreak, getCompletionDates, listMyPlayers, Player } from '../lib/players';
import { mondayOfThisWeek } from '../lib/date';
import { getActiveSeason, Season } from '../lib/seasons';
import { Badge, filterCurrentBadges, listBadges } from '../lib/badges';
import { getPlayerTeams } from '../lib/team';
import { Challenge, getChallengesForPlayer } from '../lib/challenges';
import { useParentEntitlement } from '../lib/purchases';

type DashboardCard = {
  player: Player;
  activeSeason: Season | null;
  streak: number;
  weeklyGoalCount: number;
  isOffseason: boolean;
  allBadges: Badge[];
  currentSeasonBadges: Badge[];
  teams: { id: string; name: string }[];
  activeChallengeCount: number;
};

const WEEKLY_GOAL_TARGET = 4;

// Only meaningful once a challenge is accepted (endsAt set) — pending
// challenges never call this. Duplicated from HomeScreen's own local copy
// rather than extracted to a shared lib — same 3-line utility, not worth
// a new shared module for.
function daysLeft(endsAt: string | null): number {
  if (!endsAt) return 0;
  return Math.max(0, Math.ceil((new Date(endsAt).getTime() - new Date().getTime()) / 86400000));
}

// A summary/status view (added 2026-08-25, Jay-requested) — the actual
// "homepage": one compact card per linked player, tapping through to the
// real screens for detail (Progress, the Drills tab, Team Board) rather
// than duplicating any of that UI here. Deliberately the OPPOSITE of a
// mega-page with everything expanded inline — that's the exact scroll-
// fatigue mistake already made and fixed twice elsewhere (Account tab's
// badge roster, twice). Player name and the badge strip both open the
// same CoachPlayerStatsModal already used everywhere else for "this
// player's full profile" — no new detail view built for this screen,
// only new summary rows that point at what already exists.
export default function DashboardScreen() {
  const navigation = useNavigation();
  const { hasParentTier } = useParentEntitlement();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<DashboardCard[]>([]);
  const [viewingProfileFor, setViewingProfileFor] = useState<{ id: string; name: string } | null>(null);
  const [teammatesForPlayerId, setTeammatesForPlayerId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const players = await listMyPlayers();
      const weekStart = mondayOfThisWeek();
      const data = await Promise.all(
        players.map(async (player) => {
          const [activeSeason, allBadges, teams, challenges] = await Promise.all([
            getActiveSeason(player.id),
            listBadges(player.id),
            getPlayerTeams(player.id),
            getChallengesForPlayer(player.id),
          ]);
          const isOffseason = activeSeason?.isOffseason ?? false;
          const dates = await getCompletionDates(player.id, activeSeason?.id);
          const streak = isOffseason ? 0 : calculateStreak(dates);
          const weeklyGoalCount = new Set(dates.filter((d) => d >= weekStart)).size;
          const activeChallengeCount = challenges.filter(
            (c: Challenge) => !c.accepted || daysLeft(c.endsAt) > 0
          ).length;

          return {
            player,
            activeSeason,
            streak,
            weeklyGoalCount,
            isOffseason,
            allBadges,
            currentSeasonBadges: filterCurrentBadges(allBadges, activeSeason),
            teams,
            activeChallengeCount,
          };
        })
      );
      setCards(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {cards.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.sectionTitle}>No players yet</Text>
            <Text style={styles.placeholder}>Add a player from the Add a Player tab to get started.</Text>
          </View>
        ) : (
          cards.map((card) => (
            <View key={card.player.id} style={styles.card}>
              <Pressable
                onPress={() => setViewingProfileFor({ id: card.player.id, name: card.player.display_name })}
              >
                <Text style={styles.playerName}>{card.player.display_name}</Text>
              </Pressable>

              <Pressable
                style={styles.statRow}
                onPress={() => (navigation.navigate as (name: never) => void)('Progress' as never)}
              >
                <Text style={styles.statLabel}>
                  {card.activeSeason
                    ? `${card.isOffseason ? 'Offseason' : 'In Season'} · ${card.activeSeason.label}`
                    : 'No season started yet'}
                </Text>
                <Text style={styles.statValue}>
                  {card.isOffseason
                    ? `${card.weeklyGoalCount}/${WEEKLY_GOAL_TARGET} sessions this week`
                    : `${card.streak} ${card.streak === 1 ? 'day' : 'days'} streak`}
                </Text>
              </Pressable>

              <Pressable
                style={styles.statRow}
                onPress={() => setViewingProfileFor({ id: card.player.id, name: card.player.display_name })}
              >
                <Text style={styles.statLabel}>Badges</Text>
                <BadgeIconStrip currentSeasonBadges={card.currentSeasonBadges} allBadges={card.allBadges} />
              </Pressable>

              {card.teams.length > 0 ? (
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>{card.teams.map((t) => t.name).join(', ')}</Text>
                  <Pressable onPress={() => setTeammatesForPlayerId(card.player.id)} hitSlop={8}>
                    <Text style={styles.link}>Teammates →</Text>
                  </Pressable>
                </View>
              ) : (
                <Text style={styles.statLabel}>Not on a team yet</Text>
              )}

              {card.activeChallengeCount > 0 ? (
                <Pressable
                  style={styles.statRow}
                  onPress={() => (navigation.navigate as (name: never) => void)('Home' as never)}
                >
                  <Text style={styles.statLabel}>
                    {card.activeChallengeCount} active {card.activeChallengeCount === 1 ? 'challenge' : 'challenges'}
                  </Text>
                  <Text style={styles.link}>View →</Text>
                </Pressable>
              ) : null}
            </View>
          ))
        )}
      </ScrollView>

      {viewingProfileFor ? (
        <CoachPlayerStatsModal
          playerId={viewingProfileFor.id}
          playerName={viewingProfileFor.name}
          hasParentTier={hasParentTier}
          onClose={() => setViewingProfileFor(null)}
        />
      ) : null}
      {teammatesForPlayerId ? (
        <TeammatesModal playerId={teammatesForPlayerId} onClose={() => setTeammatesForPlayerId(null)} />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  error: { color: '#C4362B', fontSize: 13 },
  emptyState: { gap: 6 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: colors.text },
  placeholder: { fontSize: 14, color: colors.textMuted, lineHeight: 20 },
  card: {
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    backgroundColor: colors.surface,
  },
  playerName: { fontSize: 20, fontWeight: '700', color: colors.text },
  statRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  statLabel: { fontSize: 13, color: colors.textMuted, flexShrink: 1 },
  statValue: { fontSize: 14, fontWeight: '700', color: colors.text },
  link: { fontSize: 13, fontWeight: '600', color: colors.accentDark },
});
