import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { useActiveSport } from '../lib/ActiveSportContext';

// The sport switcher link + picker (2026-09-10) — reachable from Home and
// Account, per Jay's explicit ask, same "tap a small link, get a modal"
// pattern already established by the Teammates link on Home. Shows every
// real sport, not just ones the account already has data in, so starting
// a brand-new sport is reachable (Add a Player/Create a Team always use
// whatever sport is currently active, with no picker of their own — see
// their own comments — so switching here first is the only way in).
export default function SportSwitcher() {
  const { sport, sports, switchSport } = useActiveSport();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  const currentLabel = sports.find((s) => s.value === sport)?.label ?? sport;

  const handleSwitch = async (value: string) => {
    if (value === sport) {
      setOpen(false);
      return;
    }
    setSwitching(true);
    try {
      await switchSport(value);
    } finally {
      setSwitching(false);
      setOpen(false);
    }
  };

  return (
    <>
      <Pressable onPress={() => setOpen(true)} hitSlop={8} style={styles.link}>
        <Text style={styles.linkText}>{currentLabel} · Switch sport</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
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
            <Pressable style={styles.closeButton} onPress={() => setOpen(false)}>
              <Text style={styles.closeButtonText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  link: { alignSelf: 'flex-start' },
  linkText: { fontSize: 13, fontWeight: '600', color: colors.accentDark },
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
