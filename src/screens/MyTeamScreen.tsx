import { useCallback, useEffect, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
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
import WeekDotsRow from '../components/WeekDotsRow';
import { DEFAULT_DRILL_MINUTES, Drill } from '../lib/players';
import {
  assignDrillToPlayer,
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
  subscribeToRosterCompletions,
  Team,
  unassignDrill,
  updateAssignmentSchedule,
} from '../lib/team';
import { startInSeason, startOffseason, undoSeasonSwitch } from '../lib/seasons';

// How many roster-activity rows show on the main screen before "View all"
// is needed — real scaling problem Jay caught, Sept 5, 2026: with 15
// players logging drills weekly, this feed grew unbounded and pushed
// everything else on the tab down with it. Same fix shape applies to the
// roster list and the drill library below — collapse to a summary on the
// main screen, full detail in a popup.
const ACTIVITY_PREVIEW_COUNT = 5;

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
  const navigation = useNavigation();
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
  // Android-only: `display="default"` is an imperative native dialog, not
  // a persistent inline widget — the real bug Jay hit ("switch to keyboard
  // entry, it reverts back to the analog clock"), traced properly this
  // time (the earlier Modal-mount fix was a red herring; this bug predates
  // it). Feeding the picker's own onChange value back into its `value`
  // prop made the native dialog reopen on every pick, each time resetting
  // to its default (analog) view — discarding whatever entry mode the
  // user had switched to. Gates the dialog to open once per tap, close
  // immediately after any event, matching how every other Android time
  // field actually behaves (tap → dialog → pick → closed, showing the
  // result) instead of trying to keep it open as a live inline control.
  const [showAndroidTimePicker, setShowAndroidTimePicker] = useState(false);
  const [pickerDuration, setPickerDuration] = useState(String(DEFAULT_DRILL_MINUTES));
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [notePlayer, setNotePlayer] = useState<RosterPlayer | null>(null);
  const [noteText, setNoteText] = useState('');
  const [loadingNote, setLoadingNote] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [statsPlayer, setStatsPlayer] = useState<RosterPlayer | null>(null);

  // Popup state for the redesigned Roster/Drills/Activity sections —
  // real scaling fix Jay asked for, Sept 5, 2026: none of these render
  // inline on the main screen anymore once a team has real size.
  const [showRosterModal, setShowRosterModal] = useState(false);
  // Real UX ask, Sept 6, 2026: Stats/Note/Message from inside the Roster
  // popup have to close it first (the modal-stacking fix above), but that
  // shouldn't mean re-tapping "Roster" from scratch every time a coach
  // wants to check a few players in a row. Set alongside closing Roster
  // for any of those 3 actions; consumed (and cleared) the moment Roster
  // actually reopens, whether that's via Stats/Note's own close handler
  // or, for Message, the focus-effect below firing when this tab regains
  // focus after the coach comes back from Team Chat.
  const [reopenRosterAfterClose, setReopenRosterAfterClose] = useState(false);
  const [showActivityModal, setShowActivityModal] = useState(false);
  // Two-step assign flow: null = closed; a Drill = picking who ("Whole
  // Team" or specific players) for that drill.
  const [browsingDrills, setBrowsingDrills] = useState(false);
  const [pickingTargetFor, setPickingTargetFor] = useState<Drill | null>(null);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState(false);

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

  // Reopens Roster after a coach comes back from messaging a player —
  // Stats/Note reopen it directly from their own close handler (no
  // navigation involved), but Message leaves this screen entirely for the
  // Team Chat tab, so there's no "close" moment to hook here other than
  // this tab regaining focus. Deliberately a separate effect from the one
  // above (which always reruns `load` on focus) — this one only needs to
  // act when reopenRosterAfterClose is actually true, and including it in
  // deps keeps the callback fresh instead of capturing a stale flag value.
  useFocusEffect(
    useCallback(() => {
      if (reopenRosterAfterClose) {
        setReopenRosterAfterClose(false);
        setShowRosterModal(true);
      }
    }, [reopenRosterAfterClose])
  );

  // Keeps the Team Overview dots (and the roster activity feed) live while
  // a coach stays on this tab — useFocusEffect above only refires on
  // tab-switch, which misses a player logging a drill elsewhere on the
  // same account without ever leaving My Team. Only subscribes once a team
  // exists (nothing to watch for before that); re-subscribes if the team
  // itself changes (rare, but a stale channel from a deleted team is worse
  // than one extra subscribe call).
  useEffect(() => {
    if (!team) return;
    const channel = subscribeToRosterCompletions(load);
    return () => {
      channel.unsubscribe();
    };
  }, [team?.id, load]);

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

  const handleShareInviteCode = (code: string) => {
    Share.share({ message: `Join my DrillStreak team with invite code: ${code}` });
  };

  const [copiedCode, setCopiedCode] = useState(false);

  // Real gap Jay caught: the share sheet's own "Copy" action copies
  // Share.share's whole `message` string (the full sentence), since
  // Share only ever carries one payload used for every destination —
  // there's no way to give the sheet's Copy action different content
  // than Messages/Mail get. A dedicated button using expo-clipboard is
  // the only way to copy just the code.
  const handleCopyInviteCode = async (code: string) => {
    await Clipboard.setStringAsync(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
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

  const [switchingSeason, setSwitchingSeason] = useState(false);
  // Shared label typed once, applied to every roster player's new season —
  // real gap Jay caught: the backend always took a custom label, nothing
  // in this screen ever let a coach type one before switching.
  const [teamSeasonLabel, setTeamSeasonLabel] = useState('');

  // Bulk-applies to every roster player at once, not a single team-level
  // flag — seasons are per-player (see schema.sql), so "switch the team's
  // season" really means looping the same per-player switch over the
  // whole roster. Deliberately worded to reassure, not warn: nothing gets
  // deleted, every player's stats stay saved and viewable under their own
  // season label afterward — see DRILLSTREAK.md's Phase 3 scoping note for
  // why this had to NOT sound like a delete confirmation.
  const handleSwitchTeamSeason = (toOffseason: boolean) => {
    if (roster.length === 0) return;
    Alert.alert(
      toOffseason ? 'Start offseason for the whole team?' : 'Start a new season for the whole team?',
      "Every player's stats stay saved — nobody's history is deleted, you can look back at any past season anytime from Progress.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: toOffseason ? 'Start Offseason' : 'Start New Season',
          onPress: async () => {
            setSwitchingSeason(true);
            setError(null);
            try {
              const action = toOffseason ? startOffseason : startInSeason;
              const results = await Promise.all(roster.map((p) => action(p.id, teamSeasonLabel)));
              setTeamSeasonLabel('');
              // Same fail-safe as the individual switch on Add a Player,
              // scoped to whichever players in this batch actually had a
              // season to close (a player on their very first-ever toggle
              // has no closedSeason and is left out — nothing to reopen).
              const undoablePairs = results
                .map((r) => (r.closedSeason ? { previousId: r.closedSeason.id, newId: r.newSeason.id } : null))
                .filter((r): r is { previousId: string; newId: string } => r != null);
              Alert.alert(
                'Done',
                toOffseason ? 'Offseason started for the whole team.' : 'New season started for the whole team.',
                undoablePairs.length > 0
                  ? [
                      {
                        text: 'Undo for whole team',
                        onPress: async () => {
                          try {
                            await Promise.all(undoablePairs.map((p) => undoSeasonSwitch(p.previousId, p.newId)));
                            Alert.alert('Undone', 'Back to the previous season for everyone.');
                          } catch (e) {
                            Alert.alert(
                              'Could not undo',
                              e instanceof Error ? e.message : 'Something went wrong — some players may not have reverted.'
                            );
                          }
                        },
                      },
                      { text: 'OK', style: 'cancel' },
                    ]
                  : undefined
              );
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Failed to switch season for one or more players.');
            } finally {
              setSwitchingSeason(false);
            }
          },
        },
      ]
    );
  };

  // Shared close logic for Stats/Note, so "reopen Roster after this
  // closes" only has to be handled in one place per modal rather than at
  // every button/onRequestClose that can dismiss it.
  const closeStatsPlayer = () => {
    setStatsPlayer(null);
    if (reopenRosterAfterClose) {
      setReopenRosterAfterClose(false);
      setShowRosterModal(true);
    }
  };

  const closeNotePlayer = () => {
    setNotePlayer(null);
    if (reopenRosterAfterClose) {
      setReopenRosterAfterClose(false);
      setShowRosterModal(true);
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
      closeNotePlayer();
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
    // Android's dialog opens on demand (see showAndroidTimePicker above) —
    // start each new scheduler visit ready for the user to tap "Change
    // time" rather than popping the native dialog open immediately.
    setShowAndroidTimePicker(false);
  };

  const handlePickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    // Always close the native Android dialog after any event — leaving it
    // "open" (rendered) is what caused the reopen-on-every-pick loop.
    setShowAndroidTimePicker(false);
    if (Platform.OS === 'android' && event.type === 'dismissed') {
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

  // Opens the "who is this for" step, one drill at a time — Jay's exact
  // ask, Sept 5, 2026: a coach picks a drill, then chooses Whole Team or
  // specific players, "in addition to" team-wide, not instead of.
  const openTargetPicker = (drill: Drill) => {
    setBrowsingDrills(false);
    setSelectedPlayerIds(new Set());
    setPickingTargetFor(drill);
  };

  const togglePlayerSelection = (playerId: string) => {
    setSelectedPlayerIds((current) => {
      const next = new Set(current);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  };

  const handleAssignToTeam = async () => {
    if (!team || !pickingTargetFor) return;
    setAssigning(true);
    setError(null);
    try {
      await assignDrillToTeam(team.id, pickingTargetFor.id);
      setAssignedDrills(await getWeeklyTeamAssignments(team.id));
      setPickingTargetFor(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to assign drill.');
    } finally {
      setAssigning(false);
    }
  };

  const handleAssignToSelectedPlayers = async () => {
    if (!team || !pickingTargetFor || selectedPlayerIds.size === 0) return;
    setAssigning(true);
    setError(null);
    try {
      await Promise.all(
        Array.from(selectedPlayerIds).map((playerId) =>
          assignDrillToPlayer(team.id, playerId, pickingTargetFor.id)
        )
      );
      setAssignedDrills(await getWeeklyTeamAssignments(team.id));
      setPickingTargetFor(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to assign drill.');
    } finally {
      setAssigning(false);
    }
  };

  const handleUnassign = async (assignmentId: string) => {
    setTogglingDrillId(assignmentId);
    setError(null);
    try {
      await unassignDrill(assignmentId);
      if (team) setAssignedDrills(await getWeeklyTeamAssignments(team.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove assignment.');
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
            <View style={styles.inviteCodeRow}>
              <Text style={styles.inviteCode}>{team.invite_code}</Text>
              <View style={styles.inviteActionRow}>
                <Pressable style={styles.inviteActionButton} onPress={() => handleCopyInviteCode(team.invite_code)}>
                  <Text style={styles.inviteShareIcon}>{copiedCode ? '✓' : '📋'}</Text>
                </Pressable>
                <Pressable style={styles.inviteActionButton} onPress={() => handleShareInviteCode(team.invite_code)}>
                  <Text style={styles.inviteShareIcon}>📤</Text>
                </Pressable>
              </View>
            </View>
            <Text style={styles.invitePlaceholder}>
              Tap 📋 to copy just the code, or 📤 to share the full invite message. Share this
              with every player and parent on your roster — the more of them who join, the more
              accountability data you see on your own roster activity feed below, at no cost to
              you.
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

          <View style={styles.seasonCard}>
            <Text style={styles.settingLabel}>Season</Text>
            <Text style={styles.settingBody}>
              Switches the whole roster between in-season (daily streak) and offseason (weekly
              goals, a personalized focus suggestion). Nothing is ever deleted — every past season
              stays viewable. Every player's own season can still be renamed individually from
              their own Add a Player screen afterward.
            </Text>
            <TextInput
              style={styles.input}
              value={teamSeasonLabel}
              onChangeText={setTeamSeasonLabel}
              placeholder="Season name (optional, e.g. Fall 2026)"
              placeholderTextColor={colors.textMuted}
            />
            <View style={styles.seasonButtonRow}>
              <Pressable
                style={[styles.seasonButton, switchingSeason && styles.buttonDisabled]}
                onPress={() => handleSwitchTeamSeason(true)}
                disabled={switchingSeason || roster.length === 0}
              >
                <Text style={styles.seasonButtonText}>Start Offseason</Text>
              </Pressable>
              <Pressable
                style={[styles.seasonButton, styles.seasonButtonSecondary, switchingSeason && styles.buttonDisabled]}
                onPress={() => handleSwitchTeamSeason(false)}
                disabled={switchingSeason || roster.length === 0}
              >
                {switchingSeason ? (
                  <ActivityIndicator color={colors.primary} size="small" />
                ) : (
                  <Text style={styles.seasonButtonSecondaryText}>Start New Season</Text>
                )}
              </Pressable>
            </View>
          </View>

          {/* Real scaling fix, Sept 5, 2026: Roster, Drills, and Roster
              Activity used to render in full on this one screen — fine at
              a handful of players, a wall of scrolling at 15+. Each now
              collapses to a compact summary here, full detail in its own
              popup, same "compact card, tap for detail" shape the Home
              tab already uses. */}
          <Pressable style={styles.summaryCard} onPress={() => setShowRosterModal(true)}>
            <View style={styles.summaryHeaderRow}>
              <Text style={styles.sectionTitle}>Roster ({roster.length})</Text>
              <Text style={styles.summaryLink}>View →</Text>
            </View>
            <Text style={styles.placeholder}>
              {roster.length === 0
                ? 'No players yet — share your invite code to get started.'
                : `${rosterCompletions.length > 0 ? new Set(rosterCompletions.map((c) => c.playerId)).size : 0} of ${roster.length} logged something this week.`}
            </Text>
          </Pressable>

          <View style={styles.summaryCard}>
            <View style={styles.summaryHeaderRow}>
              <Text style={styles.sectionTitle}>This week's assignments ({assignedDrills.length})</Text>
              <Pressable onPress={() => setBrowsingDrills(true)}>
                <Text style={styles.summaryLink}>+ Assign</Text>
              </Pressable>
            </View>
            {assignedDrills.length === 0 ? (
              <Text style={styles.placeholder}>Nothing assigned yet this week.</Text>
            ) : (
              assignedDrills.map((a) => {
                const scheduleLabel = formatScheduleLabel(a.scheduledTime, a.durationMinutes);
                return (
                  <View key={a.assignmentId} style={styles.drillRow}>
                    <Pressable style={styles.drillRowMain} onPress={() => openScheduler(a)}>
                      <View style={styles.drillRowText}>
                        <Text style={styles.drillName}>{a.name}</Text>
                        <Text style={styles.drillCategory}>
                          {a.playerId ? a.playerName : 'Whole team'}
                          {scheduleLabel ? ` · ⏰ ${scheduleLabel}` : ' · ⏰ Set suggested time'}
                        </Text>
                      </View>
                    </Pressable>
                    <Pressable
                      onPress={() => handleUnassign(a.assignmentId)}
                      hitSlop={8}
                      disabled={togglingDrillId === a.assignmentId}
                    >
                      {togglingDrillId === a.assignmentId ? (
                        <ActivityIndicator color={colors.primary} size="small" />
                      ) : (
                        <Text style={styles.removeAssignmentText}>Remove</Text>
                      )}
                    </Pressable>
                  </View>
                );
              })
            )}
          </View>

          <Pressable style={styles.summaryCard} onPress={() => setShowActivityModal(true)}>
            <View style={styles.summaryHeaderRow}>
              <Text style={styles.sectionTitle}>Roster activity this week</Text>
              {rosterCompletions.length > ACTIVITY_PREVIEW_COUNT ? (
                <Text style={styles.summaryLink}>View all →</Text>
              ) : null}
            </View>
            {rosterCompletions.length === 0 ? (
              <Text style={styles.placeholder}>No completions logged by your roster yet this week.</Text>
            ) : (
              rosterCompletions.slice(0, ACTIVITY_PREVIEW_COUNT).map((c) => (
                <View key={c.id} style={styles.activityRow}>
                  <Text style={styles.activityText}>
                    <Text style={styles.activityPlayer}>{c.playerName}</Text> completed{' '}
                    <Text style={styles.activityDrill}>{c.drillName}</Text>
                  </Text>
                  <Text style={styles.activityDate}>{c.date}</Text>
                </View>
              ))
            )}
          </Pressable>
        </>
      )}

      {/* Deliberately NOT conditionally-mounted like the popups below —
          real regression hit and reverted Sept 6, 2026: Android's
          DateTimePicker with display="default" is an imperative native
          dialog that (re)opens on mount, so unmounting/remounting this
          whole Modal every time schedulingDrill toggled made the native
          time picker pop back up on every open. This modal was never
          reported as having the iOS stuck-popup bug the others below had,
          so it stays on the original always-mounted, visible-toggle
          pattern. Separately, and this was the actual cause of "switch to
          keyboard entry, it reverts to analog clock" (the Modal fix above
          was a red herring for this one) — see showAndroidTimePicker's
          comment near this screen's other state for the real fix. */}
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
            {Platform.OS === 'ios' ? (
              <DateTimePicker value={pickerTime} mode="time" display="spinner" onChange={handlePickerChange} />
            ) : (
              <>
                <Pressable
                  style={[styles.smallButton, styles.standaloneButton]}
                  onPress={() => setShowAndroidTimePicker(true)}
                >
                  <Text style={styles.smallButtonText}>
                    {pickerTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · Change time
                  </Text>
                </Pressable>
                {showAndroidTimePicker && (
                  <DateTimePicker value={pickerTime} mode="time" display="default" onChange={handlePickerChange} />
                )}
              </>
            )}
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

      {notePlayer && (
      <Modal
        visible
        transparent
        animationType="fade"
        onRequestClose={closeNotePlayer}
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
                onPress={closeNotePlayer}
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
      )}

      {showRosterModal && (
      <Modal
        visible
        transparent
        animationType="fade"
        onRequestClose={() => setShowRosterModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.popupCard}>
            <View style={styles.popupHeaderRow}>
              <Text style={styles.modalTitle}>Roster ({roster.length})</Text>
              <Pressable onPress={() => setShowRosterModal(false)} hitSlop={8}>
                <Text style={styles.popupCloseText}>Done</Text>
              </Pressable>
            </View>
            <Text style={styles.placeholder}>
              Green dots show who logged something this week, Mon-Sun. Tap a row (or Stats) for a
              player's full streak/shooting/history. Tap Note to add or edit your note about them.
              Long-press to remove them from the roster.
            </Text>
            <ScrollView style={styles.popupScroll}>
              {roster.map((p) => {
                const datesThisWeek = rosterCompletions.filter((c) => c.playerId === p.id).map((c) => c.date);
                return (
                  <Pressable
                    key={p.id}
                    style={styles.rosterRow}
                    onPress={() => {
                      // Real bug found and fixed Sept 6, 2026: tapping
                      // Stats/Note from inside this popup tried to present
                      // a second native Modal on top of this one — iOS
                      // only tolerates one presented modal at a time, so
                      // the second one silently failed to appear, and it
                      // left the modal stack broken for every popup after
                      // it (Roster/Assign stopped opening at all until a
                      // force-quit). Closing this popup first, same as
                      // Message already effectively does by navigating to
                      // a different tab entirely. reopenRosterAfterClose
                      // is the follow-up UX fix Jay asked for right after:
                      // check a few players' Stats/Notes/Messages back to
                      // back without re-tapping "Roster" every single time.
                      setShowRosterModal(false);
                      setReopenRosterAfterClose(true);
                      setStatsPlayer(p);
                    }}
                    onLongPress={() => handleLongPressRosterPlayer(p)}
                  >
                    <View style={styles.rosterTopRow}>
                      <Text style={styles.rosterName}>{p.display_name}</Text>
                      <View style={styles.rosterLinks}>
                        <Text style={styles.statsLink}>Stats</Text>
                        <Pressable
                          onPress={() => {
                            setShowRosterModal(false);
                            setReopenRosterAfterClose(true);
                            openNoteEditor(p);
                          }}
                          hitSlop={8}
                        >
                          <Text style={styles.noteLink}>Note</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => {
                            setShowRosterModal(false);
                            setReopenRosterAfterClose(true);
                            (navigation.navigate as (name: never, params?: object) => void)('Team Chat' as never, {
                              teamId: team?.id,
                              threadUserId: p.contactUserId,
                              view: 'messages',
                            });
                          }}
                          hitSlop={8}
                        >
                          <Text style={styles.messageLink}>Message</Text>
                        </Pressable>
                      </View>
                    </View>
                    <WeekDotsRow completedDates={datesThisWeek} />
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
      )}

      {showActivityModal && (
      <Modal
        visible
        transparent
        animationType="fade"
        onRequestClose={() => setShowActivityModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.popupCard}>
            <View style={styles.popupHeaderRow}>
              <Text style={styles.modalTitle}>Roster activity this week</Text>
              <Pressable onPress={() => setShowActivityModal(false)} hitSlop={8}>
                <Text style={styles.popupCloseText}>Done</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.popupScroll}>
              {rosterCompletions.map((c) => (
                <View key={c.id} style={styles.activityRow}>
                  <Text style={styles.activityText}>
                    <Text style={styles.activityPlayer}>{c.playerName}</Text> completed{' '}
                    <Text style={styles.activityDrill}>{c.drillName}</Text>
                  </Text>
                  <Text style={styles.activityDate}>{c.date}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
      )}

      {browsingDrills && (
      <Modal
        visible
        transparent
        animationType="fade"
        onRequestClose={() => setBrowsingDrills(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.popupCard}>
            <View style={styles.popupHeaderRow}>
              <Text style={styles.modalTitle}>Assign a drill</Text>
              <Pressable onPress={() => setBrowsingDrills(false)} hitSlop={8}>
                <Text style={styles.popupCloseText}>Cancel</Text>
              </Pressable>
            </View>
            <Text style={styles.placeholder}>Pick a drill, then choose who it's for.</Text>
            <ScrollView style={styles.popupScroll}>
              {availableDrills.map((drill) => (
                <Pressable key={drill.id} style={styles.drillRow} onPress={() => openTargetPicker(drill)}>
                  <View style={styles.drillRowMain}>
                    <View style={styles.drillRowText}>
                      <Text style={styles.drillName}>{drill.name}</Text>
                      {drill.category ? <Text style={styles.drillCategory}>{drill.category}</Text> : null}
                    </View>
                    <Text style={styles.assignTag}>Assign →</Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
      )}

      {pickingTargetFor && (
      <Modal
        visible
        transparent
        animationType="fade"
        onRequestClose={() => setPickingTargetFor(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.popupCard}>
            <View style={styles.popupHeaderRow}>
              <Text style={styles.modalTitle}>{pickingTargetFor?.name}</Text>
              <Pressable onPress={() => setPickingTargetFor(null)} hitSlop={8}>
                <Text style={styles.popupCloseText}>Cancel</Text>
              </Pressable>
            </View>
            <Text style={styles.placeholder}>Assign this drill to the whole team, or check off specific players.</Text>
            <Pressable
              style={[styles.smallButton, styles.standaloneButton, assigning && styles.buttonDisabled]}
              onPress={handleAssignToTeam}
              disabled={assigning}
            >
              {assigning ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.smallButtonText}>Whole Team</Text>}
            </Pressable>
            <Text style={[styles.modalLabel, { marginTop: 14 }]}>Or specific players</Text>
            <ScrollView style={styles.popupScroll}>
              {roster.map((p) => {
                const checked = selectedPlayerIds.has(p.id);
                return (
                  <Pressable
                    key={p.id}
                    style={[styles.playerCheckRow, checked && styles.playerCheckRowSelected]}
                    onPress={() => togglePlayerSelection(p.id)}
                  >
                    <Text style={styles.rosterName}>{p.display_name}</Text>
                    <Text style={checked ? styles.assignedTag : styles.assignTag}>{checked ? '✓ Selected' : 'Select'}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable
              style={[
                styles.smallButton,
                styles.standaloneButton,
                (assigning || selectedPlayerIds.size === 0) && styles.buttonDisabled,
              ]}
              onPress={handleAssignToSelectedPlayers}
              disabled={assigning || selectedPlayerIds.size === 0}
            >
              {assigning ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.smallButtonText}>
                  Assign to {selectedPlayerIds.size} {selectedPlayerIds.size === 1 ? 'player' : 'players'}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
      )}

      {statsPlayer ? (
        <CoachPlayerStatsModal
          playerId={statsPlayer.id}
          playerName={statsPlayer.display_name}
          onClose={closeStatsPlayer}
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
  // Real bug found and fixed Sept 6, 2026, after multiple wrong guesses —
  // this was the actual cause of the "blank button" reports the whole
  // time, not a Modal/animation issue. smallButton's `flex: 1` only makes
  // sense paired inside editButtonRow (flexDirection: 'row', two buttons
  // splitting the width). Used standalone in a column container (the
  // "Change time" button, "Whole Team", "Assign to N players"), flex: 1
  // instead stretches the button to fill all remaining VERTICAL space in
  // the popup — a giant blue rectangle with the text lost somewhere
  // inside it, not actually blank. Override back to a normal button.
  standaloneButton: { flex: 0 },
  smallButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  smallButtonSecondaryText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  inviteCard: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    padding: 20,
    gap: 4,
  },
  inviteLabel: { color: '#FFFFFF', fontSize: 14, opacity: 0.9 },
  inviteCodeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  inviteCode: {
    color: colors.accent,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 2,
  },
  inviteActionRow: { flexDirection: 'row', gap: 14 },
  inviteActionButton: { padding: 4 },
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
  seasonCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    backgroundColor: colors.surface,
    gap: 6,
  },
  seasonButtonRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  seasonButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  seasonButtonSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  seasonButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  seasonButtonSecondaryText: { color: colors.text, fontSize: 13, fontWeight: '600' },
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
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.surface,
  },
  rosterTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rosterName: { fontSize: 15, fontWeight: '600', color: colors.text },
  rosterLinks: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  statsLink: { fontSize: 13, fontWeight: '600', color: colors.accentDark },
  noteLink: { fontSize: 13, fontWeight: '600', color: colors.primary },
  messageLink: { fontSize: 13, fontWeight: '600', color: colors.accentDark },
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
  summaryCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    backgroundColor: colors.surface,
    gap: 6,
  },
  summaryHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryLink: { fontSize: 13, fontWeight: '600', color: colors.accentDark },
  popupCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    gap: 8,
    maxHeight: '85%',
  },
  popupHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  popupCloseText: { fontSize: 14, fontWeight: '600', color: colors.primary },
  // Real bug found Sept 6, 2026 on Jay's re-test: no flex meant this
  // ScrollView just grew to fit its content instead of shrinking inside
  // popupCard's maxHeight — with more than a couple players, the roster
  // checklist pushed pickingTargetFor's own "Assign to N players" button
  // (and Roster/Activity/browsingDrills's own content) off the bottom of
  // the screen instead of becoming scrollable in the remaining space.
  popupScroll: { marginTop: 4, flexShrink: 1 },
  removeAssignmentText: { fontSize: 13, fontWeight: '600', color: '#C4362B' },
  playerCheckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.background,
    marginBottom: 8,
  },
  playerCheckRowSelected: { borderColor: colors.accent, backgroundColor: '#FFF8EA' },
});
