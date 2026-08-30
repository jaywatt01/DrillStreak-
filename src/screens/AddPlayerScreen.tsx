import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { useParentEntitlement } from '../lib/purchases';
import { getInstitutionalAccessByPlayer } from '../lib/institutionalAccess';
import {
  addCustomDrill,
  addPlayer,
  CustomDrill,
  DEFAULT_DRILL_MINUTES,
  deleteDrill,
  deletePlayer,
  getMyCustomDrills,
  listMyPlayers,
  Player,
  renameDrill,
  updatePlayerProfile,
} from '../lib/players';
import { joinTeamByInviteCode } from '../lib/team';
import { defaultLabel, getActiveSeason, renameSeason, Season, startInSeason, startOffseason, summarizeSeason, undoSeasonSwitch } from '../lib/seasons';

export default function AddPlayerScreen() {
  const navigation = useNavigation();
  const { hasParentTier: hasPurchasedParentTier } = useParentEntitlement();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  // True if ANY existing player is on a team with an active Team/Program
  // plan — unlocks unlimited players for the whole account, same as
  // parent_tier, without needing an individual RevenueCat purchase. See
  // src/lib/institutionalAccess.ts.
  const [hasInstitutionalAccess, setHasInstitutionalAccess] = useState(false);
  const hasParentTier = hasPurchasedParentTier || hasInstitutionalAccess;
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

  const [newPlayerName, setNewPlayerName] = useState('');
  // Defaults to false (someone else, e.g. a parent adding their kid) —
  // the more common real case for this app. Drives whether this account
  // gets the Team Chat coach-DM-only restriction (schema.sql's
  // is_player_restricted) once this player joins a team.
  const [newPlayerIsMe, setNewPlayerIsMe] = useState(false);
  const [addingPlayer, setAddingPlayer] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);

  const [renamingPlayerId, setRenamingPlayerId] = useState<string | null>(null);
  const [renamePlayerText, setRenamePlayerText] = useState('');
  const [editHeight, setEditHeight] = useState('');
  const [editWeight, setEditWeight] = useState('');
  const [editGradYear, setEditGradYear] = useState('');
  const [editPosition, setEditPosition] = useState('');
  const [editStatsVisible, setEditStatsVisible] = useState(true);
  const [savingPlayerEdit, setSavingPlayerEdit] = useState(false);

  const [seasonPlayerId, setSeasonPlayerId] = useState<string | null>(null);
  const [currentSeason, setCurrentSeason] = useState<Season | null>(null);
  const [loadingSeason, setLoadingSeason] = useState(false);
  const [renameSeasonText, setRenameSeasonText] = useState('');
  const [savingSeasonRename, setSavingSeasonRename] = useState(false);
  const [newSeasonLabel, setNewSeasonLabel] = useState('');
  const [switchingSeason, setSwitchingSeason] = useState(false);

  const [inviteCode, setInviteCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinSuccess, setJoinSuccess] = useState<string | null>(null);

  const [drillName, setDrillName] = useState('');
  const [drillCategory, setDrillCategory] = useState('');
  const [drillMinutes, setDrillMinutes] = useState('');
  const [drillVideoUrl, setDrillVideoUrl] = useState('');
  const [addingDrill, setAddingDrill] = useState(false);
  const [drillError, setDrillError] = useState<string | null>(null);
  const [drillSuccess, setDrillSuccess] = useState<string | null>(null);

  const [customDrills, setCustomDrills] = useState<CustomDrill[]>([]);
  const [renamingDrillId, setRenamingDrillId] = useState<string | null>(null);
  const [renameDrillName, setRenameDrillName] = useState('');
  const [renameDrillCategory, setRenameDrillCategory] = useState('');
  const [renameDrillVideoUrl, setRenameDrillVideoUrl] = useState('');
  const [savingDrillEdit, setSavingDrillEdit] = useState(false);

  const load = useCallback(async () => {
    try {
      const myPlayers = await listMyPlayers();
      setPlayers(myPlayers);
      setSelectedPlayerId((current) =>
        current && myPlayers.some((p) => p.id === current) ? current : myPlayers[0]?.id ?? null
      );
      const institutionalAccessByPlayer = await getInstitutionalAccessByPlayer(
        myPlayers.map((p) => p.id)
      );
      setHasInstitutionalAccess(Object.values(institutionalAccessByPlayer).some(Boolean));
    } catch (e) {
      setPlayerError(e instanceof Error ? e.message : 'Failed to load players.');
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

  const loadCustomDrills = useCallback(async (playerId: string) => {
    try {
      setCustomDrills(await getMyCustomDrills(playerId));
    } catch (e) {
      setDrillError(e instanceof Error ? e.message : 'Failed to load custom drills.');
    }
  }, []);

  useEffect(() => {
    if (selectedPlayerId) {
      loadCustomDrills(selectedPlayerId);
    } else {
      setCustomDrills([]);
    }
  }, [selectedPlayerId, loadCustomDrills]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
    if (selectedPlayerId) loadCustomDrills(selectedPlayerId);
  };

  const handleAddPlayer = async () => {
    if (!newPlayerName.trim()) return;
    if (!hasParentTier && players.length >= 1) {
      Alert.alert(
        'Free plan limit reached',
        'Free accounts can link one player. Parent membership ($4.99/mo) unlocks unlimited linked players.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'See Account', onPress: () => navigation.navigate('Account' as never) },
        ]
      );
      return;
    }
    setAddingPlayer(true);
    setPlayerError(null);
    try {
      const player = await addPlayer(newPlayerName.trim(), newPlayerIsMe);
      setNewPlayerName('');
      setNewPlayerIsMe(false);
      await load();
      setSelectedPlayerId(player.id);
    } catch (e) {
      setPlayerError(e instanceof Error ? e.message : 'Failed to add player.');
    } finally {
      setAddingPlayer(false);
    }
  };

  // Individual season control for a self-tracked player with no coach to
  // do this for them — opens an inline editor (same pattern as Edit
  // Profile/drill rename on this screen, not a bare Alert) so the season's
  // name is actually visible and editable, not just an auto-generated
  // label with no way to change it. Real gap Jay caught: the backend
  // always supported a custom label (switchSeason's optional `label`
  // param), nothing in the UI ever exposed it.
  const openSeasonEditor = async (player: Player) => {
    setSeasonPlayerId(player.id);
    setCurrentSeason(null);
    setLoadingSeason(true);
    try {
      const active = await getActiveSeason(player.id);
      setCurrentSeason(active);
      setRenameSeasonText(active?.label ?? '');
      setNewSeasonLabel(defaultLabel(!(active?.isOffseason ?? false)));
    } catch (e) {
      setPlayerError(e instanceof Error ? e.message : 'Failed to load season.');
      setSeasonPlayerId(null);
    } finally {
      setLoadingSeason(false);
    }
  };

  const handleSaveSeasonRename = async () => {
    if (!currentSeason || !renameSeasonText.trim()) return;
    setSavingSeasonRename(true);
    try {
      await renameSeason(currentSeason.id, renameSeasonText.trim());
      setCurrentSeason({ ...currentSeason, label: renameSeasonText.trim() });
    } catch (e) {
      Alert.alert('Could not rename season', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSavingSeasonRename(false);
    }
  };

  // Fail-safe for a mistaken toggle (Jay-requested, 2026-08-25): offered
  // right on the recap alert, the one moment right after a switch where
  // "undo" still means something simple — reopen what just closed, drop
  // what was just created. Not offered on the very-first-ever toggle for a
  // player (no closedSeason, nothing to reopen to) — that's a
  // deliberately narrower case than the general "delete a season" feature
  // in Progress, see seasons.ts's deleteSeason/undoSeasonSwitch comments.
  const handleUndoSwitch = async (previousSeasonId: string, newSeasonId: string) => {
    try {
      await undoSeasonSwitch(previousSeasonId, newSeasonId);
      Alert.alert('Undone', 'Back to the previous season — nothing changed.');
    } catch (e) {
      Alert.alert('Could not undo', e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  const handleSwitchSeason = () => {
    if (!seasonPlayerId) return;
    const toOffseason = !(currentSeason?.isOffseason ?? false);
    Alert.alert(
      toOffseason ? 'Start offseason?' : 'Start a new season?',
      "Your stats stay saved — nothing is deleted, you can look back at any past season anytime from Progress.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: toOffseason ? 'Start Offseason' : 'Start New Season',
          onPress: async () => {
            const playerId = seasonPlayerId;
            setSwitchingSeason(true);
            try {
              const result = toOffseason
                ? await startOffseason(playerId, newSeasonLabel)
                : await startInSeason(playerId, newSeasonLabel);
              setSeasonPlayerId(null);
              if (result.closedSeason) {
                // The recap — shown right here, the one moment "a season
                // just closed" is actually true, not a separate screen
                // someone has to remember to go check.
                const summary = await summarizeSeason(playerId, result.closedSeason.id);
                const shootingLine = summary.shooting
                  ? `Shooting: ${summary.shooting.makes}/${summary.shooting.attempts} (${Math.round((summary.shooting.makes / summary.shooting.attempts) * 100)}%)\n`
                  : '';
                const ftLine = summary.freeThrows
                  ? `Free throws: ${summary.freeThrows.makes}/${summary.freeThrows.attempts} (${Math.round((summary.freeThrows.makes / summary.freeThrows.attempts) * 100)}%)\n`
                  : '';
                Alert.alert(
                  `${result.closedSeason.label} — recap`,
                  `Best streak: ${summary.bestStreak} ${summary.bestStreak === 1 ? 'day' : 'days'}\n${shootingLine}${ftLine}Total reps: ${summary.totalReps}\n\nSaved for good — see it anytime in Progress under Season History.`,
                  [
                    {
                      text: 'Undo this switch',
                      onPress: () => handleUndoSwitch(result.closedSeason!.id, result.newSeason.id),
                    },
                    { text: 'OK', style: 'cancel' },
                  ]
                );
              } else {
                Alert.alert('Done', toOffseason ? 'Offseason started.' : 'New season started.');
              }
            } catch (e) {
              Alert.alert('Could not switch season', e instanceof Error ? e.message : 'Something went wrong.');
            } finally {
              setSwitchingSeason(false);
            }
          },
        },
      ]
    );
  };

  const handleLongPressPlayer = (player: Player) => {
    Alert.alert(player.display_name, 'What would you like to do?', [
      {
        text: 'Edit Profile',
        onPress: () => {
          setRenamingPlayerId(player.id);
          setRenamePlayerText(player.display_name);
          setEditHeight(player.height ?? '');
          setEditWeight(player.weight ?? '');
          setEditGradYear(player.grad_year != null ? String(player.grad_year) : '');
          setEditPosition(player.position ?? '');
          setEditStatsVisible(player.stats_visible_to_team);
        },
      },
      { text: 'Season', onPress: () => openSeasonEditor(player) },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          Alert.alert(
            `Delete ${player.display_name}?`,
            'This removes their profile and all their logged history. This can\'t be undone.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  try {
                    await deletePlayer(player.id);
                    await load();
                  } catch (e) {
                    setPlayerError(e instanceof Error ? e.message : 'Failed to delete player.');
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

  const handleSaveProfileEdit = async () => {
    if (!renamingPlayerId || !renamePlayerText.trim()) return;
    const parsedGradYear = parseInt(editGradYear, 10);
    setSavingPlayerEdit(true);
    setPlayerError(null);
    try {
      await updatePlayerProfile(renamingPlayerId, {
        displayName: renamePlayerText.trim(),
        height: editHeight.trim() || null,
        weight: editWeight.trim() || null,
        gradYear: editGradYear.trim() && Number.isFinite(parsedGradYear) ? parsedGradYear : null,
        position: editPosition.trim() || null,
        statsVisibleToTeam: editStatsVisible,
      });
      setRenamingPlayerId(null);
      await load();
    } catch (e) {
      setPlayerError(e instanceof Error ? e.message : 'Failed to save profile.');
    } finally {
      setSavingPlayerEdit(false);
    }
  };

  const handleJoinTeam = async () => {
    if (!selectedPlayerId || !inviteCode.trim()) return;
    setJoining(true);
    setJoinError(null);
    setJoinSuccess(null);
    try {
      await joinTeamByInviteCode(inviteCode.trim(), selectedPlayerId);
      setInviteCode('');
      setJoinSuccess('Joined the team! Check the Home tab for this week\'s assigned drills.');
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : 'Failed to join team.');
    } finally {
      setJoining(false);
    }
  };

  const handleAddDrill = async () => {
    if (!drillName.trim() || !selectedPlayerId) return;
    const parsedMinutes = parseInt(drillMinutes, 10);
    const estimatedMinutes = drillMinutes.trim() && Number.isFinite(parsedMinutes) && parsedMinutes > 0
      ? parsedMinutes
      : null;
    setAddingDrill(true);
    setDrillError(null);
    setDrillSuccess(null);
    try {
      const drill = await addCustomDrill(
        drillName.trim(),
        drillCategory.trim(),
        selectedPlayerId,
        estimatedMinutes,
        drillVideoUrl.trim() || null
      );
      setDrillName('');
      setDrillCategory('');
      setDrillMinutes('');
      setDrillVideoUrl('');
      const playerName = players.find((p) => p.id === selectedPlayerId)?.display_name;
      setDrillSuccess(`Added "${drill.name}" to ${playerName ?? 'their'}'s drill library.`);
      await loadCustomDrills(selectedPlayerId);
    } catch (e) {
      setDrillError(e instanceof Error ? e.message : 'Failed to add drill.');
    } finally {
      setAddingDrill(false);
    }
  };

  const handleLongPressDrill = (drill: CustomDrill) => {
    Alert.alert(drill.name, 'What would you like to do?', [
      {
        text: 'Rename',
        onPress: () => {
          setRenamingDrillId(drill.id);
          setRenameDrillName(drill.name);
          setRenameDrillCategory(drill.category ?? '');
          setRenameDrillVideoUrl(drill.videoUrl ?? '');
        },
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          Alert.alert('Delete this drill?', `Removes "${drill.name}" from the drill library.`, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: async () => {
                try {
                  await deleteDrill(drill.id);
                  if (selectedPlayerId) await loadCustomDrills(selectedPlayerId);
                } catch (e) {
                  setDrillError(e instanceof Error ? e.message : 'Failed to delete drill.');
                }
              },
            },
          ]);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleSaveDrillRename = async () => {
    if (!renamingDrillId || !renameDrillName.trim()) return;
    setSavingDrillEdit(true);
    setDrillError(null);
    try {
      await renameDrill(
        renamingDrillId,
        renameDrillName.trim(),
        renameDrillCategory.trim(),
        renameDrillVideoUrl.trim()
      );
      setRenamingDrillId(null);
      if (selectedPlayerId) await loadCustomDrills(selectedPlayerId);
    } catch (e) {
      setDrillError(e instanceof Error ? e.message : 'Failed to rename drill.');
    } finally {
      setSavingDrillEdit(false);
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
      <Text style={styles.sectionTitle}>Your players</Text>
      {playerError ? <Text style={styles.error}>{playerError}</Text> : null}
      {players.length === 0 ? (
        <Text style={styles.placeholder}>No players linked yet — add one below.</Text>
      ) : (
        <>
          <Text style={styles.placeholder}>
            Tap a player to select them — joining a team and adding a custom
            drill below both apply to whoever's selected. Long-press a
            player to edit their profile or delete them.
          </Text>
          <View style={styles.chipRow}>
            {players.map((p) => (
              <Pressable
                key={p.id}
                style={[styles.chip, selectedPlayerId === p.id && styles.chipSelected]}
                onPress={() => setSelectedPlayerId(p.id)}
                onLongPress={() => handleLongPressPlayer(p)}
              >
                <Text
                  style={[styles.chipText, selectedPlayerId === p.id && styles.chipTextSelected]}
                >
                  {p.display_name}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      {renamingPlayerId ? (
        <View style={styles.editRow}>
          <TextInput
            style={styles.input}
            value={renamePlayerText}
            onChangeText={setRenamePlayerText}
            placeholder="Player name"
            placeholderTextColor={colors.textMuted}
          />
          <Text style={styles.editRowLabel}>
            Optional — shows on their profile in Progress, blank fields just don't show.
          </Text>
          <TextInput
            style={styles.input}
            value={editPosition}
            onChangeText={setEditPosition}
            placeholder="Position (e.g. Point Guard)"
            placeholderTextColor={colors.textMuted}
          />
          <TextInput
            style={styles.input}
            value={editHeight}
            onChangeText={setEditHeight}
            placeholder={'Height (e.g. 6\'2")'}
            placeholderTextColor={colors.textMuted}
          />
          <TextInput
            style={styles.input}
            value={editWeight}
            onChangeText={setEditWeight}
            placeholder="Weight (e.g. 165 lbs)"
            placeholderTextColor={colors.textMuted}
          />
          <TextInput
            style={styles.input}
            value={editGradYear}
            onChangeText={setEditGradYear}
            placeholder="Graduation year (e.g. 2027)"
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
          />
          <View style={styles.visibilityRow}>
            <View style={styles.visibilityText}>
              <Text style={styles.visibilityLabel}>Visible to teammates</Text>
              <Text style={styles.editRowLabel}>
                Lets teammates on the same team see this stats/bio, same as a coach already can.
                Off keeps it private — only you and the coach see it.
              </Text>
            </View>
            <Switch value={editStatsVisible} onValueChange={setEditStatsVisible} trackColor={{ true: colors.primary }} />
          </View>
          <View style={styles.editButtonRow}>
            <Pressable
              style={[styles.smallButton, styles.smallButtonSecondary]}
              onPress={() => setRenamingPlayerId(null)}
            >
              <Text style={styles.smallButtonSecondaryText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[
                styles.smallButton,
                (!renamePlayerText.trim() || savingPlayerEdit) && styles.buttonDisabled,
              ]}
              onPress={handleSaveProfileEdit}
              disabled={!renamePlayerText.trim() || savingPlayerEdit}
            >
              {savingPlayerEdit ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.smallButtonText}>Save</Text>
              )}
            </Pressable>
          </View>
        </View>
      ) : null}

      {seasonPlayerId ? (
        <View style={styles.editRow}>
          {loadingSeason ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <>
              {currentSeason ? (
                <>
                  <Text style={styles.editRowLabel}>
                    Currently {currentSeason.isOffseason ? 'in the offseason' : 'in-season'} — rename it, or start
                    the next one below.
                  </Text>
                  <View style={styles.editButtonRow}>
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      value={renameSeasonText}
                      onChangeText={setRenameSeasonText}
                      placeholder="Season name"
                      placeholderTextColor={colors.textMuted}
                    />
                    <Pressable
                      style={[
                        styles.smallButton,
                        (!renameSeasonText.trim() || savingSeasonRename) && styles.buttonDisabled,
                      ]}
                      onPress={handleSaveSeasonRename}
                      disabled={!renameSeasonText.trim() || savingSeasonRename}
                    >
                      {savingSeasonRename ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <Text style={styles.smallButtonText}>Rename</Text>
                      )}
                    </Pressable>
                  </View>
                </>
              ) : (
                <Text style={styles.editRowLabel}>No season started yet — name and start the first one below.</Text>
              )}
              <Text style={styles.editRowLabel}>
                {currentSeason?.isOffseason ?? false ? 'New season name' : 'New offseason name'}
              </Text>
              <TextInput
                style={styles.input}
                value={newSeasonLabel}
                onChangeText={setNewSeasonLabel}
                placeholder="e.g. 8th Grade Season"
                placeholderTextColor={colors.textMuted}
              />
              <View style={styles.editButtonRow}>
                <Pressable
                  style={[styles.smallButton, styles.smallButtonSecondary]}
                  onPress={() => setSeasonPlayerId(null)}
                >
                  <Text style={styles.smallButtonSecondaryText}>Close</Text>
                </Pressable>
                <Pressable
                  style={[styles.smallButton, switchingSeason && styles.buttonDisabled]}
                  onPress={handleSwitchSeason}
                  disabled={switchingSeason}
                >
                  {switchingSeason ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.smallButtonText}>
                      {currentSeason?.isOffseason ?? false ? 'Start New Season' : 'Start Offseason'}
                    </Text>
                  )}
                </Pressable>
              </View>
            </>
          )}
        </View>
      ) : null}

      <TextInput
        style={styles.input}
        placeholder="New player name"
        placeholderTextColor={colors.textMuted}
        value={newPlayerName}
        onChangeText={setNewPlayerName}
      />
      <Text style={styles.whoLabel}>Is this you, or someone else (e.g. your child)?</Text>
      <View style={styles.whoRow}>
        <Pressable
          style={[styles.whoChip, !newPlayerIsMe && styles.whoChipActive]}
          onPress={() => setNewPlayerIsMe(false)}
        >
          <Text style={[styles.whoChipText, !newPlayerIsMe && styles.whoChipTextActive]}>Someone else</Text>
        </Pressable>
        <Pressable
          style={[styles.whoChip, newPlayerIsMe && styles.whoChipActive]}
          onPress={() => setNewPlayerIsMe(true)}
        >
          <Text style={[styles.whoChipText, newPlayerIsMe && styles.whoChipTextActive]}>This is me</Text>
        </Pressable>
      </View>
      <Pressable
        style={[styles.button, (!newPlayerName.trim() || addingPlayer) && styles.buttonDisabled]}
        onPress={handleAddPlayer}
        disabled={!newPlayerName.trim() || addingPlayer}
      >
        {addingPlayer ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.buttonText}>Add Player</Text>
        )}
      </Pressable>

      <Text style={styles.sectionTitle}>Join a team</Text>
      <Text style={styles.placeholder}>
        {players.length === 0
          ? 'Add a player above first, then enter a coach\'s invite code here.'
          : `Enter the invite code your coach gave you for ${
              players.find((p) => p.id === selectedPlayerId)?.display_name ?? 'the selected player'
            }.`}
      </Text>
      {joinError ? <Text style={styles.error}>{joinError}</Text> : null}
      {joinSuccess ? <Text style={styles.success}>{joinSuccess}</Text> : null}
      <TextInput
        style={styles.input}
        placeholder="Invite code"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        value={inviteCode}
        onChangeText={setInviteCode}
        editable={players.length > 0}
      />
      <Pressable
        style={[
          styles.button,
          (!selectedPlayerId || !inviteCode.trim() || joining) && styles.buttonDisabled,
        ]}
        onPress={handleJoinTeam}
        disabled={!selectedPlayerId || !inviteCode.trim() || joining}
      >
        {joining ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>Join Team</Text>}
      </Pressable>

      <Text style={styles.sectionTitle}>Add a custom drill</Text>
      <Text style={styles.placeholder}>
        {players.length === 0
          ? 'Add a player above first.'
          : `Adds to ${players.find((p) => p.id === selectedPlayerId)?.display_name ?? 'the selected player'}'s drill library only — no limit on how many. Long-press a drill below to rename or delete it.`}
      </Text>
      {drillError ? <Text style={styles.error}>{drillError}</Text> : null}
      {drillSuccess ? <Text style={styles.success}>{drillSuccess}</Text> : null}

      {customDrills.length > 0 ? (
        <View style={styles.chipRow}>
          {customDrills.map((d) => (
            <Pressable key={d.id} style={styles.chip} onLongPress={() => handleLongPressDrill(d)}>
              <Text style={styles.chipText}>{d.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {renamingDrillId ? (
        <View style={styles.editRow}>
          <TextInput
            style={styles.input}
            value={renameDrillName}
            onChangeText={setRenameDrillName}
            placeholder="Drill name"
            placeholderTextColor={colors.textMuted}
          />
          <TextInput
            style={styles.input}
            value={renameDrillCategory}
            onChangeText={setRenameDrillCategory}
            placeholder="Category (optional)"
            placeholderTextColor={colors.textMuted}
          />
          <TextInput
            style={styles.input}
            value={renameDrillVideoUrl}
            onChangeText={setRenameDrillVideoUrl}
            placeholder="YouTube video URL (optional)"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            keyboardType="url"
          />
          <View style={styles.editButtonRow}>
            <Pressable
              style={[styles.smallButton, styles.smallButtonSecondary]}
              onPress={() => setRenamingDrillId(null)}
            >
              <Text style={styles.smallButtonSecondaryText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[
                styles.smallButton,
                (!renameDrillName.trim() || savingDrillEdit) && styles.buttonDisabled,
              ]}
              onPress={handleSaveDrillRename}
              disabled={!renameDrillName.trim() || savingDrillEdit}
            >
              {savingDrillEdit ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.smallButtonText}>Save</Text>
              )}
            </Pressable>
          </View>
        </View>
      ) : null}

      <TextInput
        style={styles.input}
        placeholder="Drill name"
        placeholderTextColor={colors.textMuted}
        value={drillName}
        onChangeText={setDrillName}
      />
      <TextInput
        style={styles.input}
        placeholder="Category (optional)"
        placeholderTextColor={colors.textMuted}
        value={drillCategory}
        onChangeText={setDrillCategory}
      />
      <TextInput
        style={styles.input}
        placeholder={`Duration in minutes (optional, defaults to ${DEFAULT_DRILL_MINUTES})`}
        placeholderTextColor={colors.textMuted}
        keyboardType="number-pad"
        value={drillMinutes}
        onChangeText={setDrillMinutes}
      />
      <TextInput
        style={styles.input}
        placeholder="YouTube video URL (optional)"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        keyboardType="url"
        value={drillVideoUrl}
        onChangeText={setDrillVideoUrl}
      />
      <Pressable
        style={[
          styles.button,
          (!drillName.trim() || !selectedPlayerId || addingDrill) && styles.buttonDisabled,
        ]}
        onPress={handleAddDrill}
        disabled={!drillName.trim() || !selectedPlayerId || addingDrill}
      >
        {addingDrill ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.buttonText}>Add Drill</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 10 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  error: { color: '#C4362B', fontSize: 13 },
  success: { color: colors.primaryDark, fontSize: 13 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: colors.text, marginTop: 12 },
  placeholder: { fontSize: 14, color: colors.textMuted, lineHeight: 20 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.surface,
  },
  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: { fontSize: 14, color: colors.text, fontWeight: '600' },
  chipTextSelected: { color: '#FFFFFF' },
  whoLabel: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginTop: 2 },
  whoRow: { flexDirection: 'row', gap: 8 },
  whoChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  whoChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  whoChipText: { fontSize: 14, fontWeight: '600', color: colors.text },
  whoChipTextActive: { color: '#FFFFFF' },
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
  editRow: {
    gap: 8,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#FFF8EA',
  },
  editRowLabel: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  visibilityRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  visibilityText: { flex: 1, gap: 2 },
  visibilityLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
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
});
