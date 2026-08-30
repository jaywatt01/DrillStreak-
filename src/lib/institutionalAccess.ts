import { supabase } from './supabase';

// Team/Program institutional plans (per the marketing site's pricing page)
// unlock full-history/unlimited-player behavior for every family on a paid
// roster, without needing an individual RevenueCat parent_tier grant per
// account. This is deliberately a separate, additive check from
// useParentEntitlement (src/lib/purchases.ts): institutional access is
// per-player (which team a specific kid is on), while parent_tier is
// per-account — a real family could have one kid on a paid Program-plan
// roster and another kid not on any team at all.
//
// There's no in-app purchase flow for this yet — Phase 1 is manual Stripe
// invoicing, and Jay grants access by setting teams.institutional_plan
// directly via the Supabase SQL Editor once an invoice is paid. See
// DRILLSTREAK.md's "Payment structure for Team & Program plans" section.
export async function getInstitutionalAccessByPlayer(
  playerIds: string[]
): Promise<Record<string, boolean>> {
  if (playerIds.length === 0) return {};
  const entries = await Promise.all(
    playerIds.map(async (playerId) => {
      const { data, error } = await supabase.rpc('player_has_institutional_access', {
        p_player_id: playerId,
      });
      if (error) throw error;
      return [playerId, data === true] as const;
    })
  );
  return Object.fromEntries(entries);
}
