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

export default function AuthScreen() {
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signUpMessage, setSignUpMessage] = useState<string | null>(null);

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
        const { error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (signUpError) throw signUpError;
        setSignUpMessage('Check your email to confirm your account, then sign in.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
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

        <Pressable
          onPress={() => {
            setMode(mode === 'signIn' ? 'signUp' : 'signIn');
            setError(null);
            setSignUpMessage(null);
          }}
        >
          <Text style={styles.switchText}>
            {mode === 'signIn'
              ? "Don't have an account? Sign up"
              : 'Already have an account? Sign in'}
          </Text>
        </Pressable>
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
  switchText: {
    color: colors.primary,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
  },
});
