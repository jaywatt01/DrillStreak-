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
  created_at timestamptz not null default now(),
  -- Added 2026-08-14, part of the recruitment-layer build (Horizon 2 in
  -- DRILLSTREAK.md): the bio fields a real recruiting profile needs
  -- alongside activity data. All nullable/optional — same trust model as
  -- everything else in this app (self-reported, no verification). height/
  -- weight are free text ("6'2\"", "165 lbs"), not a structured unit — see
  -- the Player type comment in lib/players.ts for why. position is free
  -- text too, not a fixed enum, since the app is deliberately
  -- sport-agnostic. No new RLS needed — players_access already covers
  -- these (same rows, new columns, same pattern as the 2026-07-24
  -- estimated_minutes/scheduled_time migration above).
  height text,
  weight text,
  grad_year integer,
  position text,
  -- Added 2026-08-24: does this player row represent the account holder
  -- themselves (an adult self-tracker, OR a 13-17-year-old who signed up
  -- for their own account under the age gate), or a kid a parent is
  -- managing? Set once at creation (AddPlayerScreen), never inferred —
  -- there's no reliable way to tell the two apart from existing data
  -- alone (an adult and a self-signed-up teen both pass the same age
  -- gate). Drives is_player_restricted() below: an account whose ENTIRE
  -- roster presence on a team is self-tracked profiles (never a kid
  -- they're managing) gets the Team Chat restriction Jay asked for —
  -- can read the team-wide feed, can only ever message the coach
  -- directly, never post to the group or DM another family.
  is_account_holder boolean not null default false,
  -- Added 2026-08-25, part of the teammate-profile-viewing build: an
  -- opt-OUT (not opt-in) flag controlling whether this player's stats and
  -- bio are visible to teammates browsing get_teammates() results, in
  -- addition to their own owner/guardian and any coach. Defaults true —
  -- the whole roster already sees each other in Team Board, so opt-in-only
  -- would produce the same cold-start problem most opt-in comparison
  -- features hit (almost nobody turns it on). Comparison/leaderboard
  -- features stay opt-in per the ClassDojo design rules in DRILLSTREAK.md's
  -- Growth strategy section, but this is closer to "more detail within an
  -- existing relationship" than a new comparison surface — a family can
  -- still flip it off per player.
  stats_visible_to_team boolean not null default true
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
  created_at timestamptz not null default now(),
  -- Added 2026-07-29, from Rylee's idea via the same feedback batch as
  -- makes/attempts: a coach-level nudge, not an enforcement gate. When on,
  -- marking a team-assigned drill done auto-opens the result-logging modal
  -- instead of requiring a second tap — still fully skippable. Deliberately
  -- NOT a hard requirement to mark a drill done: a mandatory gate with no
  -- verification doesn't make self-reported data more honest, it just
  -- makes skipping it look like a fabricated number instead of an honest
  -- blank. Default false so existing teams' behavior doesn't silently change.
  prompt_for_results boolean not null default false
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

-- player_has_prompt_for_results: security-definer helper, same reason as
-- is_player_owner_or_guardian above but for a different recursion-shaped
-- problem. teams_coach_access (below) intentionally restricts SELECT on
-- teams to the owning coach only (protects invite codes). That means a
-- player-side embedded select of `team_memberships -> teams(prompt_for_results)`
-- silently comes back null for every non-coach caller — RLS doesn't error,
-- it just omits the nested row — so the coach's result-prompt toggle never
-- actually reached the player's app. This function bypasses teams RLS
-- internally but re-checks ownership itself, so it can't be used to probe
-- any player/team other than one the caller actually owns or guards.
create or replace function player_has_prompt_for_results(p_player_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    is_player_owner_or_guardian(p_player_id, auth.uid())
    and exists (
      select 1
      from team_memberships tm
      join teams t on t.id = tm.team_id
      where tm.player_id = p_player_id
        and t.prompt_for_results = true
    );
$$;

revoke all on function player_has_prompt_for_results(uuid) from public;
revoke all on function player_has_prompt_for_results(uuid) from anon;
grant execute on function player_has_prompt_for_results(uuid) to authenticated;

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

-- ---------------------------------------------------------------------------
-- drill_videos: a pool of candidate videos for a drill (added 2026-07-29,
-- same NBA-level feedback batch as drills.video_url/completions.makes -
-- see DRILLSTREAK.md). Distinct from drills.video_url (a single link, set
-- at custom-drill creation/rename, unaffected by this table): when a drill
-- has rows here, the app auto-rotates which one displays instead of using
-- the single field. Rotation itself is a pure client-side date computation
-- (see pickRotatingVideo in src/lib/players.ts) — no cron job, no stored
-- "current index," so this table only ever needs the actual video pool.
-- ---------------------------------------------------------------------------
create table drill_videos (
  id uuid primary key default gen_random_uuid(),
  drill_id uuid not null references drills(id) on delete cascade,
  url text not null,
  created_at timestamptz not null default now()
);

alter table drill_videos enable row level security;

-- Readable by anyone who can already see the parent drill — mirrors
-- drills_select's exact visibility logic rather than re-deriving it.
create policy drill_videos_select on drill_videos
  for select
  using (
    exists (
      select 1 from drills d
      where d.id = drill_videos.drill_id
      and (
        d.is_default = true
        or d.created_by_user_id = auth.uid()
        or (d.player_id is not null and is_player_owner_or_guardian(d.player_id, auth.uid()))
        or exists (
          select 1 from assignments a
          where a.drill_id = d.id
          and (
            exists (select 1 from teams t where t.id = a.team_id and t.coach_user_id = auth.uid())
            or is_player_owner_or_guardian(a.player_id, auth.uid())
          )
        )
      )
    )
  );

-- Writable only by whoever owns the parent custom drill (mirrors
-- drills_update) — no app UI uses this yet (Jay populates via SQL for now,
-- same workflow as the default-drill video URLs), but this keeps the door
-- open for a coach to manage their own custom drill's video pool later
-- without a schema change.
create policy drill_videos_write on drill_videos
  for all
  using (
    exists (
      select 1 from drills d
      where d.id = drill_videos.drill_id
      and d.created_by_user_id = auth.uid()
      and d.is_default = false
    )
  );

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

-- coach_has_real_roster: true if this coach's roster has at least 3
-- players who are NOT owned/guarded by the coach themselves — i.e., real
-- other families, not the coach's own kid(s) or dummy profiles the coach
-- created to pad a fake roster. Added 2026-08-23, see DRILLSTREAK.md's
-- "coach-access gap" note for the full reasoning: counting raw player
-- count would be gameable (a coach can create throwaway player profiles
-- in one tap), but a dummy profile is still owned by the coach's own
-- account, so it never counts here — genuinely defeating that shortcut,
-- not just discouraging it. The threshold (3) is a judgment call, not
-- derived from data — easy to tune later via one line.
create or replace function coach_has_real_roster(p_coach_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select count(*) >= 3
  from team_memberships tm
  join teams t on t.id = tm.team_id
  where t.coach_user_id = p_coach_user_id
    and not is_player_owner_or_guardian(tm.player_id, p_coach_user_id);
$$;

revoke all on function coach_has_real_roster(uuid) from public;
revoke all on function coach_has_real_roster(uuid) from anon;
grant execute on function coach_has_real_roster(uuid) to authenticated;

-- Restricted to the current week by default (2026-07-26). Coach role is
-- free forever by design, but this policy previously had no date bound at
-- all, so a parent could self-coach their own kid and read that kid's
-- FULL history straight from the API, bypassing the $4.99/mo parent_tier
-- history paywall entirely at the data layer.
--
-- Widened 2026-08-23: the original fix above closed the loophole but was
-- too blunt for a real, common case — a coach who coaches their own kid
-- alongside a real roster of other kids could see everyone else's full
-- history for free except their own kid's, which is backwards. Two
-- additional OR branches: full history for any player the coach does NOT
-- own/guard (was already the intent, just never had this second
-- condition to lean on), and full history for EVERY player on the
-- roster — including the coach's own kid — once coach_has_real_roster
-- confirms this is a genuine multi-family team, not a fake team-of-one.
create policy completions_coach_read on completions
  for select
  using (
    exists (
      select 1 from team_memberships tm
      join teams t on t.id = tm.team_id
      where tm.player_id = completions.player_id and t.coach_user_id = auth.uid()
    )
    and (
      completions.date >= date_trunc('week', current_date)::date
      or not is_player_owner_or_guardian(completions.player_id, auth.uid())
      or coach_has_real_roster(auth.uid())
    )
  );

-- is_teammate_of: security-definer, same reason as is_player_owner_or_
-- guardian/get_teammates above — team_memberships_access RLS only lets a
-- caller read a membership row for a player they own/guard or coach, so an
-- inline "do these two players share a team" check would silently see
-- nothing for anyone but the coach. True if p_viewer_user_id owns/guards
-- SOME player (other than p_player_id itself) that shares at least one
-- team with p_player_id. Added 2026-08-25 for teammate profile/stats
-- viewing — same underlying join as get_teammates, factored out since
-- completions_teammate_read below needs the boolean, not the full list.
create or replace function is_teammate_of(p_player_id uuid, p_viewer_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from team_memberships tm_target
    join team_memberships tm_viewer on tm_viewer.team_id = tm_target.team_id
    where tm_target.player_id = p_player_id
      and tm_viewer.player_id <> p_player_id
      and is_player_owner_or_guardian(tm_viewer.player_id, p_viewer_user_id)
  );
$$;

revoke all on function is_teammate_of(uuid, uuid) from public;
revoke all on function is_teammate_of(uuid, uuid) from anon;
grant execute on function is_teammate_of(uuid, uuid) to authenticated;

-- completions_teammate_read: lets a teammate (not the coach — that's
-- completions_coach_read above) see another roster player's full
-- completion history, gated by that player's own stats_visible_to_team
-- opt-out flag. Deliberately NOT restricted to the current week the way
-- completions_coach_read's paywall-bypass guard is — a season shooting %
-- comparison needs more than one week of data, and this isn't a paywall
-- bypass concern since it's a different player's data, not the viewer's
-- own. The opt-out flag is the actual privacy control here.
create policy completions_teammate_read on completions
  for select
  using (
    exists (select 1 from players p where p.id = completions.player_id and p.stats_visible_to_team = true)
    and is_teammate_of(completions.player_id, auth.uid())
  );

-- ---------------------------------------------------------------------------
-- player_notes: a coach's own evolving note about a player on their roster
-- (added 2026-08-14, part of the recruitment-layer build in DRILLSTREAK.md —
-- see that file's "Recruitment/scholarship mechanism" section, Horizon 2).
-- One row per (player, coach), not a feed — a coach's take on a player is
-- meant to be edited over time, not logged as separate dated entries.
-- Deliberately NOT gated behind parent_tier: this is coach-authored content
-- about the player, not app-usage history, so the history paywall doesn't
-- apply — matches "coach features are free, always" positioning everywhere
-- else in this app.
-- ---------------------------------------------------------------------------
create table player_notes (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  coach_user_id uuid not null references auth.users(id),
  note text not null,
  updated_at timestamptz not null default now(),
  unique (player_id, coach_user_id)
);

alter table player_notes enable row level security;

-- Starting a note requires actually coaching this player right now — same
-- team_memberships/teams join pattern already proven safe in
-- players_access/completions_coach_read above, so no new recursion risk.
create policy player_notes_coach_insert on player_notes
  for insert
  with check (
    coach_user_id = auth.uid()
    and exists (
      select 1 from team_memberships tm
      join teams t on t.id = tm.team_id
      where tm.player_id = player_notes.player_id and t.coach_user_id = auth.uid()
    )
  );

-- Managing an existing note is author-only, with no team-membership
-- requirement — deliberately NOT the same condition as the insert policy
-- above. Caught in review: if select/update/delete also required active
-- team membership, removing a player from the roster would permanently
-- lock the coach out of their own note (RLS would block their own
-- SELECT/UPDATE/DELETE) while the player/guardian could still read it
-- forever via player_notes_player_read below — an orphaned note with no
-- way to ever edit or delete it. A coach keeps ownership of content they
-- authored, same "profile/history stays intact after roster removal"
-- behavior as the rest of the app (see removeFromRoster in lib/team.ts).
create policy player_notes_coach_select on player_notes
  for select
  using (coach_user_id = auth.uid());

create policy player_notes_coach_update on player_notes
  for update
  using (coach_user_id = auth.uid())
  with check (coach_user_id = auth.uid());

create policy player_notes_coach_delete on player_notes
  for delete
  using (coach_user_id = auth.uid());

-- Read-only for the player's own owner/guardian — always visible (not tied
-- to a specific team's coach-read date bound above; a note isn't usage
-- history, so the completions_coach_read anti-paywall-bypass restriction
-- doesn't apply here).
create policy player_notes_player_read on player_notes
  for select
  using (is_player_owner_or_guardian(player_notes.player_id, auth.uid()));

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
-- challenges: mutual/opt-in head-to-head between two teammates (Apple Watch
-- Activity-style), added 2026-08-05 per DRILLSTREAK.md's Future Feature
-- Idea #1 and the growth-strategy application ranking it as the one real
-- acquisition-driving (not just engagement) feature. Scoped to teammates on
-- the same roster, not open cross-team/stranger challenges — matches the
-- actual validated signal (teammates comparing streaks) and avoids the
-- bigger stranger-visibility design problem a friend-code system would
-- open up. Metric is total drill completions logged during the window —
-- reuses the existing completions table, no new column needed there.
-- `accepted` false = pending invite; true = active/ongoing. "Declined" is
-- a delete, not a third status; "completed" is derived at read time
-- (ends_at in the past), never written — same compute-don't-store pattern
-- already used for streaks and video rotation elsewhere in this schema.
-- starts_at/ends_at are null until accepted (set at accept time, not
-- creation) — a real bug caught the same day this shipped: setting them at
-- creation meant any drill the challenger logged earlier that same day,
-- before ever sending the invite, counted toward their total immediately.
-- Second real bug, caught the same day as the first fix: starts_at/ends_at
-- are DATE columns (day granularity), so moving them to accept-time only
-- fixed the case where creation and acceptance fall on different days — if
-- both happen the same day (the common case in real testing), any drill
-- already logged earlier that same day still shared `date = starts_at`
-- and still counted. Fixed properly with `accepted_at` (a real timestamp,
-- not a date) as the actual counting boundary — see accept_challenge and
-- get_player_challenges below. starts_at/ends_at stay as dates purely for
-- the human-readable "N days left" display.
-- ---------------------------------------------------------------------------
create table challenges (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  challenger_player_id uuid not null references players(id) on delete cascade,
  opponent_player_id uuid not null references players(id) on delete cascade,
  starts_at date,
  ends_at date,
  accepted_at timestamptz,
  accepted boolean not null default false,
  created_at timestamptz not null default now(),
  check (challenger_player_id <> opponent_player_id),
  check (ends_at > starts_at)
);

alter table challenges enable row level security;

-- Same shape as completions_owner_access: either side of the challenge can
-- see/update/delete it (accept = via accept_challenge below; decline = delete).
create policy challenges_access on challenges
  for all
  using (
    is_player_owner_or_guardian(challenger_player_id, auth.uid())
    or is_player_owner_or_guardian(opponent_player_id, auth.uid())
  );

-- accept_challenge: sets accepted_at server-side via now() rather than
-- trusting a client-supplied timestamp — the client clock could be wrong
-- or, worse, deliberately backdated to inflate a score. security invoker
-- (default) is enough here: challenges_access RLS already lets the
-- opponent update this row, this function just guarantees the timestamp
-- itself is real server time.
create or replace function accept_challenge(p_challenge_id uuid)
returns void
language sql
set search_path = public
as $$
  update challenges
  set accepted = true,
      accepted_at = now(),
      starts_at = current_date,
      ends_at = current_date + 7
  where id = p_challenge_id;
$$;

grant execute on function accept_challenge(uuid) to authenticated;

-- get_teammates: security-definer, same reason as player_has_prompt_for_
-- results above — players_access RLS only lets a caller see a players row
-- they own/guard or coach, so a player could never list *other* players on
-- their own team to pick a challenge opponent from. Bypasses that
-- restriction for id+display_name+bio, re-verifying the caller actually
-- owns/guards p_player_id first.
--
-- Widened 2026-08-25 (teammate profile viewing): added the bio fields and
-- stats_visible_to_team so a single call serves both the existing
-- challenge-opponent picker AND a new teammate-profile list, instead of
-- two near-duplicate queries. Deliberately still returns EVERY teammate
-- regardless of stats_visible_to_team — challenging someone isn't the same
-- as browsing their stats, so the challenge picker (already live) must
-- keep seeing the full roster. The flag is returned so a profile-browsing
-- screen can show "Private profile" for an opted-out teammate instead of
-- hiding them outright; completions_teammate_read above is the actual
-- enforcement, this flag is just what the UI reads to decide what to show.
-- "position" is quoted in this RETURNS TABLE list — real error hit live
-- (2026-08-25): unquoted, it's a syntax error ("42601: syntax error at or
-- near position") specifically in a function's RETURNS TABLE parameter
-- list, even though the exact same word is a perfectly valid unquoted
-- column name in a plain CREATE TABLE (see players.position above) —
-- Postgres's RETURNS TABLE grammar parses more strictly than a table
-- column list for a handful of SQL-standard reserved keywords. No quoting
-- needed anywhere else this column is referenced (p.position, a plain
-- select-list reference, is unambiguous).
create or replace function get_teammates(p_player_id uuid)
returns table(
  id uuid,
  display_name text,
  team_id uuid,
  "position" text,
  height text,
  weight text,
  grad_year integer,
  stats_visible_to_team boolean
)
language sql
security definer
stable
set search_path = public
as $$
  -- distinct on (p.id) so a pair sharing more than one team still returns
  -- one row per teammate, not one per shared team; team_id picked
  -- deterministically (lowest uuid) since which shared roster gets
  -- recorded on the resulting challenge doesn't matter functionally.
  select distinct on (p.id)
    p.id, p.display_name, tm_other.team_id,
    p.position, p.height, p.weight, p.grad_year, p.stats_visible_to_team
  from players p
  join team_memberships tm_other on tm_other.player_id = p.id
  join team_memberships tm_self on tm_self.team_id = tm_other.team_id
  where tm_self.player_id = p_player_id
    and p.id <> p_player_id
    and is_player_owner_or_guardian(p_player_id, auth.uid())
  order by p.id, tm_other.team_id;
$$;

revoke all on function get_teammates(uuid) from public;
revoke all on function get_teammates(uuid) from anon;
grant execute on function get_teammates(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- workout_templates: a player's own saved custom workout (an ordered set of
-- drills they build once and reuse) — added 2026-08-25. Same ownership
-- shape as custom drills: scoped to one player, editable by whoever
-- owns/guards that player.
-- ---------------------------------------------------------------------------
create table workout_templates (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table workout_template_drills (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references workout_templates(id) on delete cascade,
  drill_id uuid not null references drills(id),
  sort_order integer not null default 0
);

alter table workout_templates enable row level security;
alter table workout_template_drills enable row level security;

create policy workout_templates_access on workout_templates
  for all
  using (is_player_owner_or_guardian(workout_templates.player_id, auth.uid()));

-- Joins back to workout_templates rather than embedding its own
-- player_id — one ownership check to maintain, not two copies of the same
-- rule that could drift out of sync.
create policy workout_template_drills_access on workout_template_drills
  for all
  using (
    exists (
      select 1 from workout_templates wt
      where wt.id = workout_template_drills.template_id
        and is_player_owner_or_guardian(wt.player_id, auth.uid())
    )
  );

-- get_player_challenges: security-definer for the same reason as
-- get_teammates — rendering a challenge needs the OTHER player's display
-- name and completion count, both blocked by players_access/completions
-- RLS for anyone but that player's own owner/guardian. Returns only
-- aggregated counts for the opponent side (never raw completion rows), and
-- re-verifies the caller owns/guards p_player_id before returning anything.
create or replace function get_player_challenges(p_player_id uuid)
returns table(
  id uuid,
  team_id uuid,
  challenger_player_id uuid,
  challenger_name text,
  challenger_completions bigint,
  opponent_player_id uuid,
  opponent_name text,
  opponent_completions bigint,
  starts_at date,
  ends_at date,
  accepted boolean,
  created_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    c.id, c.team_id,
    c.challenger_player_id, cp.display_name,
    -- created_at (a real timestamp), not date (day granularity) — the
    -- earlier fix used date >= starts_at, which still counted same-day
    -- completions logged before the actual accept moment. accepted_at is
    -- set server-side by accept_challenge, so this is trustworthy.
    (select count(*) from completions comp where comp.player_id = c.challenger_player_id
       and comp.created_at >= c.accepted_at and comp.date <= least(c.ends_at, current_date)),
    c.opponent_player_id, op.display_name,
    (select count(*) from completions comp where comp.player_id = c.opponent_player_id
       and comp.created_at >= c.accepted_at and comp.date <= least(c.ends_at, current_date)),
    c.starts_at, c.ends_at, c.accepted, c.created_at
  from challenges c
  join players cp on cp.id = c.challenger_player_id
  join players op on op.id = c.opponent_player_id
  where (c.challenger_player_id = p_player_id or c.opponent_player_id = p_player_id)
    and is_player_owner_or_guardian(p_player_id, auth.uid())
  order by c.created_at desc;
$$;

revoke all on function get_player_challenges(uuid) from public;
revoke all on function get_player_challenges(uuid) from anon;
grant execute on function get_player_challenges(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- badges: earned, private-by-default achievements (added 2026-08-25, Phase
-- 2 of the value-add brainstorm). Two types for v1: streak_7/streak_30/
-- streak_100 (crossed via calculateStreak, awarded client-side the first
-- time Home/Progress loads a streak at or past that number) and
-- challenge_won (awarded client-side when an ended challenge's counts show
-- this player ahead). Client-awarded rather than a server-side trigger —
-- badges are a cosmetic/motivational layer, not accountability data, so
-- porting the streak-with-grace algorithm into SQL to award these
-- server-side would be real complexity this doesn't need. Idempotency is
-- still enforced at the data layer, not just trusted client-side:
-- dedupe_key (below) plus a unique constraint means a re-triggered award
-- from a re-render, a second device, or a retried request can't create a
-- duplicate — same upsert-with-ignoreDuplicates shape as completions'
-- own dedup.
-- ---------------------------------------------------------------------------
create table badges (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  type text not null,
  -- The actual idempotency key: `type` itself for a singleton badge
  -- (streak_7/30/100 — only ever earned once per player), or
  -- 'challenge_won:' || challenge_id for a per-challenge badge (won more
  -- than once, one badge each time). A single `unique(player_id, type)`
  -- constraint can't express both shapes at once — this can, with one
  -- column and one constraint.
  dedupe_key text not null,
  challenge_id uuid references challenges(id) on delete set null,
  earned_at timestamptz not null default now(),
  unique (player_id, dedupe_key)
);

alter table badges enable row level security;

create policy badges_owner_access on badges
  for all
  using (is_player_owner_or_guardian(badges.player_id, auth.uid()));

create policy badges_coach_read on badges
  for select
  using (
    exists (
      select 1 from team_memberships tm
      join teams t on t.id = tm.team_id
      where tm.player_id = badges.player_id and t.coach_user_id = auth.uid()
    )
  );

-- Same opt-out visibility as stats — a teammate sees badges only if this
-- player's stats_visible_to_team is still true, one flag governing both.
create policy badges_teammate_read on badges
  for select
  using (
    exists (select 1 from players p where p.id = badges.player_id and p.stats_visible_to_team = true)
    and is_teammate_of(badges.player_id, auth.uid())
  );

-- ---------------------------------------------------------------------------
-- seasons: Phase 3, added 2026-08-25. A labeled date range wrapper around
-- a player's completions — "archive" means segment and label, never
-- delete or reset (see DRILLSTREAK.md's Phase 3 scoping note for the full
-- reasoning tying this to the existing multi-year recruitment-layer
-- commitment). At most one row per player has ended_at null at a time
-- (the active season) — enforced by the partial unique index below, not
-- just app discipline. Toggling In Season <-> Offseason always closes the
-- current active row (if any) and opens a new one with the opposite
-- is_offseason value; nothing about a closed season's data ever moves or
-- gets deleted, only completions.season_id (below) stops pointing at it
-- for new activity going forward.
-- ---------------------------------------------------------------------------
create table seasons (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  label text not null,
  is_offseason boolean not null default false,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create unique index seasons_one_active_per_player on seasons (player_id) where ended_at is null;

alter table seasons enable row level security;

create policy seasons_owner_access on seasons
  for all
  using (is_player_owner_or_guardian(seasons.player_id, auth.uid()));

-- A coach toggling the whole roster's season needs write access to every
-- roster player's seasons row, not just their own kid's — same
-- coach-controls-team-state shape as prompt_for_results/assignments
-- elsewhere in this schema, not a new trust model.
create policy seasons_coach_access on seasons
  for all
  using (
    exists (
      select 1 from team_memberships tm
      join teams t on t.id = tm.team_id
      where tm.player_id = seasons.player_id and t.coach_user_id = auth.uid()
    )
  );

-- Tags every new completion with whichever season is active for that
-- player at the moment it's logged — completions never gets a season_id
-- set by the client (see logCompletion in lib/players.ts, unchanged), this
-- trigger is the only thing that ever writes it. No security definer
-- needed: completions are only ever inserted by a player's own
-- owner/guardian (never a coach), and that same account already has
-- direct RLS read access to that player's seasons rows via
-- seasons_owner_access above, so the trigger runs fine with the caller's
-- own normal privileges. Stays null (career/unsegmented bucket) if the
-- player has never toggled a season — deliberately not backfilled for
-- existing history, per the Phase 3 scoping note.
alter table completions add column season_id uuid references seasons(id) on delete set null;

create or replace function set_completion_season()
returns trigger
language plpgsql
as $$
begin
  select id into new.season_id from seasons where player_id = new.player_id and ended_at is null limit 1;
  return new;
end;
$$;

create trigger completions_set_season
before insert on completions
for each row execute function set_completion_season();

-- Reverses an accidental season toggle (added 2026-08-25, Jay-requested
-- fail-safe). Not security-definer: runs under the caller's own RLS, same
-- reasoning as set_completion_season() above — whoever can call this
-- already has seasons_owner_access/seasons_coach_access on both rows. Does
-- nothing (silently) if the ids don't belong to the same player, or if
-- p_new_season_id isn't actually still open — both guard against a stale
-- retry acting on state that's already moved on. Delete-before-reopen
-- ordering is required: reopening p_previous_season_id while
-- p_new_season_id still has ended_at null would violate
-- seasons_one_active_per_player.
create or replace function undo_season_switch(p_previous_season_id uuid, p_new_season_id uuid)
returns void
language plpgsql
as $$
declare
  v_prev_player uuid;
  v_new_player uuid;
begin
  select player_id into v_prev_player from seasons where id = p_previous_season_id;
  select player_id into v_new_player from seasons where id = p_new_season_id and ended_at is null;

  if v_prev_player is null or v_new_player is null or v_prev_player <> v_new_player then
    return;
  end if;

  update completions set season_id = p_previous_season_id where season_id = p_new_season_id;
  delete from seasons where id = p_new_season_id;
  update seasons set ended_at = null where id = p_previous_season_id and ended_at is not null;
end;
$$;

grant execute on function undo_season_switch(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- is_on_team: security-definer helper for the Team Board build below (added
-- 2026-08-24). Same reason as is_player_owner_or_guardian/player_has_prompt_
-- for_results above — teams_coach_access restricts SELECT on `teams` to the
-- owning coach, so an inline check against an arbitrary p_user_id (not just
-- auth.uid()) would silently fail under RLS. True if p_user_id coaches
-- p_team_id, OR owns/guards a player rostered on it.
-- ---------------------------------------------------------------------------
create or replace function is_on_team(p_team_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    exists (select 1 from teams t where t.id = p_team_id and t.coach_user_id = p_user_id)
    or exists (
      select 1 from team_memberships tm
      where tm.team_id = p_team_id
        and is_player_owner_or_guardian(tm.player_id, p_user_id)
    );
$$;

revoke all on function is_on_team(uuid, uuid) from public;
revoke all on function is_on_team(uuid, uuid) from anon;
grant execute on function is_on_team(uuid, uuid) to authenticated;

-- is_player_restricted: added 2026-08-24 per Jay's direction — a
-- self-signed-up 13-17-year-old should be able to reach the coach
-- directly in Team Chat (ask about drills, say they'll be late) without
-- opening up the group feed or other families' DMs to them, keeping the
-- adults-only intent for everything except that one channel. True only
-- when p_user_id is NOT this team's coach, has at least one player
-- connection on the roster, AND every one of those player rows is marked
-- is_account_holder = true (their whole presence on this team is
-- self-tracked profiles, never a kid they're managing). A guardian
-- managing even one real kid's profile — including one who also
-- self-tracks themselves as a player — gets full access, since that's
-- clearly an adult account.
create or replace function is_player_restricted(p_team_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    not exists (select 1 from teams t where t.id = p_team_id and t.coach_user_id = p_user_id)
    and exists (
      select 1 from team_memberships tm
      join players p on p.id = tm.player_id
      where tm.team_id = p_team_id
        and is_player_owner_or_guardian(p.id, p_user_id)
    )
    and not exists (
      select 1 from team_memberships tm
      join players p on p.id = tm.player_id
      where tm.team_id = p_team_id
        and is_player_owner_or_guardian(p.id, p_user_id)
        and p.is_account_holder = false
    );
$$;

revoke all on function is_player_restricted(uuid, uuid) from public;
revoke all on function is_player_restricted(uuid, uuid) from anon;
grant execute on function is_player_restricted(uuid, uuid) to authenticated;

-- list_my_teams: every team a caller can reach — as coach, or as a
-- guardian of a rostered player. Nothing on My Team surfaces teams you
-- don't coach today, so this is the entry point the Team Board screen uses
-- to find teams a parent-only account is actually part of. security
-- definer for the same reason as is_on_team; invite_code is deliberately
-- returned null for guardian rows — teams_coach_access exists specifically
-- to keep invite codes coach-only, preserved here rather than reopened.
create or replace function list_my_teams()
returns table(id uuid, name text, invite_code text, role text, restricted boolean)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.name, t.invite_code, 'coach'::text as role, false as restricted
  from teams t
  where t.coach_user_id = auth.uid()
  union
  select distinct t.id, t.name, null::text as invite_code, 'guardian'::text as role,
    is_player_restricted(t.id, auth.uid()) as restricted
  from teams t
  join team_memberships tm on tm.team_id = t.id
  where is_player_owner_or_guardian(tm.player_id, auth.uid())
    and t.coach_user_id <> auth.uid();
$$;

revoke all on function list_my_teams() from public;
revoke all on function list_my_teams() from anon;
grant execute on function list_my_teams() to authenticated;

-- list_team_contacts: the "who can I DM" list for a team, and (as of
-- 2026-08-24) also what Team Chat renders as each message's sender label.
-- Prefers the account's own profiles.display_name once set (Account
-- screen); falls back to a role-based label ("Coach", "Parent of Jayden")
-- for anyone who hasn't set one — never an email either way, so this list
-- can't double as a way to harvest another family's contact info. `role`
-- (added same day as is_player_restricted) lets the client reliably find
-- "the coach" entry by role rather than matching the label string, which
-- breaks the moment a coach sets their own display_name to something
-- other than literally "Coach".
--
-- The created_by_user_id branch's fallback label (no profiles.display_name
-- set) special-cases is_account_holder: a self-signed-up player whose
-- ENTIRE created-players group is is_account_holder = true gets labeled
-- with just their own player name(s), not "Parent of {their own name}" —
-- real cosmetic bug caught the same day this shipped, since the original
-- version always used the "Parent of" framing regardless of who the
-- player row actually represents. An account that both self-tracks AND
-- manages a real kid still gets "Parent of {kid's name}" — the `filter`
-- clause below excludes any self-tracked row's own name from that list,
-- so it's never phrased as "Parent of {their own name}" even in that
-- mixed case.
create or replace function list_team_contacts(p_team_id uuid)
returns table(user_id uuid, label text, role text)
language sql
stable
security definer
set search_path = public
as $$
  select t.coach_user_id, coalesce(pr.display_name, 'Coach'), 'coach'::text
  from teams t
  left join profiles pr on pr.user_id = t.coach_user_id
  where t.id = p_team_id
    and is_on_team(p_team_id, auth.uid())
  union
  select g.guardian_user_id, coalesce(max(pr.display_name), 'Parent of ' || string_agg(distinct p.display_name, ', ')), 'guardian'::text
  from team_memberships tm
  join players p on p.id = tm.player_id
  join guardianships g on g.player_id = p.id
  left join profiles pr on pr.user_id = g.guardian_user_id
  where tm.team_id = p_team_id
    and is_on_team(p_team_id, auth.uid())
    and g.guardian_user_id <> (select coach_user_id from teams where id = p_team_id)
  group by g.guardian_user_id
  union
  select
    p.created_by_user_id,
    coalesce(
      max(pr.display_name),
      case
        when bool_and(p.is_account_holder) then string_agg(distinct p.display_name, ', ')
        else 'Parent of ' || string_agg(distinct p.display_name, ', ') filter (where not p.is_account_holder)
      end
    ),
    'guardian'::text
  from team_memberships tm
  join players p on p.id = tm.player_id
  left join profiles pr on pr.user_id = p.created_by_user_id
  where tm.team_id = p_team_id
    and is_on_team(p_team_id, auth.uid())
    and p.created_by_user_id <> (select coach_user_id from teams where id = p_team_id)
  group by p.created_by_user_id;
$$;

revoke all on function list_team_contacts(uuid) from public;
revoke all on function list_team_contacts(uuid) from anon;
grant execute on function list_team_contacts(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- team_messages: the Team Board — team-wide posts AND private 1:1s in one
-- table (recipient_user_id null = team-wide, set = a DM between author and
-- that one recipient), with optional threading (parent_message_id). Added
-- 2026-08-24 per Rylee's request, scoped with Jay first (see
-- DRILLSTREAK.md's "Team Board" section for the full negotiation). Adults-
-- only by design — matches how the rest of this app already treats a
-- player as a parent-managed profile, not an independent poster.
-- media_url exists now so nothing needs rebuilding later, but the app's
-- upload UI stays switched off (TEAM_MEDIA_ENABLED = false in
-- src/lib/teamMedia.ts) until the media-release gate in DRILLSTREAK.md is
-- flipped on — this column and the storage bucket/RLS at the bottom of
-- this migration are inert until the client actually calls them.
-- ---------------------------------------------------------------------------
create table team_messages (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  author_user_id uuid not null references auth.users(id),
  recipient_user_id uuid references auth.users(id),
  parent_message_id uuid references team_messages(id) on delete cascade,
  body text not null,
  media_url text,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  -- Added 2026-08-25, Phase 2 badge sharing: badge_type/badge_label turn a
  -- normal team-wide post into a rendered badge card instead of plain
  -- text — denormalized (a label snapshot, not a live FK to badges) so
  -- Team Board's existing team_messages_select RLS is the only
  -- authorization this needs; a badges-table FK would need its own extra
  -- read-grant to whoever can already see this message, which the shared
  -- opt-out visibility flag already handles once, not twice.
  -- expires_at implements the 24h-then-gone behavior Jay asked for —
  -- nothing physically deletes the row (no scheduled job in this stack),
  -- team_messages_select below just stops returning it once expired,
  -- same "gone from every screen, still exists" shape as everything else
  -- in this app that's never actually destroyed.
  badge_type text,
  badge_label text,
  expires_at timestamptz
);

alter table team_messages enable row level security;

-- Team-wide messages (recipient_user_id null) are visible to anyone on the
-- team; a DM is visible only to the two people in it. Widened 2026-08-25:
-- an expired badge share (expires_at in the past) stops matching for
-- everyone, coach included — a expired brag isn't worth a moderation
-- exception.
create policy team_messages_select on team_messages
  for select
  using (
    is_on_team(team_messages.team_id, auth.uid())
    and (recipient_user_id is null or auth.uid() in (author_user_id, recipient_user_id))
    and (expires_at is null or expires_at > now())
  );

-- is_team_coach: security-definer, same reason as is_on_team/
-- is_player_restricted above. Real bug caught live (2026-08-24): the
-- first version of team_messages_insert below compared recipient_user_id
-- against a bare `select coach_user_id from teams where id = ...`
-- subquery — but that subquery runs as the CALLING user, and
-- teams_coach_access restricts SELECT on teams to the owning coach only.
-- For a restricted player (never the coach), that subquery silently
-- returned zero rows -> NULL -> the whole comparison failed -> every DM
-- to the coach was rejected. Exactly why a coach could message a
-- restricted player but the player could never message back — the coach
-- branch never even evaluates this subquery (not is_player_restricted is
-- already true for a coach), so the bug was invisible from that side.
create or replace function is_team_coach(p_team_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from teams t where t.id = p_team_id and t.coach_user_id = p_user_id);
$$;

revoke all on function is_team_coach(uuid, uuid) from public;
revoke all on function is_team_coach(uuid, uuid) from anon;
grant execute on function is_team_coach(uuid, uuid) to authenticated;

-- Can only post as yourself, on a team you're actually on — and for a DM,
-- only to someone else who's also actually on that same team. Added
-- 2026-08-24: a restricted account (is_player_restricted — a self-signed-
-- up teen whose whole roster presence is self-tracked profiles) can only
-- ever insert a DM to that team's coach — never a team-wide post, never a
-- DM to another family. Keeps the group feed and cross-family DMs
-- adults-only while still letting a player reach their coach directly.
create policy team_messages_insert on team_messages
  for insert
  with check (
    author_user_id = auth.uid()
    and is_on_team(team_messages.team_id, auth.uid())
    and (recipient_user_id is null or is_on_team(team_messages.team_id, recipient_user_id))
    and (
      not is_player_restricted(team_messages.team_id, auth.uid())
      or is_team_coach(team_messages.team_id, recipient_user_id)
    )
  );

-- Your own message, or (moderation) any message on a team you coach — same
-- trust model already used for player_notes/roster removal elsewhere here.
create policy team_messages_delete on team_messages
  for delete
  using (
    author_user_id = auth.uid()
    or exists (select 1 from teams t where t.id = team_messages.team_id and t.coach_user_id = auth.uid())
  );

-- Pin/unpin only, coach only — an announcement pin is a coach moderation
-- action, not something any parent can set on their own post.
create policy team_messages_update on team_messages
  for update
  using (exists (select 1 from teams t where t.id = team_messages.team_id and t.coach_user_id = auth.uid()))
  with check (exists (select 1 from teams t where t.id = team_messages.team_id and t.coach_user_id = auth.uid()));

alter publication supabase_realtime add table team_messages;

-- ---------------------------------------------------------------------------
-- team_events: the shared team calendar (games, practices, meals).
-- Coach-authored, team-visible — same "coach assigns, roster consumes"
-- pattern already used for drill assignments, kept deliberately separate
-- from the open two-way team_messages board above so the schedule stays
-- authoritative. event_type is free text, not an enum, same reasoning as
-- drills.category/players.position elsewhere in this schema.
-- ---------------------------------------------------------------------------
create table team_events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  title text not null,
  event_type text,
  event_date date not null,
  event_time time,
  location text,
  notes text,
  created_by_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table team_events enable row level security;

create policy team_events_select on team_events
  for select
  using (is_on_team(team_events.team_id, auth.uid()));

create policy team_events_coach_insert on team_events
  for insert
  with check (exists (select 1 from teams t where t.id = team_events.team_id and t.coach_user_id = auth.uid()));

create policy team_events_coach_update on team_events
  for update
  using (exists (select 1 from teams t where t.id = team_events.team_id and t.coach_user_id = auth.uid()));

create policy team_events_coach_delete on team_events
  for delete
  using (exists (select 1 from teams t where t.id = team_events.team_id and t.coach_user_id = auth.uid()));

alter publication supabase_realtime add table team_events;

-- ---------------------------------------------------------------------------
-- push_tokens: one row per device/token, registered client-side once a user
-- grants notification permission. Fanout (which tokens get notified about
-- which new team_messages/team_events row) happens in the
-- notify-team-message Edge Function, not in SQL — see
-- supabase/functions/notify-team-message/index.ts. Requires an Apple Push
-- key in your Apple Developer account before it actually delivers on iOS —
-- see DRILLSTREAK.md for the manual steps this table alone doesn't cover.
-- ---------------------------------------------------------------------------
create table push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null,
  updated_at timestamptz not null default now(),
  unique (user_id, expo_push_token)
);

alter table push_tokens enable row level security;

create policy push_tokens_owner on push_tokens
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- team-media storage bucket: exists now so nothing needs rebuilding later,
-- but stays inert until TEAM_MEDIA_ENABLED (src/lib/teamMedia.ts) is
-- switched on — see the media-release gate note above and in
-- DRILLSTREAK.md. Path convention: {team_id}/{message_id}/{filename} — RLS
-- reads team_id straight out of the path via storage.foldername(), the
-- same per-tenant scoping pattern Supabase's own docs use. Simplification:
-- delete is coach-only, not per-author — deleting your own message removes
-- it from the app, but not the underlying file; acceptable for v1, not a
-- security gap since read access stays fully RLS-gated either way.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('team-media', 'team-media', false)
on conflict (id) do nothing;

create policy team_media_select on storage.objects
  for select
  using (
    bucket_id = 'team-media'
    and is_on_team((storage.foldername(name))[1]::uuid, auth.uid())
  );

create policy team_media_insert on storage.objects
  for insert
  with check (
    bucket_id = 'team-media'
    and is_on_team((storage.foldername(name))[1]::uuid, auth.uid())
  );

create policy team_media_delete on storage.objects
  for delete
  using (
    bucket_id = 'team-media'
    and exists (
      select 1 from teams t
      where t.id = (storage.foldername(name))[1]::uuid and t.coach_user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- notify_team_board_webhook: fires the notify-team-message Edge Function
-- directly via pg_net, added 2026-08-24 after discovering the live
-- Supabase dashboard's "Database Triggers" wizard only supports targeting
-- a Postgres function (its "Choose a function to trigger" picker is
-- filtered to functions that `returns trigger` — no Edge Function option
-- was actually present, despite the docs suggesting otherwise). This
-- sidesteps that wizard entirely: one generic trigger function, reused for
-- both team_messages and team_events, reading TG_TABLE_NAME so the Edge
-- Function can branch on it exactly the same way it already does for a
-- Database Webhook-style payload ({type, table, record}).
--
-- The Authorization header carries the publishable/anon key (same
-- client-safe key already embedded in the app's own .env — not a secret)
-- purely to pass Supabase's platform-level "is this a valid caller" gate;
-- it's unrelated to what the Edge Function itself does internally (that
-- side already uses its own service-role key, auto-injected by Supabase).
-- ---------------------------------------------------------------------------
create extension if not exists pg_net with schema extensions;

create or replace function notify_team_board_webhook()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform net.http_post(
    url := 'https://jiohhwahvzajvidbiqnm.supabase.co/functions/v1/notify-team-message',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer sb_publishable_69dScqBVzWVq_SLUJQUKNA_cEhBJfnk'
    ),
    body := jsonb_build_object('type', 'INSERT', 'table', TG_TABLE_NAME, 'record', row_to_json(NEW))
  );
  return NEW;
end;
$$;

create trigger notify_team_messages_insert
  after insert on team_messages
  for each row
  execute function notify_team_board_webhook();

create trigger notify_team_events_insert
  after insert on team_events
  for each row
  execute function notify_team_board_webhook();

-- ---------------------------------------------------------------------------
-- profiles + record_age_attestation: the signup-time age self-attestation
-- gate (added 2026-08-24, built ahead of Brandon's COPPA-specific legal
-- review at Jay's explicit direction — see DRILLSTREAK.md's "Age gate"
-- section. AuthScreen.tsx now asks "are you 13 or older?" before showing
-- the sign-up form at all; this table is the audit record of that answer,
-- not an access-control gate — nothing elsewhere in the app reads this
-- column to decide what an account can do.
--
-- Written via a security-definer RPC, not a normal RLS-gated insert,
-- because this project requires email confirmation before a session
-- exists — supabase.auth.signUp() returns a real user id immediately, but
-- no active session to satisfy a normal `user_id = auth.uid()` check.
-- record_age_attestation() is deliberately granted to `anon` as well as
-- `authenticated` — the only function in this schema with that grant.
-- Low-risk despite the pre-session exposure: the table carries no
-- authorization weight, and `on conflict do nothing` means a given
-- user_id's attestation can only ever be written once, never overwritten.
-- ---------------------------------------------------------------------------
create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- Nullable (2026-08-24 addition, see below) — an account created before
  -- this table existed can now set a display_name via a direct upsert with
  -- no attestation on file, and that's an accurate reflection of reality
  -- (we genuinely have no attestation for a pre-existing account), not
  -- something to paper over with a fabricated true/false value.
  age_attested_13_or_over boolean,
  age_attested_at timestamptz not null default now(),
  -- Added 2026-08-24: what Team Chat actually displays for this account,
  -- instead of a generic role label ("Parent of Jayden") once a roster
  -- has 20-30 families on it and generic labels stop being enough to
  -- recognize who's who. Set by the user themselves in Account — see
  -- list_team_contacts below for how it's preferred once set.
  display_name text
);

alter table profiles enable row level security;

create policy profiles_owner_read on profiles
  for select
  using (user_id = auth.uid());

create policy profiles_owner_delete on profiles
  for delete
  using (user_id = auth.uid());

-- Lets a signed-in user set/update their own display_name directly (via
-- upsert), independent of the age-attestation RPC path above — covers
-- both a brand-new profiles row (account predates this table) and editing
-- an existing one.
create policy profiles_owner_insert on profiles
  for insert
  with check (user_id = auth.uid());

create policy profiles_owner_update on profiles
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function record_age_attestation(p_user_id uuid, p_attested_13_or_over boolean)
returns void
language sql
security definer
set search_path = public
as $$
  insert into profiles (user_id, age_attested_13_or_over)
  values (p_user_id, p_attested_13_or_over)
  on conflict (user_id) do nothing;
$$;

revoke all on function record_age_attestation(uuid, boolean) from public;
grant execute on function record_age_attestation(uuid, boolean) to anon;
grant execute on function record_age_attestation(uuid, boolean) to authenticated;

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

-- ---------------------------------------------------------------------------
-- Migration for the already-deployed database (2026-07-29, second batch):
-- the rotating drill-video pool table. Run against the live project after
-- the video_url/makes/attempts migration above.
-- ---------------------------------------------------------------------------
-- create table drill_videos (
--   id uuid primary key default gen_random_uuid(),
--   drill_id uuid not null references drills(id) on delete cascade,
--   url text not null,
--   created_at timestamptz not null default now()
-- );
--
-- alter table drill_videos enable row level security;
--
-- create policy drill_videos_select on drill_videos
--   for select
--   using (
--     exists (
--       select 1 from drills d
--       where d.id = drill_videos.drill_id
--       and (
--         d.is_default = true
--         or d.created_by_user_id = auth.uid()
--         or (d.player_id is not null and is_player_owner_or_guardian(d.player_id, auth.uid()))
--         or exists (
--           select 1 from assignments a
--           where a.drill_id = d.id
--           and (
--             exists (select 1 from teams t where t.id = a.team_id and t.coach_user_id = auth.uid())
--             or is_player_owner_or_guardian(a.player_id, auth.uid())
--           )
--         )
--       )
--     )
--   );
--
-- create policy drill_videos_write on drill_videos
--   for all
--   using (
--     exists (
--       select 1 from drills d
--       where d.id = drill_videos.drill_id
--       and d.created_by_user_id = auth.uid()
--       and d.is_default = false
--     )
--   );

-- ---------------------------------------------------------------------------
-- Migration for the already-deployed database (2026-07-29, third batch):
-- the coach-level result-prompt nudge. Covered by the existing
-- teams_coach_access policy (same rows, new column) — no new policy needed.
-- ---------------------------------------------------------------------------
-- alter table teams add column prompt_for_results boolean not null default false;

-- ---------------------------------------------------------------------------
-- Migration for the already-deployed database (2026-08-04): fix a real bug
-- where the coach's result-prompt toggle never reached players. teams_coach_
-- access restricts SELECT on teams to the owning coach (protects invite
-- codes), so the player-side embedded select of
-- `team_memberships -> teams(prompt_for_results)` silently returned null for
-- every non-coach caller. This adds a security-definer function that
-- bypasses that restriction for this one boolean while re-checking the
-- caller actually owns/guards the player, mirroring is_player_owner_or_
-- guardian's existing pattern. Run against the live project, then no app
-- redeploy is needed beyond the already-shipped client change that calls it.
-- ---------------------------------------------------------------------------
-- create or replace function player_has_prompt_for_results(p_player_id uuid)
-- returns boolean
-- language sql
-- security definer
-- stable
-- set search_path = public
-- as $$
--   select
--     is_player_owner_or_guardian(p_player_id, auth.uid())
--     and exists (
--       select 1
--       from team_memberships tm
--       join teams t on t.id = tm.team_id
--       where tm.player_id = p_player_id
--         and t.prompt_for_results = true
--     );
-- $$;
--
-- revoke all on function player_has_prompt_for_results(uuid) from public;
-- revoke all on function player_has_prompt_for_results(uuid) from anon;
-- grant execute on function player_has_prompt_for_results(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Migration for the already-deployed database (2026-08-05): the "challenge
-- a friend" feature — Future Feature Idea #1, moved up per the growth-
-- strategy application (see DRILLSTREAK.md, "Growth/strategy framework
-- application"). Run against the live project.
-- ---------------------------------------------------------------------------
-- create table challenges (
--   id uuid primary key default gen_random_uuid(),
--   team_id uuid not null references teams(id) on delete cascade,
--   challenger_player_id uuid not null references players(id) on delete cascade,
--   opponent_player_id uuid not null references players(id) on delete cascade,
--   starts_at date not null default current_date,
--   ends_at date not null,
--   accepted boolean not null default false,
--   created_at timestamptz not null default now(),
--   check (challenger_player_id <> opponent_player_id),
--   check (ends_at > starts_at)
-- );
--
-- alter table challenges enable row level security;
--
-- create policy challenges_access on challenges
--   for all
--   using (
--     is_player_owner_or_guardian(challenger_player_id, auth.uid())
--     or is_player_owner_or_guardian(opponent_player_id, auth.uid())
--   );
--
-- create or replace function get_teammates(p_player_id uuid)
-- returns table(id uuid, display_name text, team_id uuid)
-- language sql
-- security definer
-- stable
-- set search_path = public
-- as $$
--   select distinct on (p.id) p.id, p.display_name, tm_other.team_id
--   from players p
--   join team_memberships tm_other on tm_other.player_id = p.id
--   join team_memberships tm_self on tm_self.team_id = tm_other.team_id
--   where tm_self.player_id = p_player_id
--     and p.id <> p_player_id
--     and is_player_owner_or_guardian(p_player_id, auth.uid())
--   order by p.id, tm_other.team_id;
-- $$;
--
-- revoke all on function get_teammates(uuid) from public;
-- revoke all on function get_teammates(uuid) from anon;
-- grant execute on function get_teammates(uuid) to authenticated;
--
-- create or replace function get_player_challenges(p_player_id uuid)
-- returns table(
--   id uuid,
--   team_id uuid,
--   challenger_player_id uuid,
--   challenger_name text,
--   challenger_completions bigint,
--   opponent_player_id uuid,
--   opponent_name text,
--   opponent_completions bigint,
--   starts_at date,
--   ends_at date,
--   accepted boolean,
--   created_at timestamptz
-- )
-- language sql
-- security definer
-- stable
-- set search_path = public
-- as $$
--   select
--     c.id, c.team_id,
--     c.challenger_player_id, cp.display_name,
--     (select count(*) from completions comp where comp.player_id = c.challenger_player_id
--        and comp.date >= c.starts_at and comp.date <= least(c.ends_at, current_date)),
--     c.opponent_player_id, op.display_name,
--     (select count(*) from completions comp where comp.player_id = c.opponent_player_id
--        and comp.date >= c.starts_at and comp.date <= least(c.ends_at, current_date)),
--     c.starts_at, c.ends_at, c.accepted, c.created_at
--   from challenges c
--   join players cp on cp.id = c.challenger_player_id
--   join players op on op.id = c.opponent_player_id
--   where (c.challenger_player_id = p_player_id or c.opponent_player_id = p_player_id)
--     and is_player_owner_or_guardian(p_player_id, auth.uid())
--   order by c.created_at desc;
-- $$;
--
-- revoke all on function get_player_challenges(uuid) from public;
-- revoke all on function get_player_challenges(uuid) from anon;
-- grant execute on function get_player_challenges(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Migration for the already-deployed database (2026-08-05, second batch):
-- real bug fix, same day as the challenges table above. starts_at/ends_at
-- were being set at challenge CREATION, so any drills the challenger had
-- already logged that same day counted toward their total the instant the
-- challenge existed — caught by Jay on the very first real test. Run
-- against the live project after the first challenges migration.
-- No data loss: the one existing test challenge just goes back to
-- pending-with-no-window until re-accepted, same as any new challenge.
-- ---------------------------------------------------------------------------
-- alter table challenges alter column starts_at drop not null;
-- alter table challenges alter column starts_at drop default;
-- alter table challenges alter column ends_at drop not null;
-- update challenges set accepted = false, starts_at = null, ends_at = null;

-- ---------------------------------------------------------------------------
-- Migration for the already-deployed database (2026-08-05, third batch):
-- second real bug in the same feature, caught on the very next test after
-- the last fix. starts_at/ends_at are DATE columns (day granularity), so
-- the last fix only solved the case where creation and acceptance land on
-- different days — same-day (the common real case) still let a drill
-- logged before the accept count, since it shared the same calendar date
-- as starts_at. Fixed with accepted_at, a real timestamp set server-side
-- by a new accept_challenge() function (not client-supplied — a client
-- clock could be wrong or backdated). Run against the live project after
-- the second challenges migration. No data loss: resets the one existing
-- test challenge back to pending again, same as the last migration did.
-- ---------------------------------------------------------------------------
-- alter table challenges add column accepted_at timestamptz;
--
-- create or replace function accept_challenge(p_challenge_id uuid)
-- returns void
-- language sql
-- set search_path = public
-- as $$
--   update challenges
--   set accepted = true,
--       accepted_at = now(),
--       starts_at = current_date,
--       ends_at = current_date + 7
--   where id = p_challenge_id;
-- $$;
--
-- grant execute on function accept_challenge(uuid) to authenticated;
--
-- create or replace function get_player_challenges(p_player_id uuid)
-- returns table(
--   id uuid,
--   team_id uuid,
--   challenger_player_id uuid,
--   challenger_name text,
--   challenger_completions bigint,
--   opponent_player_id uuid,
--   opponent_name text,
--   opponent_completions bigint,
--   starts_at date,
--   ends_at date,
--   accepted boolean,
--   created_at timestamptz
-- )
-- language sql
-- security definer
-- stable
-- set search_path = public
-- as $$
--   select
--     c.id, c.team_id,
--     c.challenger_player_id, cp.display_name,
--     (select count(*) from completions comp where comp.player_id = c.challenger_player_id
--        and comp.created_at >= c.accepted_at and comp.date <= least(c.ends_at, current_date)),
--     c.opponent_player_id, op.display_name,
--     (select count(*) from completions comp where comp.player_id = c.opponent_player_id
--        and comp.created_at >= c.accepted_at and comp.date <= least(c.ends_at, current_date)),
--     c.starts_at, c.ends_at, c.accepted, c.created_at
--   from challenges c
--   join players cp on cp.id = c.challenger_player_id
--   join players op on op.id = c.opponent_player_id
--   where (c.challenger_player_id = p_player_id or c.opponent_player_id = p_player_id)
--     and is_player_owner_or_guardian(p_player_id, auth.uid())
--   order by c.created_at desc;
-- $$;
--
-- revoke all on function get_player_challenges(uuid) from public;
-- revoke all on function get_player_challenges(uuid) from anon;
-- grant execute on function get_player_challenges(uuid) to authenticated;
--
-- update challenges set accepted = false, accepted_at = null, starts_at = null, ends_at = null;

-- ---------------------------------------------------------------------------
-- Migration for the already-deployed database (2026-08-14): player_notes,
-- part of the recruitment-layer build (Horizon 2 in DRILLSTREAK.md). Run
-- this against the live project via the Supabase SQL editor. No data loss
-- — this is a brand-new table, nothing existing is touched.
-- ---------------------------------------------------------------------------
-- create table player_notes (
--   id uuid primary key default gen_random_uuid(),
--   player_id uuid not null references players(id) on delete cascade,
--   coach_user_id uuid not null references auth.users(id),
--   note text not null,
--   updated_at timestamptz not null default now(),
--   unique (player_id, coach_user_id)
-- );
--
-- alter table player_notes enable row level security;
--
-- create policy player_notes_coach_insert on player_notes
--   for insert
--   with check (
--     coach_user_id = auth.uid()
--     and exists (
--       select 1 from team_memberships tm
--       join teams t on t.id = tm.team_id
--       where tm.player_id = player_notes.player_id and t.coach_user_id = auth.uid()
--     )
--   );
--
-- create policy player_notes_coach_select on player_notes
--   for select
--   using (coach_user_id = auth.uid());
--
-- create policy player_notes_coach_update on player_notes
--   for update
--   using (coach_user_id = auth.uid())
--   with check (coach_user_id = auth.uid());
--
-- create policy player_notes_coach_delete on player_notes
--   for delete
--   using (coach_user_id = auth.uid());
--
-- create policy player_notes_player_read on player_notes
--   for select
--   using (is_player_owner_or_guardian(player_notes.player_id, auth.uid()));

-- ---------------------------------------------------------------------------
-- Migration for the already-deployed database (2026-08-14, same batch):
-- recruiting-profile bio fields on players. Run this in the same session
-- as the player_notes migration above. No data loss — all four columns
-- are nullable, every existing player row just gets them as null.
-- ---------------------------------------------------------------------------
-- alter table players add column height text;
-- alter table players add column weight text;
-- alter table players add column grad_year integer;
-- alter table players add column position text;

-- ---------------------------------------------------------------------------
-- Migration for the already-deployed database (2026-08-23): widen coach
-- history access. No data loss — this only replaces a policy and adds a
-- new function, no tables or columns touched.
-- ---------------------------------------------------------------------------
-- create or replace function coach_has_real_roster(p_coach_user_id uuid)
-- returns boolean
-- language sql
-- security definer
-- stable
-- set search_path = public
-- as $$
--   select count(*) >= 3
--   from team_memberships tm
--   join teams t on t.id = tm.team_id
--   where t.coach_user_id = p_coach_user_id
--     and not is_player_owner_or_guardian(tm.player_id, p_coach_user_id);
-- $$;
--
-- revoke all on function coach_has_real_roster(uuid) from public;
-- revoke all on function coach_has_real_roster(uuid) from anon;
-- grant execute on function coach_has_real_roster(uuid) to authenticated;
--
-- drop policy if exists completions_coach_read on completions;
-- create policy completions_coach_read on completions
--   for select
--   using (
--     exists (
--       select 1 from team_memberships tm
--       join teams t on t.id = tm.team_id
--       where tm.player_id = completions.player_id and t.coach_user_id = auth.uid()
--     )
--     and (
--       completions.date >= date_trunc('week', current_date)::date
--       or not is_player_owner_or_guardian(completions.player_id, auth.uid())
--       or coach_has_real_roster(auth.uid())
--     )
--   );

-- ---------------------------------------------------------------------------
-- Migration for the already-deployed database (2026-08-24): Team Board —
-- messages (team-wide + DMs + threading), team calendar, push-token
-- registration table, and the team-media storage bucket. No data loss —
-- all new tables/functions/policies, nothing existing altered. Run this
-- whole block in one paste in the Supabase SQL editor.
-- ---------------------------------------------------------------------------
-- create or replace function is_on_team(p_team_id uuid, p_user_id uuid)
-- returns boolean
-- language sql
-- security definer
-- stable
-- set search_path = public
-- as $$
--   select
--     exists (select 1 from teams t where t.id = p_team_id and t.coach_user_id = p_user_id)
--     or exists (
--       select 1 from team_memberships tm
--       where tm.team_id = p_team_id
--         and is_player_owner_or_guardian(tm.player_id, p_user_id)
--     );
-- $$;
--
-- revoke all on function is_on_team(uuid, uuid) from public;
-- revoke all on function is_on_team(uuid, uuid) from anon;
-- grant execute on function is_on_team(uuid, uuid) to authenticated;
--
-- create or replace function list_my_teams()
-- returns table(id uuid, name text, invite_code text, role text)
-- language sql
-- stable
-- security definer
-- set search_path = public
-- as $$
--   select t.id, t.name, t.invite_code, 'coach'::text as role
--   from teams t
--   where t.coach_user_id = auth.uid()
--   union
--   select distinct t.id, t.name, null::text as invite_code, 'guardian'::text as role
--   from teams t
--   join team_memberships tm on tm.team_id = t.id
--   where is_player_owner_or_guardian(tm.player_id, auth.uid())
--     and t.coach_user_id <> auth.uid();
-- $$;
--
-- revoke all on function list_my_teams() from public;
-- revoke all on function list_my_teams() from anon;
-- grant execute on function list_my_teams() to authenticated;
--
-- create or replace function list_team_contacts(p_team_id uuid)
-- returns table(user_id uuid, label text)
-- language sql
-- stable
-- security definer
-- set search_path = public
-- as $$
--   select t.coach_user_id, 'Coach'::text
--   from teams t
--   where t.id = p_team_id
--     and is_on_team(p_team_id, auth.uid())
--   union
--   select g.guardian_user_id, 'Parent of ' || string_agg(distinct p.display_name, ', ')
--   from team_memberships tm
--   join players p on p.id = tm.player_id
--   join guardianships g on g.player_id = p.id
--   where tm.team_id = p_team_id
--     and is_on_team(p_team_id, auth.uid())
--     and g.guardian_user_id <> (select coach_user_id from teams where id = p_team_id)
--   group by g.guardian_user_id
--   union
--   select p.created_by_user_id, 'Parent of ' || string_agg(distinct p.display_name, ', ')
--   from team_memberships tm
--   join players p on p.id = tm.player_id
--   where tm.team_id = p_team_id
--     and is_on_team(p_team_id, auth.uid())
--     and p.created_by_user_id <> (select coach_user_id from teams where id = p_team_id)
--   group by p.created_by_user_id;
-- $$;
--
-- revoke all on function list_team_contacts(uuid) from public;
-- revoke all on function list_team_contacts(uuid) from anon;
-- grant execute on function list_team_contacts(uuid) to authenticated;
--
-- create table team_messages (
--   id uuid primary key default gen_random_uuid(),
--   team_id uuid not null references teams(id) on delete cascade,
--   author_user_id uuid not null references auth.users(id),
--   recipient_user_id uuid references auth.users(id),
--   parent_message_id uuid references team_messages(id) on delete cascade,
--   body text not null,
--   media_url text,
--   pinned boolean not null default false,
--   created_at timestamptz not null default now()
-- );
--
-- alter table team_messages enable row level security;
--
-- create policy team_messages_select on team_messages
--   for select
--   using (
--     is_on_team(team_messages.team_id, auth.uid())
--     and (recipient_user_id is null or auth.uid() in (author_user_id, recipient_user_id))
--   );
--
-- create policy team_messages_insert on team_messages
--   for insert
--   with check (
--     author_user_id = auth.uid()
--     and is_on_team(team_messages.team_id, auth.uid())
--     and (recipient_user_id is null or is_on_team(team_messages.team_id, recipient_user_id))
--   );
--
-- create policy team_messages_delete on team_messages
--   for delete
--   using (
--     author_user_id = auth.uid()
--     or exists (select 1 from teams t where t.id = team_messages.team_id and t.coach_user_id = auth.uid())
--   );
--
-- create policy team_messages_update on team_messages
--   for update
--   using (exists (select 1 from teams t where t.id = team_messages.team_id and t.coach_user_id = auth.uid()))
--   with check (exists (select 1 from teams t where t.id = team_messages.team_id and t.coach_user_id = auth.uid()));
--
-- alter publication supabase_realtime add table team_messages;
--
-- create table team_events (
--   id uuid primary key default gen_random_uuid(),
--   team_id uuid not null references teams(id) on delete cascade,
--   title text not null,
--   event_type text,
--   event_date date not null,
--   event_time time,
--   location text,
--   notes text,
--   created_by_user_id uuid not null references auth.users(id),
--   created_at timestamptz not null default now()
-- );
--
-- alter table team_events enable row level security;
--
-- create policy team_events_select on team_events
--   for select
--   using (is_on_team(team_events.team_id, auth.uid()));
--
-- create policy team_events_coach_insert on team_events
--   for insert
--   with check (exists (select 1 from teams t where t.id = team_events.team_id and t.coach_user_id = auth.uid()));
--
-- create policy team_events_coach_update on team_events
--   for update
--   using (exists (select 1 from teams t where t.id = team_events.team_id and t.coach_user_id = auth.uid()));
--
-- create policy team_events_coach_delete on team_events
--   for delete
--   using (exists (select 1 from teams t where t.id = team_events.team_id and t.coach_user_id = auth.uid()));
--
-- alter publication supabase_realtime add table team_events;
--
-- create table push_tokens (
--   id uuid primary key default gen_random_uuid(),
--   user_id uuid not null references auth.users(id) on delete cascade,
--   expo_push_token text not null,
--   updated_at timestamptz not null default now(),
--   unique (user_id, expo_push_token)
-- );
--
-- alter table push_tokens enable row level security;
--
-- create policy push_tokens_owner on push_tokens
--   for all
--   using (user_id = auth.uid())
--   with check (user_id = auth.uid());
--
-- insert into storage.buckets (id, name, public)
-- values ('team-media', 'team-media', false)
-- on conflict (id) do nothing;
--
-- create policy team_media_select on storage.objects
--   for select
--   using (
--     bucket_id = 'team-media'
--     and is_on_team((storage.foldername(name))[1]::uuid, auth.uid())
--   );
--
-- create policy team_media_insert on storage.objects
--   for insert
--   with check (
--     bucket_id = 'team-media'
--     and is_on_team((storage.foldername(name))[1]::uuid, auth.uid())
--   );
--
-- create policy team_media_delete on storage.objects
--   for delete
--   using (
--     bucket_id = 'team-media'
--     and exists (
--       select 1 from teams t
--       where t.id = (storage.foldername(name))[1]::uuid and t.coach_user_id = auth.uid()
--     )
--   );

-- ---------------------------------------------------------------------------
-- Migration for the already-deployed database (2026-08-24, second batch):
-- the signup age self-attestation gate (profiles + record_age_attestation).
-- No data loss — new table/function only.
-- ---------------------------------------------------------------------------
-- create table profiles (
--   user_id uuid primary key references auth.users(id) on delete cascade,
--   age_attested_13_or_over boolean not null,
--   age_attested_at timestamptz not null default now()
-- );
--
-- alter table profiles enable row level security;
--
-- create policy profiles_owner_read on profiles
--   for select
--   using (user_id = auth.uid());
--
-- create policy profiles_owner_delete on profiles
--   for delete
--   using (user_id = auth.uid());
--
-- create or replace function record_age_attestation(p_user_id uuid, p_attested_13_or_over boolean)
-- returns void
-- language sql
-- security definer
-- set search_path = public
-- as $$
--   insert into profiles (user_id, age_attested_13_or_over)
--   values (p_user_id, p_attested_13_or_over)
--   on conflict (user_id) do nothing;
-- $$;
--
-- revoke all on function record_age_attestation(uuid, boolean) from public;
-- grant execute on function record_age_attestation(uuid, boolean) to anon;
-- grant execute on function record_age_attestation(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Migration for the already-deployed database (2026-08-24, third batch):
-- notify_team_board_webhook — fires the notify-team-message Edge Function
-- via pg_net directly from a Postgres trigger, bypassing the dashboard's
-- Triggers wizard (its function picker only supports Postgres functions,
-- not Edge Functions directly). Requires team_messages/team_events to
-- already exist (first batch above). No data loss — new extension/
-- function/triggers only.
-- ---------------------------------------------------------------------------
-- create extension if not exists pg_net with schema extensions;
--
-- create or replace function notify_team_board_webhook()
-- returns trigger
-- language plpgsql
-- security definer
-- set search_path = public, extensions
-- as $$
-- begin
--   perform net.http_post(
--     url := 'https://jiohhwahvzajvidbiqnm.supabase.co/functions/v1/notify-team-message',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer sb_publishable_69dScqBVzWVq_SLUJQUKNA_cEhBJfnk'
--     ),
--     body := jsonb_build_object('type', 'INSERT', 'table', TG_TABLE_NAME, 'record', row_to_json(NEW))
--   );
--   return NEW;
-- end;
-- $$;
--
-- create trigger notify_team_messages_insert
--   after insert on team_messages
--   for each row
--   execute function notify_team_board_webhook();
--
-- create trigger notify_team_events_insert
--   after insert on team_events
--   for each row
--   execute function notify_team_board_webhook();

-- ---------------------------------------------------------------------------
-- Migration for the already-deployed database (2026-08-24, fourth batch):
-- profiles.display_name — lets an account set a real name for Team Chat
-- instead of a generic role label, plus the RLS to let a user set it
-- themselves, plus widening list_team_contacts() to prefer it. No data
-- loss — age_attested_13_or_over goes from not-null to nullable (existing
-- rows keep their real values; this only affects future rows), and
-- display_name is a new nullable column.
-- ---------------------------------------------------------------------------
-- alter table profiles alter column age_attested_13_or_over drop not null;
-- alter table profiles add column display_name text;
--
-- create policy profiles_owner_insert on profiles
--   for insert
--   with check (user_id = auth.uid());
--
-- create policy profiles_owner_update on profiles
--   for update
--   using (user_id = auth.uid())
--   with check (user_id = auth.uid());
--
-- create or replace function list_team_contacts(p_team_id uuid)
-- returns table(user_id uuid, label text)
-- language sql
-- stable
-- security definer
-- set search_path = public
-- as $$
--   select t.coach_user_id, coalesce(pr.display_name, 'Coach')
--   from teams t
--   left join profiles pr on pr.user_id = t.coach_user_id
--   where t.id = p_team_id
--     and is_on_team(p_team_id, auth.uid())
--   union
--   select g.guardian_user_id, coalesce(max(pr.display_name), 'Parent of ' || string_agg(distinct p.display_name, ', '))
--   from team_memberships tm
--   join players p on p.id = tm.player_id
--   join guardianships g on g.player_id = p.id
--   left join profiles pr on pr.user_id = g.guardian_user_id
--   where tm.team_id = p_team_id
--     and is_on_team(p_team_id, auth.uid())
--     and g.guardian_user_id <> (select coach_user_id from teams where id = p_team_id)
--   group by g.guardian_user_id
--   union
--   select p.created_by_user_id, coalesce(max(pr.display_name), 'Parent of ' || string_agg(distinct p.display_name, ', '))
--   from team_memberships tm
--   join players p on p.id = tm.player_id
--   left join profiles pr on pr.user_id = p.created_by_user_id
--   where tm.team_id = p_team_id
--     and is_on_team(p_team_id, auth.uid())
--     and p.created_by_user_id <> (select coach_user_id from teams where id = p_team_id)
--   group by p.created_by_user_id;
-- $$;

-- ---------------------------------------------------------------------------
-- Migration for the already-deployed database (2026-08-24, fifth batch):
-- restricted Team Chat access for a self-signed-up player. No data loss —
-- is_account_holder defaults to false on every existing player row
-- (correct for the common case, real parent-managed profiles), new
-- function, and two function/policy replacements.
-- ---------------------------------------------------------------------------
-- alter table players add column is_account_holder boolean not null default false;
--
-- create or replace function is_player_restricted(p_team_id uuid, p_user_id uuid)
-- returns boolean
-- language sql
-- security definer
-- stable
-- set search_path = public
-- as $$
--   select
--     not exists (select 1 from teams t where t.id = p_team_id and t.coach_user_id = p_user_id)
--     and exists (
--       select 1 from team_memberships tm
--       join players p on p.id = tm.player_id
--       where tm.team_id = p_team_id
--         and is_player_owner_or_guardian(p.id, p_user_id)
--     )
--     and not exists (
--       select 1 from team_memberships tm
--       join players p on p.id = tm.player_id
--       where tm.team_id = p_team_id
--         and is_player_owner_or_guardian(p.id, p_user_id)
--         and p.is_account_holder = false
--     );
-- $$;
--
-- revoke all on function is_player_restricted(uuid, uuid) from public;
-- revoke all on function is_player_restricted(uuid, uuid) from anon;
-- grant execute on function is_player_restricted(uuid, uuid) to authenticated;
--
-- create or replace function list_my_teams()
-- returns table(id uuid, name text, invite_code text, role text, restricted boolean)
-- language sql
-- stable
-- security definer
-- set search_path = public
-- as $$
--   select t.id, t.name, t.invite_code, 'coach'::text as role, false as restricted
--   from teams t
--   where t.coach_user_id = auth.uid()
--   union
--   select distinct t.id, t.name, null::text as invite_code, 'guardian'::text as role,
--     is_player_restricted(t.id, auth.uid()) as restricted
--   from teams t
--   join team_memberships tm on tm.team_id = t.id
--   where is_player_owner_or_guardian(tm.player_id, auth.uid())
--     and t.coach_user_id <> auth.uid();
-- $$;
--
-- create or replace function list_team_contacts(p_team_id uuid)
-- returns table(user_id uuid, label text, role text)
-- language sql
-- stable
-- security definer
-- set search_path = public
-- as $$
--   select t.coach_user_id, coalesce(pr.display_name, 'Coach'), 'coach'::text
--   from teams t
--   left join profiles pr on pr.user_id = t.coach_user_id
--   where t.id = p_team_id
--     and is_on_team(p_team_id, auth.uid())
--   union
--   select g.guardian_user_id, coalesce(max(pr.display_name), 'Parent of ' || string_agg(distinct p.display_name, ', ')), 'guardian'::text
--   from team_memberships tm
--   join players p on p.id = tm.player_id
--   join guardianships g on g.player_id = p.id
--   left join profiles pr on pr.user_id = g.guardian_user_id
--   where tm.team_id = p_team_id
--     and is_on_team(p_team_id, auth.uid())
--     and g.guardian_user_id <> (select coach_user_id from teams where id = p_team_id)
--   group by g.guardian_user_id
--   union
--   select p.created_by_user_id, coalesce(max(pr.display_name), 'Parent of ' || string_agg(distinct p.display_name, ', ')), 'guardian'::text
--   from team_memberships tm
--   join players p on p.id = tm.player_id
--   left join profiles pr on pr.user_id = p.created_by_user_id
--   where tm.team_id = p_team_id
--     and is_on_team(p_team_id, auth.uid())
--     and p.created_by_user_id <> (select coach_user_id from teams where id = p_team_id)
--   group by p.created_by_user_id;
-- $$;
--
-- drop policy if exists team_messages_insert on team_messages;
-- create policy team_messages_insert on team_messages
--   for insert
--   with check (
--     author_user_id = auth.uid()
--     and is_on_team(team_messages.team_id, auth.uid())
--     and (recipient_user_id is null or is_on_team(team_messages.team_id, recipient_user_id))
--     and (
--       not is_player_restricted(team_messages.team_id, auth.uid())
--       or recipient_user_id = (select coach_user_id from teams where id = team_messages.team_id)
--     )
--   );

-- ---------------------------------------------------------------------------
-- Migration for the already-deployed database (2026-08-24, sixth batch):
-- fix list_team_contacts labeling a self-signed-up player as "Parent of
-- {their own name}". No data loss — function replacement only.
-- ---------------------------------------------------------------------------
-- create or replace function list_team_contacts(p_team_id uuid)
-- returns table(user_id uuid, label text, role text)
-- language sql
-- stable
-- security definer
-- set search_path = public
-- as $$
--   select t.coach_user_id, coalesce(pr.display_name, 'Coach'), 'coach'::text
--   from teams t
--   left join profiles pr on pr.user_id = t.coach_user_id
--   where t.id = p_team_id
--     and is_on_team(p_team_id, auth.uid())
--   union
--   select g.guardian_user_id, coalesce(max(pr.display_name), 'Parent of ' || string_agg(distinct p.display_name, ', ')), 'guardian'::text
--   from team_memberships tm
--   join players p on p.id = tm.player_id
--   join guardianships g on g.player_id = p.id
--   left join profiles pr on pr.user_id = g.guardian_user_id
--   where tm.team_id = p_team_id
--     and is_on_team(p_team_id, auth.uid())
--     and g.guardian_user_id <> (select coach_user_id from teams where id = p_team_id)
--   group by g.guardian_user_id
--   union
--   select
--     p.created_by_user_id,
--     coalesce(
--       max(pr.display_name),
--       case
--         when bool_and(p.is_account_holder) then string_agg(distinct p.display_name, ', ')
--         else 'Parent of ' || string_agg(distinct p.display_name, ', ') filter (where not p.is_account_holder)
--       end
--     ),
--     'guardian'::text
--   from team_memberships tm
--   join players p on p.id = tm.player_id
--   left join profiles pr on pr.user_id = p.created_by_user_id
--   where tm.team_id = p_team_id
--     and is_on_team(p_team_id, auth.uid())
--     and p.created_by_user_id <> (select coach_user_id from teams where id = p_team_id)
--   group by p.created_by_user_id;
-- $$;

-- ---------------------------------------------------------------------------
-- Migration for the already-deployed database (2026-08-24, seventh batch —
-- CORRECTED replacement for batches four through six above): Jay's first
-- run of the combined fourth/fifth/sixth batches failed with
-- `42P13: cannot change return type of existing function` /
-- `Use DROP FUNCTION list_my_teams() first` — create or replace function
-- can't change a table-returning function's column shape (list_my_teams
-- gained `restricted`, list_team_contacts gained `role` then changed its
-- fallback-label logic). This batch is the corrected, complete
-- replacement for all of batches four through six — run this one
-- instead, not those three. Every statement is idempotent (safe to
-- re-run) in case any of it landed before the original error stopped the
-- run. Explicit revoke/grant re-added after each drop+recreate, since
-- dropping a function clears its existing grants — omitting them here
-- would have left list_my_teams/list_team_contacts uncallable by
-- `authenticated`, a much harder failure to diagnose than the original
-- error (permission-denied instead of function-doesn't-exist).
-- ---------------------------------------------------------------------------
-- alter table profiles alter column age_attested_13_or_over drop not null;
-- alter table profiles add column if not exists display_name text;
--
-- drop policy if exists profiles_owner_insert on profiles;
-- create policy profiles_owner_insert on profiles
--   for insert
--   with check (user_id = auth.uid());
--
-- drop policy if exists profiles_owner_update on profiles;
-- create policy profiles_owner_update on profiles
--   for update
--   using (user_id = auth.uid())
--   with check (user_id = auth.uid());
--
-- alter table players add column if not exists is_account_holder boolean not null default false;
--
-- create or replace function is_player_restricted(p_team_id uuid, p_user_id uuid)
-- returns boolean
-- language sql
-- security definer
-- stable
-- set search_path = public
-- as $$
--   select
--     not exists (select 1 from teams t where t.id = p_team_id and t.coach_user_id = p_user_id)
--     and exists (
--       select 1 from team_memberships tm
--       join players p on p.id = tm.player_id
--       where tm.team_id = p_team_id
--         and is_player_owner_or_guardian(p.id, p_user_id)
--     )
--     and not exists (
--       select 1 from team_memberships tm
--       join players p on p.id = tm.player_id
--       where tm.team_id = p_team_id
--         and is_player_owner_or_guardian(p.id, p_user_id)
--         and p.is_account_holder = false
--     );
-- $$;
--
-- revoke all on function is_player_restricted(uuid, uuid) from public;
-- revoke all on function is_player_restricted(uuid, uuid) from anon;
-- grant execute on function is_player_restricted(uuid, uuid) to authenticated;
--
-- drop function if exists list_my_teams();
-- create function list_my_teams()
-- returns table(id uuid, name text, invite_code text, role text, restricted boolean)
-- language sql
-- stable
-- security definer
-- set search_path = public
-- as $$
--   select t.id, t.name, t.invite_code, 'coach'::text as role, false as restricted
--   from teams t
--   where t.coach_user_id = auth.uid()
--   union
--   select distinct t.id, t.name, null::text as invite_code, 'guardian'::text as role,
--     is_player_restricted(t.id, auth.uid()) as restricted
--   from teams t
--   join team_memberships tm on tm.team_id = t.id
--   where is_player_owner_or_guardian(tm.player_id, auth.uid())
--     and t.coach_user_id <> auth.uid();
-- $$;
--
-- revoke all on function list_my_teams() from public;
-- revoke all on function list_my_teams() from anon;
-- grant execute on function list_my_teams() to authenticated;
--
-- drop policy if exists team_messages_insert on team_messages;
-- create policy team_messages_insert on team_messages
--   for insert
--   with check (
--     author_user_id = auth.uid()
--     and is_on_team(team_messages.team_id, auth.uid())
--     and (recipient_user_id is null or is_on_team(team_messages.team_id, recipient_user_id))
--     and (
--       not is_player_restricted(team_messages.team_id, auth.uid())
--       or recipient_user_id = (select coach_user_id from teams where id = team_messages.team_id)
--     )
--   );
--
-- drop function if exists list_team_contacts(uuid);
-- create function list_team_contacts(p_team_id uuid)
-- returns table(user_id uuid, label text, role text)
-- language sql
-- stable
-- security definer
-- set search_path = public
-- as $$
--   select t.coach_user_id, coalesce(pr.display_name, 'Coach'), 'coach'::text
--   from teams t
--   left join profiles pr on pr.user_id = t.coach_user_id
--   where t.id = p_team_id
--     and is_on_team(p_team_id, auth.uid())
--   union
--   select g.guardian_user_id, coalesce(max(pr.display_name), 'Parent of ' || string_agg(distinct p.display_name, ', ')), 'guardian'::text
--   from team_memberships tm
--   join players p on p.id = tm.player_id
--   join guardianships g on g.player_id = p.id
--   left join profiles pr on pr.user_id = g.guardian_user_id
--   where tm.team_id = p_team_id
--     and is_on_team(p_team_id, auth.uid())
--     and g.guardian_user_id <> (select coach_user_id from teams where id = p_team_id)
--   group by g.guardian_user_id
--   union
--   select
--     p.created_by_user_id,
--     coalesce(
--       max(pr.display_name),
--       case
--         when bool_and(p.is_account_holder) then string_agg(distinct p.display_name, ', ')
--         else 'Parent of ' || string_agg(distinct p.display_name, ', ') filter (where not p.is_account_holder)
--       end
--     ),
--     'guardian'::text
--   from team_memberships tm
--   join players p on p.id = tm.player_id
--   left join profiles pr on pr.user_id = p.created_by_user_id
--   where tm.team_id = p_team_id
--     and is_on_team(p_team_id, auth.uid())
--     and p.created_by_user_id <> (select coach_user_id from teams where id = p_team_id)
--   group by p.created_by_user_id;
-- $$;
--
-- revoke all on function list_team_contacts(uuid) from public;
-- revoke all on function list_team_contacts(uuid) from anon;
-- grant execute on function list_team_contacts(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Migration for the already-deployed database (2026-08-24, eighth batch):
-- real bug fix — a restricted player could never actually DM the coach.
-- team_messages_insert compared recipient_user_id against a bare
-- `select coach_user_id from teams where id = ...` subquery, which runs as
-- the CALLING user and is silently filtered to nothing by
-- teams_coach_access (SELECT on teams is coach-only) for any non-coach
-- caller — so the comparison always failed for exactly the account it was
-- meant to allow. Fixed with a security-definer is_team_coach() helper
-- that bypasses that restriction correctly. No data loss — new function
-- plus a policy replacement.
-- ---------------------------------------------------------------------------
-- create or replace function is_team_coach(p_team_id uuid, p_user_id uuid)
-- returns boolean
-- language sql
-- security definer
-- stable
-- set search_path = public
-- as $$
--   select exists (select 1 from teams t where t.id = p_team_id and t.coach_user_id = p_user_id);
-- $$;
--
-- revoke all on function is_team_coach(uuid, uuid) from public;
-- revoke all on function is_team_coach(uuid, uuid) from anon;
-- grant execute on function is_team_coach(uuid, uuid) to authenticated;
--
-- drop policy if exists team_messages_insert on team_messages;
-- create policy team_messages_insert on team_messages
--   for insert
--   with check (
--     author_user_id = auth.uid()
--     and is_on_team(team_messages.team_id, auth.uid())
--     and (recipient_user_id is null or is_on_team(team_messages.team_id, recipient_user_id))
--     and (
--       not is_player_restricted(team_messages.team_id, auth.uid())
--       or is_team_coach(team_messages.team_id, recipient_user_id)
--     )
--   );

-- ---------------------------------------------------------------------------
-- Migration for the already-deployed database (2026-08-25) — Phase 1 of
-- the feature batch from tonight's brainstorm (badges/streak-grace/
-- offseason are Phases 2-3, separate migrations later): teammate profile
-- viewing (opt-out flag + RLS + widened get_teammates) and the custom
-- workout builder (workout_templates + workout_template_drills). Run
-- against the live project — every statement is idempotent, safe even if
-- part of this was already applied.
-- ---------------------------------------------------------------------------
-- alter table players add column if not exists stats_visible_to_team boolean not null default true;
--
-- create or replace function is_teammate_of(p_player_id uuid, p_viewer_user_id uuid)
-- returns boolean
-- language sql
-- security definer
-- stable
-- set search_path = public
-- as $$
--   select exists (
--     select 1
--     from team_memberships tm_target
--     join team_memberships tm_viewer on tm_viewer.team_id = tm_target.team_id
--     where tm_target.player_id = p_player_id
--       and tm_viewer.player_id <> p_player_id
--       and is_player_owner_or_guardian(tm_viewer.player_id, p_viewer_user_id)
--   );
-- $$;
--
-- revoke all on function is_teammate_of(uuid, uuid) from public;
-- revoke all on function is_teammate_of(uuid, uuid) from anon;
-- grant execute on function is_teammate_of(uuid, uuid) to authenticated;
--
-- drop policy if exists completions_teammate_read on completions;
-- create policy completions_teammate_read on completions
--   for select
--   using (
--     exists (select 1 from players p where p.id = completions.player_id and p.stats_visible_to_team = true)
--     and is_teammate_of(completions.player_id, auth.uid())
--   );
--
-- drop function if exists get_teammates(uuid);
-- create or replace function get_teammates(p_player_id uuid)
-- returns table(
--   id uuid,
--   display_name text,
--   team_id uuid,
--   "position" text,
--   height text,
--   weight text,
--   grad_year integer,
--   stats_visible_to_team boolean
-- )
-- language sql
-- security definer
-- stable
-- set search_path = public
-- as $$
--   select distinct on (p.id)
--     p.id, p.display_name, tm_other.team_id,
--     p.position, p.height, p.weight, p.grad_year, p.stats_visible_to_team
--   from players p
--   join team_memberships tm_other on tm_other.player_id = p.id
--   join team_memberships tm_self on tm_self.team_id = tm_other.team_id
--   where tm_self.player_id = p_player_id
--     and p.id <> p_player_id
--     and is_player_owner_or_guardian(p_player_id, auth.uid())
--   order by p.id, tm_other.team_id;
-- $$;
--
-- revoke all on function get_teammates(uuid) from public;
-- revoke all on function get_teammates(uuid) from anon;
-- grant execute on function get_teammates(uuid) to authenticated;
--
-- create table if not exists workout_templates (
--   id uuid primary key default gen_random_uuid(),
--   player_id uuid not null references players(id) on delete cascade,
--   name text not null,
--   created_at timestamptz not null default now()
-- );
--
-- create table if not exists workout_template_drills (
--   id uuid primary key default gen_random_uuid(),
--   template_id uuid not null references workout_templates(id) on delete cascade,
--   drill_id uuid not null references drills(id),
--   sort_order integer not null default 0
-- );
--
-- alter table workout_templates enable row level security;
-- alter table workout_template_drills enable row level security;
--
-- drop policy if exists workout_templates_access on workout_templates;
-- create policy workout_templates_access on workout_templates
--   for all
--   using (is_player_owner_or_guardian(workout_templates.player_id, auth.uid()));
--
-- drop policy if exists workout_template_drills_access on workout_template_drills;
-- create policy workout_template_drills_access on workout_template_drills
--   for all
--   using (
--     exists (
--       select 1 from workout_templates wt
--       where wt.id = workout_template_drills.template_id
--         and is_player_owner_or_guardian(wt.player_id, auth.uid())
--     )
--   );

-- ---------------------------------------------------------------------------
-- Migration for the already-deployed database (2026-08-25) — Phase 2:
-- badges (streak milestones + challenge wins) and 24h badge sharing on
-- Team Board. Run against the live project — every statement is
-- idempotent, safe even if part of this was already applied.
-- ---------------------------------------------------------------------------
-- create table if not exists badges (
--   id uuid primary key default gen_random_uuid(),
--   player_id uuid not null references players(id) on delete cascade,
--   type text not null,
--   dedupe_key text not null,
--   challenge_id uuid references challenges(id) on delete set null,
--   earned_at timestamptz not null default now(),
--   unique (player_id, dedupe_key)
-- );
--
-- alter table badges enable row level security;
--
-- drop policy if exists badges_owner_access on badges;
-- create policy badges_owner_access on badges
--   for all
--   using (is_player_owner_or_guardian(badges.player_id, auth.uid()));
--
-- drop policy if exists badges_coach_read on badges;
-- create policy badges_coach_read on badges
--   for select
--   using (
--     exists (
--       select 1 from team_memberships tm
--       join teams t on t.id = tm.team_id
--       where tm.player_id = badges.player_id and t.coach_user_id = auth.uid()
--     )
--   );
--
-- drop policy if exists badges_teammate_read on badges;
-- create policy badges_teammate_read on badges
--   for select
--   using (
--     exists (select 1 from players p where p.id = badges.player_id and p.stats_visible_to_team = true)
--     and is_teammate_of(badges.player_id, auth.uid())
--   );
--
-- alter table team_messages add column if not exists badge_type text;
-- alter table team_messages add column if not exists badge_label text;
-- alter table team_messages add column if not exists expires_at timestamptz;
--
-- drop policy if exists team_messages_select on team_messages;
-- create policy team_messages_select on team_messages
--   for select
--   using (
--     is_on_team(team_messages.team_id, auth.uid())
--     and (recipient_user_id is null or auth.uid() in (author_user_id, recipient_user_id))
--     and (expires_at is null or expires_at > now())
--   );

-- ---------------------------------------------------------------------------
-- Migration for the already-deployed database (2026-08-25) — Phase 3:
-- seasons (offseason toggle, weekly-goal mode, season archiving). Run
-- against the live project — every statement is idempotent, safe even if
-- part of this was already applied.
-- ---------------------------------------------------------------------------
-- create table if not exists seasons (
--   id uuid primary key default gen_random_uuid(),
--   player_id uuid not null references players(id) on delete cascade,
--   label text not null,
--   is_offseason boolean not null default false,
--   started_at timestamptz not null default now(),
--   ended_at timestamptz
-- );
--
-- create unique index if not exists seasons_one_active_per_player on seasons (player_id) where ended_at is null;
--
-- alter table seasons enable row level security;
--
-- drop policy if exists seasons_owner_access on seasons;
-- create policy seasons_owner_access on seasons
--   for all
--   using (is_player_owner_or_guardian(seasons.player_id, auth.uid()));
--
-- drop policy if exists seasons_coach_access on seasons;
-- create policy seasons_coach_access on seasons
--   for all
--   using (
--     exists (
--       select 1 from team_memberships tm
--       join teams t on t.id = tm.team_id
--       where tm.player_id = seasons.player_id and t.coach_user_id = auth.uid()
--     )
--   );
--
-- alter table completions add column if not exists season_id uuid references seasons(id) on delete set null;
--
-- create or replace function set_completion_season()
-- returns trigger
-- language plpgsql
-- as $$
-- begin
--   select id into new.season_id from seasons where player_id = new.player_id and ended_at is null limit 1;
--   return new;
-- end;
-- $$;
--
-- drop trigger if exists completions_set_season on completions;
-- create trigger completions_set_season
-- before insert on completions
-- for each row execute function set_completion_season();

-- ---------------------------------------------------------------------------
-- Migration for the already-deployed database (2026-08-25) — undo_season_
-- switch, the fail-safe for an accidental season toggle. Run against the
-- live project — idempotent, safe even if part of this was already applied.
-- No new table/column, just this one function.
-- ---------------------------------------------------------------------------
-- create or replace function undo_season_switch(p_previous_season_id uuid, p_new_season_id uuid)
-- returns void
-- language plpgsql
-- as $$
-- declare
--   v_prev_player uuid;
--   v_new_player uuid;
-- begin
--   select player_id into v_prev_player from seasons where id = p_previous_season_id;
--   select player_id into v_new_player from seasons where id = p_new_season_id and ended_at is null;
--
--   if v_prev_player is null or v_new_player is null or v_prev_player <> v_new_player then
--     return;
--   end if;
--
--   update completions set season_id = p_previous_season_id where season_id = p_new_season_id;
--   delete from seasons where id = p_new_season_id;
--   update seasons set ended_at = null where id = p_previous_season_id and ended_at is not null;
-- end;
-- $$;
--
-- grant execute on function undo_season_switch(uuid, uuid) to authenticated;
