import { ScrollView, StyleSheet, Text } from 'react-native';
import { colors } from '../theme/colors';

export default function ProgressScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Progress</Text>
      <Text style={styles.placeholder}>
        Streak calendar and weekly recap per player. Free tier shows the
        current week only — full history requires the Parent membership.
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
