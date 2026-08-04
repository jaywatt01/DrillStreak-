-- DrillStreak — schema, RLS, and seed data
--
-- This matches what's actually deployed to the live Supabase project
-- (jiohhwahvzajvidbiqnm) as of 2026-07-20. Applied via two migrations:
-- drillstreak_initial_schema, then fix_players_team_memberships_rls_recursion
-- (see the second block below — the original draft had a real bug, caught
-- by testing RLS as non-owner roles rather than trusting a service-role
-- read-through, which bypasses RLS and would never have surfaced it).
--
-- add_drill_duration_and_assignment_schedule (2026-07-24) adds
-- estimated_minutes to drills and scheduled_time/duration_minutes to
-- assignments, both nullable, both covered by existing RLS policies
-- (no new policy needed — same rows, new columns). See that block below
-- for the exact statements and the seeded-drill backfill.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- players: a trackable profile — an adult self, or a kid a parent manages
-- ---------------------------------------------------------------------------
create table players (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  created_by_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- guardianships: lets a second account (e.g. the other parent) access a
-- player without being its original creator
create table guardianships (
  id uuid primary key default gen_random_uuid(),
  guardian_user_id uuid not null references auth.users(id),
  player_id uuid not null references players(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (guardian_user_id, player_id)
);

-- ---------------------------------------------------------------------------
-- teams: a coach's roster
-- ---------------------------------------------------------------------------
create table teams (
  id uuid primary key default gen_random_uuid(),
  coach_user_id uuid not null references auth.users(id),
  name text not null,
  invite_code text not null unique default substr(md5(random()::text), 1, 8),
  created_at timestamptz not null default now()
);

create table team_memberships (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (team_id, player_id)
);

-- ---------------------------------------------------------------------------
-- drills: shared default library + user/coach-created custom drills
-- No cap on custom drill count (decided July 19, 2026)
-- ---------------------------------------------------------------------------
create table drills (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text, -- e.g. ballhandling / shooting / conditioning
  is_default boolean not null default false,
  created_by_user_id uuid references auth.users(id), -- null for seeded defaults
  -- player this custom drill belongs to (null for defaults, and for a
  -- coach's own team-assignment drills that aren't tied to one player).
  -- Added July 20, 2026 after a real bug: without this, a custom drill
  -- was scoped to the creating account, not the selected player, so a
  -- guardian with two kids saw a drill meant for one show up for both.
  player_id uuid references players(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Estimated length of the drill, in minutes. Null for anything without a
  -- set duration (most reps-based drills) — the app falls back to a 30-min
  -- default at add-to-calendar time rather than a fabricated per-drill guess.
  estimated_minutes integer,
  -- Added 2026-07-29, from real NBA-level product feedback (Chris Hines,
  -- Minnesota Timberwolves — see DRILLSTREAK.md): a link to a demo video
  -- for the drill. Optional, settable at custom-drill creation/rename;
  -- the 10 seeded defaults start null (never fabricate a YouTube URL —
  -- Jay adds real ones directly via SQL once he has them).
  video_url text
);

-- ---------------------------------------------------------------------------
-- assignments: team-wide (coach -> roster) or individual (self-picked)
-- ---------------------------------------------------------------------------
create table assignments (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade,
  player_id uuid references players(id) on delete cascade,
  drill_id uuid not null references drills(id),
  week_of date not null,
  created_at timestamptz not null default now(),
  check (team_id is not null or player_id is not null),
  -- Coach-set suggested time/duration for a team assignment (added
  -- 2026-07-24). This is a default the player's calendar picker pre-fills
  -- to, not a push to their calendar — expo-calendar only ever writes to
  -- whichever device is running the app.
  scheduled_time time,
  duration_minutes integer
);

-- ---------------------------------------------------------------------------
-- completions: a logged instance of a drill, on a given day
-- ---------------------------------------------------------------------------
create table completions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  drill_id uuid not null references drills(id),
  date date not null default current_date,
  note text,
  created_at timestamptz not null default now(),
  -- Added 2026-07-26 after a real bug: the Home screen let an
  -- already-marked-done drill be tapped again, inserting a duplicate row
  -- every time (caught by Jay seeing the same drill 4x on one day in
  -- Progress). This is the data-layer backstop; the UI fix disables the
  -- button once done, this stops races/retries/direct-API duplicates.
  unique (player_id, drill_id, date),
  -- Added 2026-07-29, from the same NBA-level feedback as drills.video_url:
  -- an optional numeric result attached to a completion — makes/attempts
  -- for a shooting drill, or just `attempts` alone as a generic rep count
  -- for anything else (e.g. "did 8 suicides" -> attempts=8, makes=null).
  -- Both null by default; logging a result is optional, same trust model
  -- as completions themselves (100% self-reported, no verification).
  makes integer,
  attempts integer
);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table players enable row level security;
alter table guardianships enable row level security;
alter table teams enable row level security;
alter table team_memberships enable row level security;
alter table drills enable row level security;
alter table assignments enable row level security;
alter table completions enable row level security;

-- players: visible/editable by their creator, any linked guardian, or a
-- coach whose team the player is on
create policy players_access on players
  for all
  using (
    created_by_user_id = auth.uid()
    or exists (
      select 1 from guardianships g
      where g.player_id = players.id and g.guardian_user_id = auth.uid()
    )
    or exists (
      select 1 from team_memberships tm
      join teams t on t.id = tm.team_id
      where tm.player_id = players.id and t.coach_user_id = auth.uid()
    )
  );

create policy guardianships_access on guardianships
  for all
  using (guardian_user_id = auth.uid());

-- teams: full access for the coach who owns it. Non-coaches CANNOT select
-- from this table directly (would expose every team's invite_code to any
-- logged-in user, defeating the point of a private code) — invite-code
-- redemption goes through the redeem_team_invite() function below instead.
create policy teams_coach_access on teams
  for all
  using (coach_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- is_player_owner_or_guardian: security-definer helper used by policies
-- below instead of an inline EXISTS on `players`. players_access (above)
-- checks team_memberships; if team_memberships' own policy checked players
-- directly, evaluating either policy would recurse into the other forever
-- (confirmed live: "infinite recursion detected in policy for relation
-- players"). This function bypasses RLS internally, breaking the cycle.
-- ---------------------------------------------------------------------------
create or replace function is_player_owner_or_guardian(p_player_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from players p
    where p.id = p_player_id
      and (p.created_by_user_id = p_user_id
        or exists (select 1 from guardianships g where g.player_id = p.id and g.guardian_user_id = p_user_id))
  );
$$;

revoke all on function is_player_owner_or_guardian(uuid, uuid) from public;
revoke all on function is_player_owner_or_guardian(uuid, uuid) from anon;
grant execute on function is_player_owner_or_guardian(uuid, uuid) to authenticated;

create policy team_memberships_access on team_memberships
  for all
  using (
    exists (select 1 from teams t where t.id = team_memberships.team_id and t.coach_user_id = auth.uid())
    or is_player_owner_or_guardian(team_memberships.player_id, auth.uid())
  );

-- drills: default library is world-readable; custom drills are visible to
-- their creator, anyone who owns/guards the player they're scoped to (so a
-- second guardian linked to the same player sees drills the first guardian
-- made for that player), plus anyone who can see an assignment/completion
-- using them
create policy drills_select on drills
  for select
  using (
    is_default = true
    or created_by_user_id = auth.uid()
    or (player_id is not null and is_player_owner_or_guardian(player_id, auth.uid()))
    or exists (
      select 1 from assignments a
      where a.drill_id = drills.id
      and (
        exists (select 1 from teams t where t.id = a.team_id and t.coach_user_id = auth.uid())
        or is_player_owner_or_guardian(a.player_id, auth.uid())
      )
    )
  );

-- if player_id is set, the creator must actually own/guard that player -
-- prevents attaching a "custom drill" to a player you have no relationship to
create policy drills_insert on drills
  for insert
  with check (
    created_by_user_id = auth.uid()
    and (player_id is null or is_player_owner_or_guardian(player_id, auth.uid()))
  );

-- edit/delete only your own custom drills - never the seeded defaults.
-- Added July 20, 2026: there was no UPDATE/DELETE policy on drills at all
-- before this, so nobody could rename or remove a custom drill via the API.
create policy drills_update on drills
  for update
  using (created_by_user_id = auth.uid() and is_default = false)
  with check (created_by_user_id = auth.uid() and is_default = false);

create policy drills_delete on drills
  for delete
  using (created_by_user_id = auth.uid() and is_default = false);

-- assignments: coach manages team assignments; guardian/player manages
-- their own individual (non-team) assignments
create policy assignments_access on assignments
  for all
  using (
    (team_id is not null and exists (select 1 from teams t where t.id = assignments.team_id and t.coach_user_id = auth.uid()))
    or (player_id is not null and is_player_owner_or_guardian(assignments.player_id, auth.uid()))
  );

-- completions: writable by the player's owner/guardian; readable by them
-- AND by the coach of any team the player is on (accountability is the
-- whole point — coach sees real logs regardless of who defined the drill)
create policy completions_owner_access on completions
  for all
  using (is_player_owner_or_guardian(completions.player_id, auth.uid()));

-- Restricted to the current week (2026-07-26). Coach role is free forever
-- by design, but this policy previously had no date bound at all, so a
-- parent could self-coach their own kid and read that kid's FULL history
-- straight from the API, bypassing the $4.99/mo parent_tier history
-- paywall entirely at the data layer. The app's own My Team screen never
-- asks for more than the current week (getRosterCompletionsThisWeek), so
-- this matches existing product behavior exactly — no legitimate feature
-- relied on a coach reading further back than this.
create policy completions_coach_read on completions
  for select
  using (
    completions.date >= date_trunc('week', current_date)::date
    and exists (
      select 1 from team_memberships tm
      join teams t on t.id = tm.team_id
      where tm.player_id = completions.player_id and t.coach_user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- redeem_team_invite: lets a guardian/player join a team by invite code
-- without exposing the teams table to broad SELECT. Runs as security
-- definer so it can look up the team by code, but re-checks the caller
-- actually owns/guards the player being added before inserting.
-- ---------------------------------------------------------------------------
create or replace function redeem_team_invite(p_invite_code text, p_player_id uuid)
returns team_memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team teams;
  v_result team_memberships;
begin
  select * into v_team from teams where invite_code = p_invite_code;
  if v_team.id is null then
    raise exception 'Invalid invite code';
  end if;

  if not exists (
    select 1 from players p
    where p.id = p_player_id
      and (p.created_by_user_id = auth.uid()
        or exists (select 1 from guardianships g where g.player_id = p.id and g.guardian_user_id = auth.uid()))
  ) then
    raise exception 'Not authorized for this player';
  end if;

  insert into team_memberships (team_id, player_id)
  values (v_team.id, p_player_id)
  on conflict (team_id, player_id) do nothing
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function redeem_team_invite(text, uuid) from public;
revoke all on function redeem_team_invite(text, uuid) from anon;
grant execute on function redeem_team_invite(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- list_my_players: players the current user can log drills for — i.e. owns
-- or guards. Deliberately narrower than what players_access RLS allows to
-- see (which also includes players visible only because you coach their
-- team) — the Home/Today screen is a player-side logging surface, not a
-- coach roster view, so it must not surface players you can only see
-- because you coach them. security invoker (default) so RLS on the
-- underlying tables still applies as defense in depth.
-- ---------------------------------------------------------------------------
create or replace function list_my_players()
returns setof players
language sql
stable
security invoker
set search_path = public
as $$
  select p.* from players p
  where p.created_by_user_id = auth.uid()
  union
  select p.* from players p
  join guardianships g on g.player_id = p.id
  where g.guardian_user_id = auth.uid();
$$;

grant execute on function list_my_players() to authenticated;

-- ---------------------------------------------------------------------------
-- Seed: default drill library (10 drills, 3 categories)
-- estimated_minutes is only backfilled for the 4 drills that already state
-- a time in their name — the other 6 are rep-based with no stated time, so
-- they're left null rather than inventing a fabricated per-drill estimate;
-- the app's 30-min default applies to those at add-to-calendar time.
-- ---------------------------------------------------------------------------
insert into drills (name, category, is_default, estimated_minutes) values
  ('50 form shooting reps', 'shooting', true, null),
  ('100 free throws', 'shooting', true, null),
  ('Spot-up shooting, 5 spots x 10', 'shooting', true, null),
  ('Two-ball dribbling, 5 min', 'ballhandling', true, 5),
  ('Cone weave dribbling, 10 reps', 'ballhandling', true, null),
  ('Crossover series, 5 min', 'ballhandling', true, 5),
  ('Suicides x 5', 'conditioning', true, null),
  ('Defensive slides, 5 min', 'conditioning', true, 5),
  ('Jump rope, 10 min', 'conditioning', true, 10),
  ('Full-court sprints x 10', 'conditioning', true, null);

-- ---------------------------------------------------------------------------
-- Migration for the already-deployed database (2026-07-24): the block
-- above only applies estimated_minutes on a fresh seed. Run this against
-- the live project to add the new columns and backfill the same 4 drills.
-- ---------------------------------------------------------------------------
-- alter table drills add column estimated_minutes integer;
-- alter table assignments add column scheduled_time time;
-- alter table assignments add column duration_minutes integer;
--
-- update drills set estimated_minutes = 5 where name = 'Two-ball dribbling, 5 min';
-- update drills set estimated_minutes = 5 where name = 'Crossover series, 5 min';
-- update drills set estimated_minutes = 5 where name = 'Defensive slides, 5 min';
-- update drills set estimated_minutes = 10 where name = 'Jump rope, 10 min';

-- ---------------------------------------------------------------------------
-- Migration for the already-deployed database (2026-07-26): dedupe testing
-- artifacts, then add the constraint that stops future duplicates, then
-- tighten the coach-read policy to current-week-only. Run against the live
-- project in this order.
-- ---------------------------------------------------------------------------
-- -- 1. Collapse existing duplicate (player_id, drill_id, date) rows down to
-- --    one each, keeping the earliest, before the unique constraint can be
-- --    added (it will fail on any table that still has duplicates in it).
-- delete from completions a using completions b
--   where a.player_id = b.player_id
--     and a.drill_id = b.drill_id
--     and a.date = b.date
--     and a.created_at > b.created_at;
--
-- -- 2. Stop it from happening again, at the data layer.
-- alter table completions add constraint completions_player_drill_date_key
--   unique (player_id, drill_id, date);
--
-- -- 3. Close the paywall-bypass gap: a coach could previously read a
-- --    roster player's full completion history (not just this week)
-- --    straight from the API, regardless of parent_tier.
-- drop policy completions_coach_read on completions;
-- create policy completions_coach_read on completions
--   for select
--   using (
--     completions.date >= date_trunc('week', current_date)::date
--     and exists (
--       select 1 from team_memberships tm
--       join teams t on t.id = tm.team_id
--       where tm.player_id = completions.player_id and t.coach_user_id = auth.uid()
--     )
--   );

-- ---------------------------------------------------------------------------
-- Migration for the already-deployed database (2026-07-29): add the drill
-- results (makes/attempts) and drill video-link columns. Both nullable,
-- both covered by existing RLS policies (same rows, new columns, same
-- pattern as the 2026-07-24 duration/schedule migration) — no new policy
-- needed.
-- ---------------------------------------------------------------------------
-- alter table drills add column video_url text;
-- alter table completions add column makes integer;
-- alter table completions add column attempts integer;
