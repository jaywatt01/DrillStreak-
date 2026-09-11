import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

export type ActionSheetOption = {
  text: string;
  style?: 'destructive' | 'cancel';
  onPress?: () => void;
};

type Props = {
  visible: boolean;
  title: string;
  message?: string;
  options: ActionSheetOption[];
  onClose: () => void;
};

// Real bug found and fixed 2026-09-11, Android only: React Native's
// Alert.alert silently drops a 4th button on Android (its native
// AlertDialog only has positive/neutral/negative slots) — with no
// warning, no error, it just isn't there. Jay hit this on Account's new
// long-press menu (Edit Profile/Remove from Team/Delete/Cancel, 4
// options with a team) with no way back except completing one of the
// remaining actions. The exact same 4-option shape already existed in
// AddPlayerScreen's player long-press (Edit Profile/Season/Delete/
// Cancel) — fixed there too, same root cause, not yet reported broken
// but certain to hit the same wall.
//
// A real Modal instead of the native Alert, so button count is never
// platform-limited again: tapping outside the card, the hardware back
// button (onRequestClose), and an explicit Cancel row all dismiss the
// same way. Callers pass the same {text, style, onPress} shape they'd
// already give Alert.alert — a Cancel entry with no onPress just closes.
export default function ActionSheet({ visible, title, message, options, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        {/* Swallows the tap so pressing the card itself doesn't fall
            through to the overlay's onClose. */}
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          {options.map((opt, i) => (
            <Pressable
              key={`${opt.text}-${i}`}
              style={[styles.option, i > 0 && styles.optionBorder]}
              onPress={() => {
                onClose();
                opt.onPress?.();
              }}
            >
              <Text
                style={[
                  styles.optionText,
                  opt.style === 'destructive' && styles.destructiveText,
                  opt.style === 'cancel' && styles.cancelText,
                ]}
              >
                {opt.text}
              </Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
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
    paddingTop: 18,
    overflow: 'hidden',
  },
  title: { fontSize: 16, fontWeight: '700', color: colors.text, textAlign: 'center', paddingHorizontal: 20 },
  message: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: 20,
    marginTop: 6,
    lineHeight: 18,
  },
  option: { paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  optionBorder: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 0 },
  optionText: { fontSize: 16, fontWeight: '600', color: colors.primary },
  destructiveText: { color: '#C4362B' },
  cancelText: { color: colors.textMuted, fontWeight: '700' },
});
