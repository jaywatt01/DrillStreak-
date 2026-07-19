# DrillStreak — build spec

This is the technical build brief for the DrillStreak app, moved here from Command-center's `drillstreak-app/` staging folder on 2026-07-19 now that this repo (`jaywatt01/drillstreak-`) is reachable. Full business/product context and decision history lives in `DRILLSTREAK.md` in the Command-center repo (Jay's business-ops/venture-tracking repo) — that file stays there by design; this repo is app source code only.

## What this is
A coach assigns training drills to a roster; players (or parents, for younger kids) log what they actually did; everyone sees a consistency streak. Full context and product decisions are in Command-center's `DRILLSTREAK.md` — this file is the technical build brief only.

## Tech stack
Expo (React Native) + Supabase (Postgres, auth, RLS) + RevenueCat (subscriptions) + `expo-calendar` (native calendar write). No Mac required — EAS handles iOS builds in the cloud.

## Screens (5)
1. Home/Today — today's drills, mark-done, streak counter
2. My Team — coach-only: roster, add/remove players, assign weekly drills
3. Add a Player — create a player profile, join via team invite code, or default library
4. Progress — streak calendar/weekly recap, free tier = current week only
5. Account — manage `parent_tier` / `coach_tier` independently, both can be active at once

## Data model
See `supabase/schema.sql` in this folder for the actual CREATE TABLE + RLS draft. Summary:
- `players` — a profile (self or a kid), owned by the account that created it
- `guardianships` — links additional accounts (e.g. a second parent) to a player
- `teams` / `team_memberships` — a coach's roster
- `drills` — shared default library (`is_default = true`) plus user-created custom drills (`created_by_user_id` set); **no cap on custom drill creation** (decided July 19, 2026 — a weekly-cap gate only limits creating new drill types, not logging against existing ones, so it doesn't drive real paid conversion and would undercut Jay's own team piloting the app for free)
- `assignments` — either team-wide (coach → roster) or individual (self-picked from default library)
- `completions` — a logged drill instance; visible to a player's coach regardless of who defined the drill, because coach visibility into real effort is the entire point of the app

## Build order — exact prompts for Claude Code

Run these in order, in a fresh Expo project, once the real repo is reachable. Each is meant to be pasted as-is into a Claude Code session and iterated on (preview after each step before moving to the next).

**1. Scaffold**
```
Create a new Expo (React Native) project for an iOS app called DrillStreak.
Set up navigation with these screens: Home/Today, My Team, Add a Player,
Progress, Account.
Use a clean, minimal design with [1-2 accent colors — Jay to choose].
After each screen is created, show me how to preview it on my phone.
```

**2. Backend — Supabase + auth + RLS**
```
Connect this app to Supabase. Create these tables (see supabase/schema.sql
in this repo for the exact column list and RLS policies):
- players, guardianships, teams, team_memberships, drills, assignments,
  completions

Add email + password login using Supabase auth.
Apply the row-level security policies from supabase/schema.sql so:
- a user can only read/write completions for players they're linked to
  (as creator or guardian)
- a coach can read all completions for players on their own team's roster,
  regardless of who created the drill being logged
- a coach can only manage rosters/assignments for teams where they are
  the coach_user_id
Seed the drills table with 10 default basketball drills across
ballhandling, shooting, and conditioning categories (is_default = true).
```

**3. Core drill-logging loop**
```
On the Home/Today screen: show the current user's linked player(s). For each
player, show this week's assigned drills (team assignment if one exists,
otherwise the default drills library or their own custom drills). Let the
user tap a drill to mark it complete, which writes a row to completions and
shows a streak counter (consecutive days with at least one completion).
Keep every other screen exactly as it is.
```

**4. Coach team-assignment feature**
```
On the My Team screen: only show this screen's content if the current user
has a row in teams where they are the coach. Let them create a team, add
players to the roster (team_memberships), generate an invite code, and
assign drills (default library or custom) to the whole team for the current
week (writes to assignments with team_id set). Also show completions logged
by any player on the roster, including drills the player added themselves.
Keep every other screen exactly as it is.
```

**5. Guardian/player linking**
```
On the Add a Player screen: let a user create a player profile (name), which
creates a row in players and links it to them via guardianships. If a coach
has given them a team invite code, let them enter it to join that team's
roster instead of using the default drill library. Let any user (coach or
guardian/player) add a custom drill with a name and category — no limit on
how many.
Keep every other screen exactly as it is.
```

**6. Calendar integration**
```
Add expo-calendar to the project. When a drill/workout is assigned to a
player for a given day, let the user tap "Add to Calendar" to create a
matching event on their phone's native calendar (title = drill name,
date = assigned day). Request write-only calendar permission, not full
read access. This should work for both the coach assigning to a team and
a parent/player using the default drill library or their own custom drills.
Keep every other screen exactly as it is.
```

**7. Paywall**
```
Add a subscription paywall using RevenueCat with two independent
entitlements: "parent_tier" and "coach_tier" — a user can hold either,
both, or neither, on the same account.
Free tier: current week's drills and completions only, one linked player,
unlimited custom drills.
parent_tier ($X/month): full progress history, unlimited linked players.
coach_tier ($X/month): create teams, unlimited roster size, assign drills.
Show the relevant paywall only when a free user hits that tier's specific
limit, not before they've tried the app.
Note: Jay's own founder account should be manually granted both
entitlements so he can pilot the coach workflow with his real team without
hitting the paywall himself.
```

## Not yet done
- Domain purchase (`drillstreak.com` / `.app` were available at last check, July 2026 — not secured)
- Validation DMs to players/parents drafted but not confirmed sent
- No code has actually been run/tested anywhere — this is a spec handoff, not a working build
