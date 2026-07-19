import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

export default function HomeScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.streakCard}>
        <Text style={styles.streakLabel}>Current streak</Text>
        <Text style={styles.streakValue}>0 days</Text>
      </View>
      <Text style={styles.sectionTitle}>Today's drills</Text>
      <Text style={styles.placeholder}>
        Assigned or default drills for the current user's linked player(s)
        will show here — tap a drill to mark it complete.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 16 },
  streakCard: {
    backgroundColor: colors.accent,
    borderRadius: 16,
    padding: 20,
  },
  streakLabel: { color: '#FFFFFF', fontSize: 14, opacity: 0.9 },
  streakValue: { color: '#FFFFFF', fontSize: 32, fontWeight: '700', marginTop: 4 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: colors.text },
  placeholder: { fontSize: 14, color: colors.textMuted, lineHeight: 20 },
});
