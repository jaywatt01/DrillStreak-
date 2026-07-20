import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { ActivityIndicator, Text, View } from 'react-native';
import type { Session } from '@supabase/supabase-js';

import { supabase } from './src/lib/supabase';
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
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
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
