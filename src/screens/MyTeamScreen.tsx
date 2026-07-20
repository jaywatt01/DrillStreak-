import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors } from '../theme/colors';
import { Drill } from '../lib/players';
import {
  assignDrillToTeam,
  AssignedDrill,
  createTeam,
  getAvailableDrills,
  getMyTeam,
  getRoster,
  getRosterCompletionsThisWeek,
  getWeeklyTeamAssignments,
  RosterCompletion,
  RosterPlayer,
  Team,
  unassignDrill,
} from '../lib/team';

export default function MyTeamScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [team, setTeam] = useState<Team | null>(null);
  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  const [availableDrills, setAvailableDrills] = useState<Drill[]>([]);
  const [assignedDrills, setAssignedDrills] = useState<AssignedDrill[]>([]);
  const [rosterCompletions, setRosterCompletions] = useState<RosterCompletion[]>([]);
  const [teamName, setTeamName] = useState('');
  const [creating, setCreating] = useState(false);
  const [togglingDrillId, setTogglingDrillId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const myTeam = await getMyTeam();
      setTeam(myTeam);
      if (myTeam) {
        const [rosterData, drills, assigned] = await Promise.all([
          getRoster(myTeam.id),
          getAvailableDrills(),
          getWeeklyTeamAssignments(myTeam.id),
        ]);
        setRoster(rosterData);
        setAvailableDrills(drills);
        setAssignedDrills(assigned);
        const completions = await getRosterCompletionsThisWeek(rosterData.map((p) => p.id));
        setRosterCompletions(completions);
      }
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

  const handleCreateTeam = async () => {
    if (!teamName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await createTeam(teamName.trim());
      setTeamName('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create team.');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleDrill = async (drill: Drill) => {
    const existing = assignedDrills.find((d) => d.id === drill.id);
    setTogglingDrillId(drill.id);
    setError(null);
    try {
      if (existing) {
        await unassignDrill(existing.assignmentId);
      } else if (team) {
        await assignDrillToTeam(team.id, drill.id);
      }
      if (team) {
        setAssignedDrills(await getWeeklyTeamAssignments(team.id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update assignment.');
    } finally {
      setTogglingDrillId(null);
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

      {!team ? (
        <View style={styles.emptyState}>
          <Text style={styles.sectionTitle}>Create your team</Text>
          <Text style={styles.placeholder}>
            Create a team to get a roster, an invite code for your players,
            and the ability to assign this week's drills.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="Team name"
            placeholderTextColor={colors.textMuted}
            value={teamName}
            onChangeText={setTeamName}
          />
          <Pressable
            style={[styles.button, (!teamName.trim() || creating) && styles.buttonDisabled]}
            onPress={handleCreateTeam}
            disabled={!teamName.trim() || creating}
          >
            {creating ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.buttonText}>Create Team</Text>
            )}
          </Pressable>
        </View>
      ) : (
        <>
          <Text style={styles.teamName}>{team.name}</Text>

          <View style={styles.inviteCard}>
            <Text style={styles.inviteLabel}>Invite code</Text>
            <Text style={styles.inviteCode}>{team.invite_code}</Text>
            <Text style={styles.invitePlaceholder}>
              Share this with players/parents so they can join from Add a
              Player.
            </Text>
          </View>

          <Text style={styles.sectionTitle}>Roster ({roster.length})</Text>
          {roster.length === 0 ? (
            <Text style={styles.placeholder}>
              No players yet — share your invite code to get your roster started.
            </Text>
          ) : (
            roster.map((p) => (
              <View key={p.id} style={styles.rosterRow}>
                <Text style={styles.rosterName}>{p.display_name}</Text>
              </View>
            ))
          )}

          <Text style={styles.sectionTitle}>This week's drills</Text>
          <Text style={styles.placeholder}>
            Tap a drill to assign it to the whole team for this week. Tap
            again to remove it.
          </Text>
          {availableDrills.map((drill) => {
            const assigned = assignedDrills.some((d) => d.id === drill.id);
            return (
              <Pressable
                key={drill.id}
                style={[styles.drillRow, assigned && styles.drillRowAssigned]}
                onPress={() => handleToggleDrill(drill)}
                disabled={togglingDrillId === drill.id}
              >
                <View style={styles.drillRowText}>
                  <Text style={styles.drillName}>{drill.name}</Text>
                  {drill.category ? (
                    <Text style={styles.drillCategory}>{drill.category}</Text>
                  ) : null}
                </View>
                {togglingDrillId === drill.id ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <Text style={assigned ? styles.assignedTag : styles.assignTag}>
                    {assigned ? '✓ Assigned' : 'Assign'}
                  </Text>
                )}
              </Pressable>
            );
          })}

          <Text style={styles.sectionTitle}>Roster activity this week</Text>
          {rosterCompletions.length === 0 ? (
            <Text style={styles.placeholder}>
              No completions logged by your roster yet this week.
            </Text>
          ) : (
            rosterCompletions.map((c) => (
              <View key={c.id} style={styles.activityRow}>
                <Text style={styles.activityText}>
                  <Text style={styles.activityPlayer}>{c.playerName}</Text> completed{' '}
                  <Text style={styles.activityDrill}>{c.drillName}</Text>
                </Text>
                <Text style={styles.activityDate}>{c.date}</Text>
              </View>
            ))
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  error: { color: '#C4362B', fontSize: 13 },
  emptyState: { gap: 12 },
  teamName: { fontSize: 20, fontWeight: '700', color: colors.text },
  inviteCard: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    padding: 20,
    gap: 4,
  },
  inviteLabel: { color: '#FFFFFF', fontSize: 14, opacity: 0.9 },
  inviteCode: {
    color: colors.accent,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 2,
  },
  invitePlaceholder: { color: '#FFFFFF', fontSize: 12, opacity: 0.85, marginTop: 4 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: colors.text, marginTop: 8 },
  placeholder: { fontSize: 14, color: colors.textMuted, lineHeight: 20 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  rosterRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.surface,
  },
  rosterName: { fontSize: 15, fontWeight: '600', color: colors.text },
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
  drillRowAssigned: {
    borderColor: colors.accent,
    backgroundColor: '#FFF8EA',
  },
  drillRowText: { flex: 1, marginRight: 12 },
  drillName: { fontSize: 15, fontWeight: '600', color: colors.text },
  drillCategory: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  assignTag: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  assignedTag: { color: colors.accentDark, fontSize: 13, fontWeight: '700' },
  activityRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    gap: 2,
  },
  activityText: { fontSize: 14, color: colors.text },
  activityPlayer: { fontWeight: '700' },
  activityDrill: { fontWeight: '600' },
  activityDate: { fontSize: 12, color: colors.textMuted },
});
