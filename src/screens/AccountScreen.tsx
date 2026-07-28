import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/colors';
import {
  isPurchasesConfigured,
  purchaseParentTier,
  restorePurchases,
  useParentEntitlement,
} from '../lib/purchases';

export default function AccountScreen() {
  const [email, setEmail] = useState<string | null>(null);
  const { hasParentTier, loading: entitlementLoading } = useParentEntitlement();
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  const handleUpgrade = async () => {
    setPurchasing(true);
    try {
      await purchaseParentTier();
      Alert.alert('You\'re upgraded!', 'Parent membership is active — full history and unlimited linked players are unlocked.');
    } catch (e) {
      Alert.alert('Could not complete purchase', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setPurchasing(false);
    }
  };

  const handleRestore = async () => {
    setRestoring(true);
    try {
      const info = await restorePurchases();
      const restored = info.entitlements.active['parent_tier'] != null;
      Alert.alert(restored ? 'Restored' : 'Nothing to restore', restored ? 'Parent membership is active on this account.' : 'No previous purchase was found for this account.');
    } catch (e) {
      Alert.alert('Could not restore purchases', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Account</Text>
      {email ? <Text style={styles.email}>{email}</Text> : null}
      <Text style={styles.placeholder}>
        Manage your Parent and Coach memberships independently — both can be
        active on the same account at once.
      </Text>

      <View style={styles.tierCard}>
        <Text style={styles.tierLabel}>Coach</Text>
        <Text style={styles.tierValue}>Free — always included</Text>
        <Text style={styles.tierBody}>
          Create a team, assign drills, and manage your roster at no cost.
        </Text>
      </View>

      <View style={[styles.tierCard, hasParentTier && styles.tierCardActive]}>
        <Text style={styles.tierLabel}>Parent</Text>
        {entitlementLoading ? (
          <ActivityIndicator color={colors.primary} style={{ alignSelf: 'flex-start', marginTop: 4 }} />
        ) : (
          <Text style={styles.tierValue}>{hasParentTier ? 'Active' : '$4.99/mo'}</Text>
        )}
        <Text style={styles.tierBody}>
          Full progress history and unlimited linked players. Free accounts
          see the current week only, for one linked player.
        </Text>

        {!hasParentTier && !entitlementLoading ? (
          <Pressable
            style={[styles.button, purchasing && styles.buttonDisabled]}
            onPress={handleUpgrade}
            disabled={purchasing}
          >
            {purchasing ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.buttonText}>
                {isPurchasesConfigured() ? 'Upgrade — $4.99/mo' : 'Upgrade (coming soon)'}
              </Text>
            )}
          </Pressable>
        ) : null}

        {!hasParentTier ? (
          <Pressable onPress={handleRestore} disabled={restoring} style={styles.restoreLink}>
            {restoring ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <Text style={styles.restoreLinkText}>Restore purchases</Text>
            )}
          </Pressable>
        ) : null}

        {/* Apple App Review guideline 3.1.2 subscription disclosure —
            required near the purchase button, only while it's showing. */}
        {!hasParentTier && !entitlementLoading ? (
          <Text style={styles.disclosureText}>
            Parent Membership is a $4.99/month auto-renewing subscription.
            Payment is charged to your Apple ID account at confirmation of
            purchase. The subscription automatically renews unless
            auto-renew is turned off at least 24 hours before the end of
            the current period, and your account will be charged for
            renewal within 24 hours prior to that. Manage or cancel
            anytime in your device's Apple ID account settings.{' '}
            <Text
              style={styles.disclosureLink}
              onPress={() => Linking.openURL('https://legal.drillstreak.com/legal/terms-of-service.html')}
            >
              Terms of Service
            </Text>
            {'  ·  '}
            <Text
              style={styles.disclosureLink}
              onPress={() => Linking.openURL('https://legal.drillstreak.com/legal/privacy-policy.html')}
            >
              Privacy Policy
            </Text>
          </Text>
        ) : null}
      </View>

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
  tierCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    gap: 4,
    backgroundColor: colors.surface,
  },
  tierCardActive: {
    borderColor: colors.accent,
    backgroundColor: '#FFF8EA',
  },
  tierLabel: { fontSize: 13, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
  tierValue: { fontSize: 20, fontWeight: '700', color: colors.text, marginTop: 2 },
  tierBody: { fontSize: 13, color: colors.textMuted, lineHeight: 18, marginTop: 4 },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  restoreLink: { alignSelf: 'center', marginTop: 10 },
  restoreLinkText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  disclosureText: { fontSize: 11, color: colors.textMuted, lineHeight: 16, marginTop: 12 },
  disclosureLink: { color: colors.primary, fontWeight: '600' },
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
