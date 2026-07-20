# DrillStreak

A coach assigns training drills to a roster; players (or parents, for younger kids) log what they actually did; everyone sees a consistency streak.

Full product context and decision history: `DRILLSTREAK.md` in the `jaywatt01/Command-center` repo. This repo is app source only.

## Tech stack
Expo (React Native, TypeScript) + Supabase (Postgres, auth, RLS) + RevenueCat (subscriptions) + `expo-calendar`. EAS handles iOS builds in the cloud — no Mac required.

## Status
- **Scaffold** — navigation shell with all 5 screens, placeholder content. Done.
- **Theme** — blue (coach/trust) + gold (Olympic-inspired energy accent), sport-agnostic per Jay's July 20 direction. Done.
- **Backend (Step 2)** — Supabase project `jiohhwahvzajvidbiqnm` connected, full schema + RLS deployed, email/password auth wired into the app (`App.tsx` gates on session; `AuthScreen.tsx` handles sign in/up; sign-out in `AccountScreen.tsx`). Verified live: sign-up creates a real `auth.users` row; RLS isolation confirmed by simulating three separate users via `SET ROLE`/`request.jwt.claims` (owner/guardian isolation, coach roster visibility, coach completion visibility, invite-code redemption both success and reject-wrong-owner cases) — not just read through a service-role connection, which would have hidden all of this.
- **Real bug found and fixed during Step 2:** the original draft RLS had a circular reference between `players` and `team_memberships` policies — Postgres correctly refused it (`infinite recursion detected in policy for relation players`), which would have broken every query touching a player, silently, on first real use. Fixed with a `security definer` helper function (`is_player_owner_or_guardian`) that breaks the cycle. See `supabase/schema.sql` for the deployed version (matches live, not the original draft).
- **Core drill-logging loop, coach assignment UI, guardian/player linking UI, calendar, paywall (Steps 3-7)** — not started. Tables/RLS support them; no screen reads/writes real data yet, all 5 screens still show static placeholder text.
- **Known environment limitation, not an app bug:** full in-browser E2E (sign up → see Home tab) couldn't be driven via headless Chromium in this sandbox — the browser's own TLS connection to the Supabase host resets through this environment's egress proxy (confirmed via a bare `page.goto`, unrelated to app code; `curl` through the same proxy works fine). Backend correctness was instead verified directly via the Supabase API and RLS role-simulation above. Recommend testing sign-up/sign-in on a real device via Expo Go, which won't have this sandbox proxy in the path.
- **SDK downgraded 57 → 54 (July 20, 2026).** The scaffold was built on whatever SDK `create-expo-app@latest` pulled at the time (57), but Apple's App Store approval for Expo Go SDK 55/56 is stalled as of this write-up — the publicly installable Expo Go app only supports SDK 54. Downgraded via `npm install expo@^54.0.0 && npx expo install --fix`; `expo-doctor` reports 18/18 checks passing, `tsc --noEmit` clean, re-verified rendering via headless browser. If Expo Go's App Store version later catches up to 55/56/57+, this can be re-upgraded with the same two commands — no code changes were needed for the downgrade itself, only dependency versions.

Env vars for the Supabase connection live in `.env` (the anon/publishable key — safe to commit, RLS is the real authorization boundary, not key secrecy).

## Run it
```
npm install
npx expo start
```
Scan the QR code with Expo Go on your phone to preview.
