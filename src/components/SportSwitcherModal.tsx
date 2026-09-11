import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { useActiveSport } from '../lib/ActiveSportContext';

// Rendered exactly once, in App.tsx's AppTabs (inside ActiveSportProvider,
// alongside the Tab.Navigator) — reachable from the SportSwitcher link on
// any screen, and from a long-press on the Drills tab itself (2026-09-11,
// Jay's ask: "I've been naturally and unconsciously doing it and catching
// myself"). Both paths just call openSwitcher() on the shared context;
// this component owns the one real Modal instance.
export default function SportSwitcherModal() {
  const { sport, sports, switchSport, switcherOpen, closeSwitcher } = useActiveSport();
  const [switching, setSwitching] = useState(false);

  const handleSwitch = async (value: string) => {
    if (value === sport) {
      closeSwitcher();
      return;
    }
    setSwitching(true);
    try {
      await switchSport(value);
    } finally {
      setSwitching(false);
      closeSwitcher();
    }
  };

  return (
    <Modal visible={switcherOpen} transparent animationType="fade" onRequestClose={closeSwitcher}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Switch sport</Text>
          <Text style={styles.subtitle}>
            Nothing is deleted — every sport's players, teams, and history stay saved. This just
            changes what shows.
          </Text>
          {sports.map((s) => (
            <Pressable
              key={s.value}
              style={[styles.row, s.value === sport && styles.rowActive]}
              onPress={() => handleSwitch(s.value)}
              disabled={switching}
            >
              <Text style={[styles.rowText, s.value === sport && styles.rowTextActive]}>{s.label}</Text>
              <Text style={styles.rowMeta}>
                {s.value === sport ? 'Current' : s.hasData ? 'Switch to' : 'Start'}
              </Text>
            </Pressable>
          ))}
          <Pressable style={styles.closeButton} onPress={closeSwitcher}>
            <Text style={styles.closeButtonText}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 20,
    gap: 10,
  },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 13, color: colors.textMuted, marginBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowActive: { borderColor: colors.primary, backgroundColor: colors.primary + '14' },
  rowText: { fontSize: 15, fontWeight: '600', color: colors.text },
  rowTextActive: { color: colors.primary },
  rowMeta: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  closeButton: { alignItems: 'center', paddingVertical: 10, marginTop: 4 },
  closeButtonText: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
});
