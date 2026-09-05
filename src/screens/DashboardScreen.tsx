import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { getUpcomingTeamEvents } from '../lib/teamEvents';
import { deleteScheduledDrill, getUpcomingScheduledDrills } from '../lib/schedule';
import { Challenge, getChallengesForPlayer } from '../lib/challenges';
import { useParentEntitlement } from '../lib/purchases';
import { getInstitutionalAccessByPlayer } from '../lib/institutionalAccess';

type ScheduleItem = {
  key: string;
  title: string;
  subtitle: string;
  when: Date;
  // Set only for a player-scheduled drill, never a team event — team
  // events are coach-managed and deleted from Team Board, not here. Lets
  // the row render a delete affordance only where it's actually this
  // screen's job to offer one.
  scheduledDrillId?: string;
};

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
  scheduleItems: ScheduleItem[];
};

const WEEKLY_GOAL_TARGET = 4;
// How many upcoming items to show per player — a preview, not the full
// calendar. Matches the "compact card, tap through for depth" posture of
// everything else on this screen, though there's no dedicated full-
// schedule screen to tap through to yet (drills stay visible on Drills,
// events on Team Board — this is a merged preview of both, not a new
// source of truth).
const SCHEDULE_PREVIEW_COUNT = 5;

function formatScheduleWhen(date: Date): string {
  const day = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day}, ${time}`;
}

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
  const { hasParentTier: hasPurchasedParentTier } = useParentEntitlement();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<DashboardCard[]>([]);
  const [viewingProfileFor, setViewingProfileFor] = useState<{ id: string; name: string } | null>(null);
  const [teammatesForPlayerId, setTeammatesForPlayerId] = useState<string | null>(null);
  // Institutional (Team/Program) access is per-player, not account-level —
  // fetched fresh whenever the self-view profile changes, combined with the
  // account's RevenueCat entitlement below. See src/lib/institutionalAccess.ts.
  const [selfViewInstitutionalAccess, setSelfViewInstitutionalAccess] = useState(false);
  useEffect(() => {
    if (!viewingProfileFor) {
      setSelfViewInstitutionalAccess(false);
      return;
    }
    let cancelled = false;
    getInstitutionalAccessByPlayer([viewingProfileFor.id])
      .then((result) => {
        if (!cancelled) setSelfViewInstitutionalAccess(result[viewingProfileFor.id] === true);
      })
      .catch(() => {
        if (!cancelled) setSelfViewInstitutionalAccess(false);
      });
    return () => {
      cancelled = true;
    };
  }, [viewingProfileFor]);
  const hasParentTier = hasPurchasedParentTier || selfViewInstitutionalAccess;

  const load = useCallback(async () => {
    setError(null);
    try {
      const players = await listMyPlayers();
      const weekStart = mondayOfThisWeek();
      const data = await Promise.all(
        players.map(async (player) => {
          const [activeSeason, allBadges, teams, challenges, scheduledDrills] = await Promise.all([
            getActiveSeason(player.id),
            listBadges(player.id),
            getPlayerTeams(player.id),
            getChallengesForPlayer(player.id),
            getUpcomingScheduledDrills(player.id),
          ]);
          const isOffseason = activeSeason?.isOffseason ?? false;
          const dates = await getCompletionDates(player.id, activeSeason?.id);
          const streak = isOffseason ? 0 : calculateStreak(dates);
          const weeklyGoalCount = new Set(dates.filter((d) => d >= weekStart)).size;
          const activeChallengeCount = challenges.filter(
            (c: Challenge) => !c.accepted || daysLeft(c.endsAt) > 0
          ).length;

          // Merges two real, separate sources — a player's own scheduled
          // drills and every team this player is on's shared events — into
          // one chronological preview. Neither source knows about the
          // other; this screen is the only place they're combined.
          const teamEventLists = await Promise.all(teams.map((t) => getUpcomingTeamEvents(t.id)));
          const scheduleItems: ScheduleItem[] = [
            ...scheduledDrills.map((d) => ({
              key: `drill-${d.id}`,
              title: d.drillName,
              subtitle: `Drill · ${d.durationMinutes} min`,
              when: new Date(d.scheduledAt),
              scheduledDrillId: d.id,
            })),
            ...teamEventLists.flat().map((e) => ({
              key: `event-${e.id}`,
              title: e.title,
              subtitle: e.eventType ?? 'Team event',
              when: new Date(`${e.eventDate}T${e.eventTime ?? '09:00:00'}`),
            })),
          ]
            .sort((a, b) => a.when.getTime() - b.when.getTime())
            .slice(0, SCHEDULE_PREVIEW_COUNT);

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
            scheduleItems,
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

  // Real gap Jay caught testing on Android, Sept 5, 2026: a scheduled
  // drill could only ever be removed by deleting it from the phone's
  // native Calendar app directly, with no way to cancel it from within
  // DrillStreak at all. Confirms first, since this also cancels the
  // calendar event on whichever device originally scheduled it.
  const handleDeleteScheduledDrill = (scheduledDrillId: string, drillName: string) => {
    Alert.alert('Cancel this drill?', `"${drillName}" will be removed from your schedule and calendar.`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel drill',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteScheduledDrill(scheduledDrillId);
            load();
          } catch (e) {
            Alert.alert('Could not cancel', e instanceof Error ? e.message : 'Something went wrong.');
          }
        },
      },
    ]);
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
                  onPress={() =>
                    (navigation.navigate as (name: never, params?: object) => void)('Home' as never, {
                      playerId: card.player.id,
                    })
                  }
                >
                  <Text style={styles.statLabel}>
                    {card.activeChallengeCount} active {card.activeChallengeCount === 1 ? 'challenge' : 'challenges'}
                  </Text>
                  <Text style={styles.link}>View →</Text>
                </Pressable>
              ) : null}

              {card.scheduleItems.length > 0 ? (
                <View style={styles.scheduleSection}>
                  <Text style={styles.statLabel}>Upcoming</Text>
                  {card.scheduleItems.map((item) => (
                    <View key={item.key} style={styles.scheduleRow}>
                      <View style={styles.scheduleText}>
                        <Text style={styles.scheduleTitle}>{item.title}</Text>
                        <Text style={styles.scheduleSubtitle}>{item.subtitle}</Text>
                      </View>
                      <Text style={styles.scheduleWhen}>{formatScheduleWhen(item.when)}</Text>
                      {item.scheduledDrillId ? (
                        <Pressable
                          onPress={() => handleDeleteScheduledDrill(item.scheduledDrillId!, item.title)}
                          hitSlop={8}
                          style={styles.scheduleDeleteButton}
                        >
                          <Text style={styles.scheduleDeleteText}>✕</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ))}
                </View>
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
  scheduleSection: { gap: 6, marginTop: 2 },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.background,
  },
  scheduleText: { flex: 1 },
  scheduleTitle: { fontSize: 13, fontWeight: '600', color: colors.text },
  scheduleSubtitle: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  scheduleWhen: { fontSize: 12, fontWeight: '600', color: colors.primary },
  scheduleDeleteButton: { paddingHorizontal: 4, paddingVertical: 4 },
  scheduleDeleteText: { fontSize: 14, fontWeight: '700', color: colors.textMuted },
});
