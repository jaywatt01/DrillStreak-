import { useEffect, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { ActivityIndicator, Text, View } from 'react-native';
import type { Session } from '@supabase/supabase-js';

import { supabase } from './src/lib/supabase';
import { clearPurchasesUser, configurePurchases, identifyPurchasesUser } from './src/lib/purchases';
import { registerForPushNotifications } from './src/lib/pushNotifications';
import AuthScreen from './src/screens/AuthScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import HomeScreen from './src/screens/HomeScreen';
import MyTeamScreen from './src/screens/MyTeamScreen';
import AddPlayerScreen from './src/screens/AddPlayerScreen';
import ProgressScreen from './src/screens/ProgressScreen';
import TeamBoardScreen from './src/screens/TeamBoardScreen';
import AccountScreen from './src/screens/AccountScreen';
import { colors } from './src/theme/colors';

const Tab = createBottomTabNavigator();

const TAB_ICONS: Record<string, string> = {
  Dashboard: '🏠',
  Home: '🏀',
  'My Team': '👥',
  'Add a Player': '➕',
  Progress: '📈',
  'Team Chat': '💬',
  Account: '⚙️',
};

// Lets the notification-tap handler below navigate imperatively — it fires
// outside the Tab.Navigator's own render tree, so it can't use the normal
// useNavigation() hook.
const navigationRef = createNavigationContainerRef();

// Real gap Jay flagged: tapping a push notification just reopened the app
// to whatever screen was last showing, not the actual conversation. Both
// the trigger (built ahead of time here) and the live listener are needed
// — getLastNotificationResponseAsync covers the app being fully killed and
// launched BY the tap (the listener alone misses that case, since it only
// fires for taps while the JS runtime is already alive).
//
// Real race, fixed before shipping rather than after: on a cold start the
// notification check can resolve BEFORE NavigationContainer ever mounts
// (it doesn't render at all until the auth session finishes restoring from
// AsyncStorage, which is its own separate async read) — the most common
// real case, not an edge case, since a killed-and-relaunched app is
// usually already signed in. Queue the response instead of dropping it
// silently, and flush the queue once the container's onReady fires.
let pendingNotificationResponse: Notifications.NotificationResponse | null = null;

function navigateToNotificationTarget(response: Notifications.NotificationResponse) {
  const data = response.notification.request.content.data as
    | { teamId?: string; threadUserId?: string; view?: string }
    | undefined;
  // Untyped navigation, same `as never` escape hatch already used
  // elsewhere in this app (HomeScreen/ProgressScreen/AddPlayerScreen) —
  // there's no typed navigator param list anywhere in this codebase.
  (navigationRef.navigate as (name: never, params?: object) => void)(
    'Team Chat' as never,
    data?.teamId ? { teamId: data.teamId, threadUserId: data.threadUserId, view: data.view } : undefined
  );
}

function navigateFromNotification(response: Notifications.NotificationResponse) {
  if (navigationRef.isReady()) {
    navigateToNotificationTarget(response);
  } else {
    pendingNotificationResponse = response;
  }
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    configurePurchases();

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
      if (data.session?.user.id) {
        identifyPurchasesUser(data.session.user.id);
        // Fire-and-forget: a denied/unavailable permission shouldn't block
        // app startup, same reasoning as everywhere else permissions are
        // requested in this app (camera, calendar).
        registerForPushNotifications().catch(() => {});
      }
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      if (newSession?.user.id) {
        identifyPurchasesUser(newSession.user.id);
        registerForPushNotifications().catch(() => {});
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

  useEffect(() => {
    // App already running (foreground or backgrounded) when the
    // notification is tapped.
    const subscription = Notifications.addNotificationResponseReceivedListener(navigateFromNotification);
    // App was fully killed and the tap is what launched it — the listener
    // above never fires for this case, since JS wasn't running yet when
    // the tap happened.
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) navigateFromNotification(response);
    });
    return () => subscription.remove();
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
    <NavigationContainer
      ref={navigationRef}
      onReady={() => {
        if (pendingNotificationResponse) {
          navigateToNotificationTarget(pendingNotificationResponse);
          pendingNotificationResponse = null;
        }
      }}
    >
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
        <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'Home' }} />
        <Tab.Screen name="Home" component={HomeScreen} options={{ title: 'Drills' }} />
        <Tab.Screen name="My Team" component={MyTeamScreen} />
        <Tab.Screen name="Add a Player" component={AddPlayerScreen} />
        <Tab.Screen name="Progress" component={ProgressScreen} />
        <Tab.Screen name="Team Chat" component={TeamBoardScreen} />
        <Tab.Screen name="Account" component={AccountScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
