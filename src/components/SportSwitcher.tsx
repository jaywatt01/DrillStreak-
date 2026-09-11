import { Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '../theme/colors';
import { useActiveSport } from '../lib/ActiveSportContext';

// The sport switcher link (2026-09-10) — reachable from Home and Account,
// same "tap a small link, get a modal" pattern as the Teammates link on
// Home. The actual modal lives in SportSwitcherModal, rendered once,
// globally, in App.tsx — not here, and not once per screen. See
// ActiveSportContext's switcherOpen comment for why.
export default function SportSwitcher() {
  const { sport, sports, openSwitcher } = useActiveSport();
  const currentLabel = sports.find((s) => s.value === sport)?.label ?? sport;

  return (
    <Pressable onPress={openSwitcher} hitSlop={8} style={styles.link}>
      <Text style={styles.linkText}>{currentLabel} · Switch sport</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: { alignSelf: 'flex-start' },
  linkText: { fontSize: 13, fontWeight: '600', color: colors.accentDark },
});
