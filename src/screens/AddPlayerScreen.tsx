import { ScrollView, StyleSheet, Text } from 'react-native';
import { colors } from '../theme/colors';

export default function AddPlayerScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Add a player</Text>
      <Text style={styles.placeholder}>
        Create a player profile, join a team via invite code, or start from
        the default drill library.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: colors.text },
  placeholder: { fontSize: 14, color: colors.textMuted, lineHeight: 20 },
});
