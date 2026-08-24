import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/colors';

// Self-attestation only — no birthdate is ever collected or stored, just
// this yes/no answer plus a timestamp (see record_age_attestation in
// schema.sql). Built ahead of Brandon's COPPA-specific legal review, at
// Jay's explicit direction, as a real reduction in exposure now rather
// than waiting — the exact wording/mechanism can still be revisited once
// he's reviewed it.
type AgeGateStep = 'ask' | 'blocked' | 'clear';

export default function AuthScreen() {
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [ageGateStep, setAgeGateStep] = useState<AgeGateStep>('ask');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signUpMessage, setSignUpMessage] = useState<string | null>(null);

  const switchMode = (nextMode: 'signIn' | 'signUp') => {
    setMode(nextMode);
    setAgeGateStep('ask');
    setError(null);
    setSignUpMessage(null);
  };

  const submit = async () => {
    setError(null);
    setSignUpMessage(null);
    setLoading(true);
    try {
      if (mode === 'signIn') {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) throw signInError;
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (signUpError) throw signUpError;
        // Fire-and-forget: this is a compliance record, not something the
        // sign-up flow should be blocked on if it fails (e.g. a flaky
        // network right after signUp succeeded) — the account itself is
        // already created either way.
        if (data.user?.id) {
          supabase
            .rpc('record_age_attestation', { p_user_id: data.user.id, p_attested_13_or_over: true })
            .then(() => {}, () => {});
        }
        setSignUpMessage('Check your email to confirm your account, then sign in.');
      }
    } catch (e) {
      // Supabase normally throws a clean, short message ("Invalid login
      // credentials", "User already registered"), but an unexpected
      // server-side failure (e.g. a misconfigured SMTP provider breaking
      // the confirmation-email send) can surface as a raw stringified
      // HTTP response instead — caught live July 29, 2026, a real user
      // saw headers/cookies/blobIds dumped into this field. Fall back to
      // a generic message for anything that isn't a normal short error.
      const message = e instanceof Error ? e.message : '';
      const looksLikeRawResponse = !message || message.length > 200 || message.startsWith('{"');
      setError(
        looksLikeRawResponse
          ? 'Something went wrong. Please try again in a moment, or contact support@drillstreak.com if it keeps happening.'
          : message
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Image
          source={require('../../assets/branding/drillstreak-wordmark.png')}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="DrillStreak"
        />
        <Text style={styles.subtitle}>
          {mode === 'signIn' ? 'Sign in to continue' : 'Create an account'}
        </Text>

        {mode === 'signUp' && ageGateStep === 'ask' ? (
          <View style={styles.ageGateCard}>
            <Text style={styles.ageGateQuestion}>Are you 13 or older?</Text>
            <Pressable style={styles.button} onPress={() => setAgeGateStep('clear')}>
              <Text style={styles.buttonText}>Yes, I'm 13 or older</Text>
            </Pressable>
            <Pressable style={[styles.button, styles.buttonSecondary]} onPress={() => setAgeGateStep('blocked')}>
              <Text style={styles.buttonSecondaryText}>No, I'm under 13</Text>
            </Pressable>
          </View>
        ) : mode === 'signUp' && ageGateStep === 'blocked' ? (
          <View style={styles.ageGateCard}>
            <Text style={styles.ageGateBlockedText}>
              DrillStreak accounts must be created by someone 13 or older. If you're a parent or
              guardian, please create the account yourself, then add your player from inside the
              app — they don't need their own account.
            </Text>
            <Pressable onPress={() => switchMode('signIn')}>
              <Text style={styles.switchText}>Back to sign in</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="password"
              value={password}
              onChangeText={setPassword}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}
            {signUpMessage ? <Text style={styles.info}>{signUpMessage}</Text> : null}

            <Pressable
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={submit}
              disabled={loading || !email || !password}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.buttonText}>
                  {mode === 'signIn' ? 'Sign In' : 'Sign Up'}
                </Text>
              )}
            </Pressable>

            <Pressable onPress={() => switchMode(mode === 'signIn' ? 'signUp' : 'signIn')}>
              <Text style={styles.switchText}>
                {mode === 'signIn'
                  ? "Don't have an account? Sign up"
                  : 'Already have an account? Sign in'}
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 12 },
  // Actual wordmark asset is 1296x290 (~4.47:1) — width fixed, height derived
  // from that ratio so it can't be stretched out of proportion.
  logo: { width: 240, height: 240 / (1296 / 290), alignSelf: 'center', marginBottom: 4 },
  subtitle: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  error: { color: '#C4362B', fontSize: 13 },
  info: { color: colors.primaryDark, fontSize: 13 },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  buttonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonSecondaryText: { color: colors.text, fontSize: 16, fontWeight: '600' },
  ageGateCard: { gap: 10 },
  ageGateQuestion: { fontSize: 16, fontWeight: '600', color: colors.text, textAlign: 'center', marginBottom: 4 },
  ageGateBlockedText: { fontSize: 14, color: colors.text, lineHeight: 20, textAlign: 'center', marginBottom: 8 },
  switchText: {
    color: colors.primary,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
  },
});
