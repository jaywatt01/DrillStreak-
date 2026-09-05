import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import Purchases, { CustomerInfo } from 'react-native-purchases';

// "parent_tier" must match the entitlement identifier configured in the
// RevenueCat dashboard exactly. coach_tier is intentionally NOT sold —
// Jay decided (July 25, 2026) coaches stay free permanently, since no
// validation data supports an individual coach paying, and a free coach
// tier protects the roster-growth loop that drives parent_tier signups
// (a coach creating a team is how parents/players even find the app).
export const PARENT_ENTITLEMENT_ID = 'parent_tier';

// RevenueCat issues a separate API key per store under one project (an
// Apple App Store app and a Google Play app each get their own key), so
// this needs to pick the right one per platform rather than assuming one
// key covers both. iOS keeps the existing env var unchanged — nothing
// changes for the app as it ships today. Android reads a new, separate
// var that stays unset (and the SDK no-ops, same as the existing "not
// configured yet" behavior) until Jay adds a Google Play app in the
// RevenueCat dashboard and sets EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID.
const REVENUECAT_API_KEY = Platform.select({
  ios: process.env.EXPO_PUBLIC_REVENUECAT_API_KEY,
  android: process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID,
  default: process.env.EXPO_PUBLIC_REVENUECAT_API_KEY,
});

let configured = false;

// Call once at app startup, before any user is known — configures the SDK
// anonymously. No-ops (app runs free-tier-only) until Jay creates a
// RevenueCat project and sets EXPO_PUBLIC_REVENUECAT_API_KEY — see
// DRILLSTREAK.md Monetization section for the setup steps. Safe to call
// more than once.
export function configurePurchases(): void {
  if (!REVENUECAT_API_KEY || configured) return;
  Purchases.configure({ apiKey: REVENUECAT_API_KEY });
  configured = true;
}

// Call whenever the signed-in Supabase user becomes known or changes —
// switches RevenueCat's identity to match. Without this, entitlements
// would stay pinned to whichever account first opened the app on this
// device, which breaks on any shared/multi-account device (a guardian and
// their kid sharing a phone, or testing multiple accounts during dev).
export async function identifyPurchasesUser(supabaseUserId: string): Promise<void> {
  if (!configured) return;
  await Purchases.logIn(supabaseUserId);
}

// Call on sign-out so the next sign-in (possibly a different person on the
// same device) doesn't inherit the previous user's cached entitlements.
export async function clearPurchasesUser(): Promise<void> {
  if (!configured) return;
  await Purchases.logOut();
}

export function isPurchasesConfigured(): boolean {
  return configured;
}

export function hasParentEntitlement(info: CustomerInfo | null): boolean {
  return info?.entitlements.active[PARENT_ENTITLEMENT_ID] != null;
}

export async function purchaseParentTier(): Promise<CustomerInfo> {
  if (!configured) {
    throw new Error('Subscriptions aren\'t set up yet — check back soon.');
  }
  const offerings = await Purchases.getOfferings();
  const pkg = offerings.current?.availablePackages[0];
  if (!pkg) {
    throw new Error('No subscription plan is available right now.');
  }
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  return customerInfo;
}

export async function restorePurchases(): Promise<CustomerInfo> {
  if (!configured) {
    throw new Error('Subscriptions aren\'t set up yet — check back soon.');
  }
  return Purchases.restorePurchases();
}

// Tracks the current user's entitlements, live — updates automatically
// after a purchase or restore anywhere in the app, not just on this screen.
export function useParentEntitlement(): { hasParentTier: boolean; loading: boolean } {
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    Purchases.getCustomerInfo()
      .then((info) => {
        if (!cancelled) setCustomerInfo(info);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const listener = (info: CustomerInfo) => setCustomerInfo(info);
    Purchases.addCustomerInfoUpdateListener(listener);
    return () => {
      cancelled = true;
      Purchases.removeCustomerInfoUpdateListener(listener);
    };
  }, []);

  return { hasParentTier: hasParentEntitlement(customerInfo), loading };
}
