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
  position text
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
-- restriction for just id+display_name, re-verifying the caller actually
-- owns/guards p_player_id first.
create or replace function get_teammates(p_player_id uuid)
returns table(id uuid, display_name text, team_id uuid)
language sql
security definer
stable
set search_path = public
as $$
  -- distinct on (p.id) so a pair sharing more than one team still returns
  -- one row per teammate, not one per shared team; team_id picked
  -- deterministically (lowest uuid) since which shared roster gets
  -- recorded on the resulting challenge doesn't matter functionally.
  select distinct on (p.id) p.id, p.display_name, tm_other.team_id
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

-- list_my_teams: every team a caller can reach — as coach, or as a
-- guardian of a rostered player. Nothing on My Team surfaces teams you
-- don't coach today, so this is the entry point the Team Board screen uses
-- to find teams a parent-only account is actually part of. security
-- definer for the same reason as is_on_team; invite_code is deliberately
-- returned null for guardian rows — teams_coach_access exists specifically
-- to keep invite codes coach-only, preserved here rather than reopened.
create or replace function list_my_teams()
returns table(id uuid, name text, invite_code text, role text)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.name, t.invite_code, 'coach'::text as role
  from teams t
  where t.coach_user_id = auth.uid()
  union
  select distinct t.id, t.name, null::text as invite_code, 'guardian'::text as role
  from teams t
  join team_memberships tm on tm.team_id = t.id
  where is_player_owner_or_guardian(tm.player_id, auth.uid())
    and t.coach_user_id <> auth.uid();
$$;

revoke all on function list_my_teams() from public;
revoke all on function list_my_teams() from anon;
grant execute on function list_my_teams() to authenticated;

-- list_team_contacts: the "who can I DM" list for a team — the coach, plus
-- one row per distinct guardian, labeled by which rostered player(s) they
-- guard on this team. Deliberately returns a role-based label, never an
-- email — DMs are addressed by user_id, this is just enough for a parent
-- to recognize who they're messaging, not a cross-family contact list.
create or replace function list_team_contacts(p_team_id uuid)
returns table(user_id uuid, label text)
language sql
stable
security definer
set search_path = public
as $$
  select t.coach_user_id, 'Coach'::text
  from teams t
  where t.id = p_team_id
    and is_on_team(p_team_id, auth.uid())
  union
  select g.guardian_user_id, 'Parent of ' || string_agg(distinct p.display_name, ', ')
  from team_memberships tm
  join players p on p.id = tm.player_id
  join guardianships g on g.player_id = p.id
  where tm.team_id = p_team_id
    and is_on_team(p_team_id, auth.uid())
    and g.guardian_user_id <> (select coach_user_id from teams where id = p_team_id)
  group by g.guardian_user_id
  union
  select p.created_by_user_id, 'Parent of ' || string_agg(distinct p.display_name, ', ')
  from team_memberships tm
  join players p on p.id = tm.player_id
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
  created_at timestamptz not null default now()
);

alter table team_messages enable row level security;

-- Team-wide messages (recipient_user_id null) are visible to anyone on the
-- team; a DM is visible only to the two people in it.
create policy team_messages_select on team_messages
  for select
  using (
    is_on_team(team_messages.team_id, auth.uid())
    and (recipient_user_id is null or auth.uid() in (author_user_id, recipient_user_id))
  );

-- Can only post as yourself, on a team you're actually on — and for a DM,
-- only to someone else who's also actually on that same team.
create policy team_messages_insert on team_messages
  for insert
  with check (
    author_user_id = auth.uid()
    and is_on_team(team_messages.team_id, auth.uid())
    and (recipient_user_id is null or is_on_team(team_messages.team_id, recipient_user_id))
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
  age_attested_13_or_over boolean not null,
  age_attested_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy profiles_owner_read on profiles
  for select
  using (user_id = auth.uid());

create policy profiles_owner_delete on profiles
  for delete
  using (user_id = auth.uid());

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
