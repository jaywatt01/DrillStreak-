import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/colors';

export default function AccountScreen() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Account</Text>
      {email ? <Text style={styles.email}>{email}</Text> : null}
      <Text style={styles.placeholder}>
        Manage your Parent and Coach memberships independently — both can be
        active on the same account at once.
      </Text>
      <Pressable style={styles.signOutButton} onPress={() => supabase.auth.signOut()}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: colors.text },
  email: { fontSize: 14, color: colors.textMuted },
  placeholder: { fontSize: 14, color: colors.textMuted, lineHeight: 20 },
  signOutButton: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  signOutText: { color: '#C4362B', fontSize: 15, fontWeight: '600' },
});
