import { ScrollView, StyleSheet, Text } from 'react-native';
import { colors } from '../theme/colors';

export default function MyTeamScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Roster</Text>
      <Text style={styles.placeholder}>
        Coach-only surface. Add/remove players, generate a team invite code,
        and assign this week's drills to the whole roster.
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
