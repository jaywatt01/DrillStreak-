import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { getTeammates, Teammate } from '../lib/challenges';
import { formatPlayerBio } from '../lib/players';
import CoachPlayerStatsModal from './CoachPlayerStatsModal';

type Props = {
  playerId: string;
  onClose: () => void;
};

// Reuses get_teammates (built for Challenge a Friend) and
// CoachPlayerStatsModal (built for coach roster viewing) — same underlying
// data and the same stats display, just reached from a different place.
// An opted-out teammate (stats_visible_to_team = false) still shows up by
// name, so the roster doesn't look incomplete, but isn't tappable — RLS
// (completions_teammate_read in schema.sql) is the real enforcement either
// way, this is just what decides whether the row looks tappable.
export default function TeammatesModal({ playerId, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [teammates, setTeammates] = useState<Teammate[]>([]);
  const [viewing, setViewing] = useState<Teammate | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTeammates(await getTeammates(playerId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load teammates.');
    } finally {
      setLoading(false);
    }
  }, [playerId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Teammates</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={styles.closeLink}>Close</Text>
            </Pressable>
          </View>

          {loading ? (
            <ActivityIndicator color={colors.primary} style={styles.spinner} />
          ) : error ? (
            <Text style={styles.error}>{error}</Text>
          ) : teammates.length === 0 ? (
            <Text style={styles.placeholder}>No teammates yet — join a team to see who else is on it.</Text>
          ) : (
            <ScrollView contentContainerStyle={styles.scrollContent}>
              {teammates.map((t) => {
                const bio = formatPlayerBio(t);
                const visible = t.stats_visible_to_team;
                return (
                  <Pressable
                    key={t.id}
                    style={[styles.row, !visible && styles.rowPrivate]}
                    onPress={() => visible && setViewing(t)}
                    disabled={!visible}
                  >
                    <View style={styles.rowText}>
                      <Text style={styles.rowName}>{t.display_name}</Text>
                      {bio ? <Text style={styles.rowBio}>{bio}</Text> : null}
                    </View>
                    <Text style={visible ? styles.viewLink : styles.privateLabel}>
                      {visible ? 'View stats' : 'Private'}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>

      {viewing ? (
        <CoachPlayerStatsModal playerId={viewing.id} playerName={viewing.display_name} onClose={() => setViewing(null)} />
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    maxHeight: '75%',
    gap: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  closeLink: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  spinner: { marginVertical: 20 },
  error: { color: '#C4362B', fontSize: 13 },
  placeholder: { fontSize: 14, color: colors.textMuted, lineHeight: 20 },
  scrollContent: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.background,
  },
  rowPrivate: { opacity: 0.6 },
  rowText: { flex: 1, marginRight: 12 },
  rowName: { fontSize: 15, fontWeight: '600', color: colors.text },
  rowBio: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  viewLink: { fontSize: 13, fontWeight: '600', color: colors.accentDark },
  privateLabel: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
});
