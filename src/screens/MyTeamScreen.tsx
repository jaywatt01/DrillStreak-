import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { colors } from '../theme/colors';
import CoachPlayerStatsModal from '../components/CoachPlayerStatsModal';
import { DEFAULT_DRILL_MINUTES, Drill } from '../lib/players';
import {
  assignDrillToTeam,
  AssignedDrill,
  createTeam,
  deleteTeam,
  getAvailableDrills,
  getMyNoteForPlayer,
  getMyTeam,
  getRoster,
  getRosterCompletionsThisWeek,
  getWeeklyTeamAssignments,
  removeFromRoster,
  renameTeam,
  RosterCompletion,
  RosterPlayer,
  saveMyNoteForPlayer,
  setPromptForResults,
  Team,
  unassignDrill,
  updateAssignmentSchedule,
} from '../lib/team';

// "HH:MM:SS" (Postgres `time`) <-> a plain Date used just to drive the
// picker UI. Only the hour/minute round-trip through the database.
function timeStringToDate(time: string | null): Date {
  const date = new Date();
  if (time) {
    const [hours, minutes] = time.split(':').map(Number);
    date.setHours(hours, minutes, 0, 0);
  }
  return date;
}

function dateToTimeString(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:00`;
}

function formatScheduleLabel(scheduledTime: string | null, durationMinutes: number | null): string | null {
  if (!scheduledTime && !durationMinutes) return null;
  const time = scheduledTime
    ? timeStringToDate(scheduledTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null;
  if (time && durationMinutes) return `${time} · ${durationMinutes} min`;
  if (time) return time;
  return `${durationMinutes} min`;
}

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
  const [renamingTeam, setRenamingTeam] = useState(false);
  const [renameTeamText, setRenameTeamText] = useState('');
  const [savingTeamEdit, setSavingTeamEdit] = useState(false);
  const [schedulingDrill, setSchedulingDrill] = useState<AssignedDrill | null>(null);
  const [pickerTime, setPickerTime] = useState(new Date());
  const [pickerDuration, setPickerDuration] = useState(String(DEFAULT_DRILL_MINUTES));
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [notePlayer, setNotePlayer] = useState<RosterPlayer | null>(null);
  const [noteText, setNoteText] = useState('');
  const [loadingNote, setLoadingNote] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [statsPlayer, setStatsPlayer] = useState<RosterPlayer | null>(null);

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

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

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

  const handleTeamOptions = () => {
    if (!team) return;
    Alert.alert(team.name, 'What would you like to do?', [
      {
        text: 'Rename Team',
        onPress: () => {
          setRenamingTeam(true);
          setRenameTeamText(team.name);
        },
      },
      {
        text: 'Delete Team',
        style: 'destructive',
        onPress: () => {
          Alert.alert(
            `Delete ${team.name}?`,
            'This removes the whole roster and this week\'s assignments. Players keep their own profiles and logged history. This can\'t be undone.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  try {
                    await deleteTeam(team.id);
                    await load();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Failed to delete team.');
                  }
                },
              },
            ]
          );
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleSaveTeamRename = async () => {
    if (!team || !renameTeamText.trim()) return;
    setSavingTeamEdit(true);
    setError(null);
    try {
      await renameTeam(team.id, renameTeamText.trim());
      setRenamingTeam(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename team.');
    } finally {
      setSavingTeamEdit(false);
    }
  };

  // Uses the native share sheet rather than a clipboard package — a
  // clipboard package would be a new native module, which needs a fresh
  // dev-client/EAS build before it works at all (same class of problem as
  // the TestFlight/dev-client bundle-ID issue). Share is already part of
  // React Native core, so this works with today's build, and the iOS share
  // sheet already includes a "Copy" action plus direct-to-Messages/Mail —
  // covers "copy it" and "send it out" in one action.
  const handleShareInviteCode = (code: string) => {
    Share.share({ message: `Join my DrillStreak team with invite code: ${code}` });
  };

  const handleTogglePromptForResults = async (value: boolean) => {
    if (!team) return;
    setTeam({ ...team, prompt_for_results: value }); // optimistic — instant toggle feel
    try {
      await setPromptForResults(team.id, value);
    } catch (e) {
      setTeam({ ...team, prompt_for_results: !value }); // revert on failure
      setError(e instanceof Error ? e.message : 'Failed to update setting.');
    }
  };

  const openNoteEditor = async (player: RosterPlayer) => {
    setNotePlayer(player);
    setNoteText('');
    setLoadingNote(true);
    try {
      setNoteText(await getMyNoteForPlayer(player.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load note.');
    } finally {
      setLoadingNote(false);
    }
  };

  const handleSaveNote = async () => {
    if (!notePlayer) return;
    setSavingNote(true);
    setError(null);
    try {
      await saveMyNoteForPlayer(notePlayer.id, noteText);
      setNotePlayer(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save note.');
    } finally {
      setSavingNote(false);
    }
  };

  const handleLongPressRosterPlayer = (player: RosterPlayer) => {
    Alert.alert(`Remove ${player.display_name}?`, 'Removes them from this team\'s roster. Their profile and logged history stay intact.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await removeFromRoster(player.membershipId);
            await load();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to remove player.');
          }
        },
      },
    ]);
  };

  const openScheduler = (assigned: AssignedDrill) => {
    setPickerTime(timeStringToDate(assigned.scheduledTime));
    setPickerDuration(String(assigned.durationMinutes ?? assigned.estimatedMinutes ?? DEFAULT_DRILL_MINUTES));
    setSchedulingDrill(assigned);
  };

  const handlePickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android' && event.type === 'dismissed') {
      setSchedulingDrill(null);
      return;
    }
    if (selected) setPickerTime(selected);
  };

  const handleConfirmSchedule = async () => {
    if (!schedulingDrill) return;
    const minutes = parseInt(pickerDuration, 10);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      Alert.alert('Invalid duration', 'Enter a duration in minutes greater than 0.');
      return;
    }

    setSavingSchedule(true);
    setError(null);
    try {
      await updateAssignmentSchedule(schedulingDrill.assignmentId, dateToTimeString(pickerTime), minutes);
      setSchedulingDrill(null);
      if (team) setAssignedDrills(await getWeeklyTeamAssignments(team.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to set schedule.');
    } finally {
      setSavingSchedule(false);
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
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
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
          <View style={styles.teamNameRow}>
            <Text style={styles.teamName}>{team.name}</Text>
            <Pressable onPress={handleTeamOptions}>
              <Text style={styles.editLink}>Edit</Text>
            </Pressable>
          </View>

          {renamingTeam ? (
            <View style={styles.editRow}>
              <TextInput
                style={styles.input}
                value={renameTeamText}
                onChangeText={setRenameTeamText}
                placeholder="Team name"
                placeholderTextColor={colors.textMuted}
              />
              <View style={styles.editButtonRow}>
                <Pressable
                  style={[styles.smallButton, styles.smallButtonSecondary]}
                  onPress={() => setRenamingTeam(false)}
                >
                  <Text style={styles.smallButtonSecondaryText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.smallButton,
                    (!renameTeamText.trim() || savingTeamEdit) && styles.buttonDisabled,
                  ]}
                  onPress={handleSaveTeamRename}
                  disabled={!renameTeamText.trim() || savingTeamEdit}
                >
                  {savingTeamEdit ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.smallButtonText}>Save</Text>
                  )}
                </Pressable>
              </View>
            </View>
          ) : null}

          <View style={styles.inviteCard}>
            <Text style={styles.inviteLabel}>Invite code · free for coaches, always</Text>
            <Pressable
              style={styles.inviteCodeRow}
              onPress={() => handleShareInviteCode(team.invite_code)}
              onLongPress={() => handleShareInviteCode(team.invite_code)}
            >
              <Text style={styles.inviteCode}>{team.invite_code}</Text>
              <Text style={styles.inviteShareIcon}>📤</Text>
            </Pressable>
            <Text style={styles.invitePlaceholder}>
              Share this with every player and parent on your roster — the
              more of them who join, the more accountability data you see on
              your own roster activity feed below, at no cost to you.
            </Text>
          </View>

          <View style={styles.settingRow}>
            <View style={styles.settingText}>
              <Text style={styles.settingLabel}>Prompt for makes/attempts</Text>
              <Text style={styles.settingBody}>
                When a player marks a drill done, open the result box
                automatically instead of requiring an extra tap. Still
                optional to fill in either way.
              </Text>
            </View>
            <Switch
              value={team.prompt_for_results}
              onValueChange={handleTogglePromptForResults}
              trackColor={{ true: colors.primary }}
            />
          </View>

          <Text style={styles.sectionTitle}>Roster ({roster.length})</Text>
          {roster.length === 0 ? (
            <Text style={styles.placeholder}>
              No players yet — share your invite code to get your roster started.
            </Text>
          ) : (
            <>
              <Text style={styles.placeholder}>
                Tap Stats to see a player's streak, shooting, and history. Tap Note to add or
                edit your note about them. Long-press to remove them from the roster.
              </Text>
              {roster.map((p) => (
                <Pressable
                  key={p.id}
                  style={styles.rosterRow}
                  onPress={() => setStatsPlayer(p)}
                  onLongPress={() => handleLongPressRosterPlayer(p)}
                >
                  <Text style={styles.rosterName}>{p.display_name}</Text>
                  <View style={styles.rosterLinks}>
                    <Text style={styles.statsLink}>Stats</Text>
                    <Pressable onPress={() => openNoteEditor(p)} hitSlop={8}>
                      <Text style={styles.noteLink}>Note</Text>
                    </Pressable>
                  </View>
                </Pressable>
              ))}
            </>
          )}

          <Text style={styles.sectionTitle}>This week's drills</Text>
          <Text style={styles.placeholder}>
            Tap a drill to assign it to the whole team for this week. Tap
            again to remove it.
          </Text>
          {availableDrills.map((drill) => {
            const assignedDrill = assignedDrills.find((d) => d.id === drill.id);
            const assigned = assignedDrill != null;
            const scheduleLabel = assignedDrill
              ? formatScheduleLabel(assignedDrill.scheduledTime, assignedDrill.durationMinutes)
              : null;
            return (
              <View key={drill.id} style={[styles.drillRow, assigned && styles.drillRowAssigned]}>
                <Pressable
                  style={styles.drillRowMain}
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
                {assignedDrill ? (
                  <Pressable onPress={() => openScheduler(assignedDrill)} hitSlop={8}>
                    <Text style={styles.scheduleLink}>
                      {scheduleLabel ? `⏰ ${scheduleLabel}` : '⏰ Set suggested time'}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
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

      <Modal
        visible={schedulingDrill != null}
        transparent
        animationType="fade"
        onRequestClose={() => setSchedulingDrill(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{schedulingDrill?.name}</Text>
            <Text style={styles.placeholder}>
              Sets the suggested time each player's calendar picker opens to —
              they still choose whether to add it, and can change the time.
            </Text>
            <Text style={styles.modalLabel}>Suggested time</Text>
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
            <View style={styles.editButtonRow}>
              <Pressable
                style={[styles.smallButton, styles.smallButtonSecondary]}
                onPress={() => setSchedulingDrill(null)}
              >
                <Text style={styles.smallButtonSecondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.smallButton, savingSchedule && styles.buttonDisabled]}
                onPress={handleConfirmSchedule}
                disabled={savingSchedule}
              >
                {savingSchedule ? (
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
        visible={notePlayer != null}
        transparent
        animationType="fade"
        onRequestClose={() => setNotePlayer(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{notePlayer?.display_name}'s note</Text>
            <Text style={styles.placeholder}>
              Visible to {notePlayer?.display_name} and their parent/guardian in Progress — not
              paywalled, and not visible to any other coach.
            </Text>
            {loadingNote ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <TextInput
                style={[styles.input, styles.noteInput]}
                value={noteText}
                onChangeText={setNoteText}
                placeholder="e.g. Consistent with extra reps, great teammate, ready for varsity minutes."
                placeholderTextColor={colors.textMuted}
                multiline
                numberOfLines={4}
              />
            )}
            <View style={styles.editButtonRow}>
              <Pressable
                style={[styles.smallButton, styles.smallButtonSecondary]}
                onPress={() => setNotePlayer(null)}
              >
                <Text style={styles.smallButtonSecondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.smallButton, (loadingNote || savingNote) && styles.buttonDisabled]}
                onPress={handleSaveNote}
                disabled={loadingNote || savingNote}
              >
                {savingNote ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.smallButtonText}>Save</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {statsPlayer ? (
        <CoachPlayerStatsModal
          playerId={statsPlayer.id}
          playerName={statsPlayer.display_name}
          onClose={() => setStatsPlayer(null)}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  error: { color: '#C4362B', fontSize: 13 },
  emptyState: { gap: 12 },
  teamNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  teamName: { fontSize: 20, fontWeight: '700', color: colors.text },
  editLink: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  editRow: {
    gap: 8,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#FFF8EA',
  },
  editButtonRow: { flexDirection: 'row', gap: 8 },
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
  inviteCard: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    padding: 20,
    gap: 4,
  },
  inviteLabel: { color: '#FFFFFF', fontSize: 14, opacity: 0.9 },
  inviteCodeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  inviteCode: {
    color: colors.accent,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 2,
  },
  inviteShareIcon: { fontSize: 20 },
  invitePlaceholder: { color: '#FFFFFF', fontSize: 12, opacity: 0.85, marginTop: 4 },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    backgroundColor: colors.surface,
    gap: 12,
  },
  settingText: { flex: 1, gap: 2 },
  settingLabel: { fontSize: 14, fontWeight: '700', color: colors.text },
  settingBody: { fontSize: 12, color: colors.textMuted, lineHeight: 16 },
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
  noteInput: { minHeight: 100, textAlignVertical: 'top' },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  rosterRow: {
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
  rosterName: { fontSize: 15, fontWeight: '600', color: colors.text },
  rosterLinks: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  statsLink: { fontSize: 13, fontWeight: '600', color: colors.accentDark },
  noteLink: { fontSize: 13, fontWeight: '600', color: colors.primary },
  drillRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    gap: 6,
  },
  drillRowAssigned: {
    borderColor: colors.accent,
    backgroundColor: '#FFF8EA',
  },
  drillRowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  drillRowText: { flex: 1, marginRight: 12 },
  drillName: { fontSize: 15, fontWeight: '600', color: colors.text },
  drillCategory: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  assignTag: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  assignedTag: { color: colors.accentDark, fontSize: 13, fontWeight: '700' },
  scheduleLink: { color: colors.primary, fontSize: 13, fontWeight: '600' },
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
