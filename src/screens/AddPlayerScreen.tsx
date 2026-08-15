import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { useParentEntitlement } from '../lib/purchases';
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

export default function AddPlayerScreen() {
  const navigation = useNavigation();
  const { hasParentTier } = useParentEntitlement();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

  const [newPlayerName, setNewPlayerName] = useState('');
  const [addingPlayer, setAddingPlayer] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);

  const [renamingPlayerId, setRenamingPlayerId] = useState<string | null>(null);
  const [renamePlayerText, setRenamePlayerText] = useState('');
  const [editHeight, setEditHeight] = useState('');
  const [editWeight, setEditWeight] = useState('');
  const [editGradYear, setEditGradYear] = useState('');
  const [editPosition, setEditPosition] = useState('');
  const [savingPlayerEdit, setSavingPlayerEdit] = useState(false);

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
    } catch (e) {
      setPlayerError(e instanceof Error ? e.message : 'Failed to load players.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
      const player = await addPlayer(newPlayerName.trim());
      setNewPlayerName('');
      await load();
      setSelectedPlayerId(player.id);
    } catch (e) {
      setPlayerError(e instanceof Error ? e.message : 'Failed to add player.');
    } finally {
      setAddingPlayer(false);
    }
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
        },
      },
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

      <TextInput
        style={styles.input}
        placeholder="New player name"
        placeholderTextColor={colors.textMuted}
        value={newPlayerName}
        onChangeText={setNewPlayerName}
      />
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
