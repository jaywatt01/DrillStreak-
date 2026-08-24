import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// Foreground behavior for a push arriving while the app is already open —
// still shows a banner/plays a sound rather than silently updating badge
// count only, since a new team message/event is exactly the kind of thing
// worth interrupting for during the season.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// Requests permission and registers this device's Expo push token against
// the signed-in account. Safe to call every app start — upserts on the
// (user_id, expo_push_token) unique constraint, so re-registering the same
// device is a no-op past the first time. Delivery itself (the actual
// notify-team-message Edge Function + an APNs key in Jay's Apple Developer
// account) is separate infrastructure — see DRILLSTREAK.md; this function
// only handles the client-side permission + token-registration half.
export async function registerForPushNotifications(): Promise<void> {
  // Real bug, caught Aug 24, 2026 on Jay's actual device: `Constants.isDevice`
  // was removed from expo-constants (moved to expo-device's `Device.isDevice`)
  // — TypeScript never caught the invalid property access because
  // NativeConstants's type includes a `& Record<string, any>` catch-all, so
  // `Constants.isDevice` silently evaluated to `undefined` at runtime. That
  // made every call return here immediately, before ever requesting
  // notification permission — no prompt, no token, no delivery, and no
  // error anywhere to point at it. Fixed by switching to the package this
  // check actually lives in now.
  if (!Device.isDevice) return; // simulators/emulators have no push token

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const pushToken = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return;

  const { error } = await supabase
    .from('push_tokens')
    .upsert(
      { user_id: userId, expo_push_token: pushToken.data, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,expo_push_token' }
    );
  if (error) throw error;
}
