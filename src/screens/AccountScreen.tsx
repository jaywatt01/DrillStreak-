import { ScrollView, StyleSheet, Text } from 'react-native';
import { colors } from '../theme/colors';

export default function AccountScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Account</Text>
      <Text style={styles.placeholder}>
        Manage parent_tier and coach_tier independently — both can be active
        on the same account at once.
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
