# DrillStreak

A coach assigns training drills to a roster; players (or parents, for younger kids) log what they actually did; everyone sees a consistency streak.

Full product context and decision history: `DRILLSTREAK.md` in the `jaywatt01/Command-center` repo. This repo is app source only.

## Tech stack
Expo (React Native, TypeScript) + Supabase (Postgres, auth, RLS) + RevenueCat (subscriptions) + `expo-calendar`. EAS handles iOS builds in the cloud — no Mac required.

## Status
Scaffold complete — navigation shell with all 5 screens (Home/Today, My Team, Add a Player, Progress, Account), placeholder content, no backend wired up yet. See `DRILLSTREAK_BUILD_SPEC.md` for the full ordered build plan (Supabase/RLS, core drill-logging loop, coach team-assignment, guardian/player linking, calendar integration, paywall) and `supabase/schema.sql` for the data model.

Accent color (`src/theme/colors.ts`) is a placeholder orange — swap once Jay picks the real brand color(s).

## Run it
```
npm install
npx expo start
```
Scan the QR code with Expo Go on your phone to preview.
