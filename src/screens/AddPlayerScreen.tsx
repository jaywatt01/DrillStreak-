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
import { addCustomDrill, addPlayer, listMyPlayers, Player } from '../lib/players';
import { joinTeamByInviteCode } from '../lib/team';

export default function AddPlayerScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

  const [newPlayerName, setNewPlayerName] = useState('');
  const [addingPlayer, setAddingPlayer] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);

  const [inviteCode, setInviteCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinSuccess, setJoinSuccess] = useState<string | null>(null);

  const [drillName, setDrillName] = useState('');
  const [drillCategory, setDrillCategory] = useState('');
  const [addingDrill, setAddingDrill] = useState(false);
  const [drillError, setDrillError] = useState<string | null>(null);
  const [drillSuccess, setDrillSuccess] = useState<string | null>(null);

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

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const handleAddPlayer = async () => {
    if (!newPlayerName.trim()) return;
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
    if (!drillName.trim()) return;
    setAddingDrill(true);
    setDrillError(null);
    setDrillSuccess(null);
    try {
      const drill = await addCustomDrill(drillName.trim(), drillCategory.trim());
      setDrillName('');
      setDrillCategory('');
      setDrillSuccess(`Added "${drill.name}" to your drill library.`);
    } catch (e) {
      setDrillError(e instanceof Error ? e.message : 'Failed to add drill.');
    } finally {
      setAddingDrill(false);
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
      <Text style={styles.sectionTitle}>Your players</Text>
      {playerError ? <Text style={styles.error}>{playerError}</Text> : null}
      {players.length === 0 ? (
        <Text style={styles.placeholder}>No players linked yet — add one below.</Text>
      ) : (
        <View style={styles.chipRow}>
          {players.map((p) => (
            <Pressable
              key={p.id}
              style={[styles.chip, selectedPlayerId === p.id && styles.chipSelected]}
              onPress={() => setSelectedPlayerId(p.id)}
            >
              <Text
                style={[styles.chipText, selectedPlayerId === p.id && styles.chipTextSelected]}
              >
                {p.display_name}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
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
        Add your own drill with a name and category — no limit on how many.
      </Text>
      {drillError ? <Text style={styles.error}>{drillError}</Text> : null}
      {drillSuccess ? <Text style={styles.success}>{drillSuccess}</Text> : null}
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
      <Pressable
        style={[styles.button, (!drillName.trim() || addingDrill) && styles.buttonDisabled]}
        onPress={handleAddDrill}
        disabled={!drillName.trim() || addingDrill}
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
});
