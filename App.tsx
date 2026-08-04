import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { ActivityIndicator, Text, View } from 'react-native';
import type { Session } from '@supabase/supabase-js';

import { supabase } from './src/lib/supabase';
import { clearPurchasesUser, configurePurchases, identifyPurchasesUser } from './src/lib/purchases';
import AuthScreen from './src/screens/AuthScreen';
import HomeScreen from './src/screens/HomeScreen';
import MyTeamScreen from './src/screens/MyTeamScreen';
import AddPlayerScreen from './src/screens/AddPlayerScreen';
import ProgressScreen from './src/screens/ProgressScreen';
import AccountScreen from './src/screens/AccountScreen';
import { colors } from './src/theme/colors';

const Tab = createBottomTabNavigator();

const TAB_ICONS: Record<string, string> = {
  Home: '🏠',
  'My Team': '👥',
  'Add a Player': '➕',
  Progress: '📈',
  Account: '⚙️',
};

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    configurePurchases();

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
      if (data.session?.user.id) identifyPurchasesUser(data.session.user.id);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      if (newSession?.user.id) {
        identifyPurchasesUser(newSession.user.id);
      } else if (event === 'SIGNED_OUT') {
        // Real bug, caught July 29, 2026, on the first-ever fresh install
        // this identity code has run against: Supabase also fires
        // 'INITIAL_SESSION' with session=null on every app startup before
        // any sign-in has happened, not just on an actual sign-out. The
        // old `else` branch called Purchases.logOut() on that startup
        // event too — RevenueCat correctly errors on that, since nothing
        // was ever logged in yet ("LogOut was called but the current user
        // is anonymous"). Only clear the RevenueCat identity on a real
        // sign-out event, never on startup with no session.
        clearPurchasesUser();
      }
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!session) {
    return (
      <>
        <StatusBar style="dark" />
        <AuthScreen />
      </>
    );
  }

  return (
    <NavigationContainer>
      <StatusBar style="dark" />
      <Tab.Navigator
        screenOptions={({ route }) => ({
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
          headerTintColor: colors.text,
          tabBarIcon: () => (
            <Text style={{ fontSize: 18 }}>{TAB_ICONS[route.name]}</Text>
          ),
        })}
      >
        <Tab.Screen name="Home" component={HomeScreen} options={{ title: 'Today' }} />
        <Tab.Screen name="My Team" component={MyTeamScreen} />
        <Tab.Screen name="Add a Player" component={AddPlayerScreen} />
        <Tab.Screen name="Progress" component={ProgressScreen} />
        <Tab.Screen name="Account" component={AccountScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
