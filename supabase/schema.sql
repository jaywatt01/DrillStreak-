-- DrillStreak — schema, RLS, and seed data
--
-- This matches what's actually deployed to the live Supabase project
-- (jiohhwahvzajvidbiqnm) as of 2026-07-20. Applied via two migrations:
-- drillstreak_initial_schema, then fix_players_team_memberships_rls_recursion
-- (see the second block below — the original draft had a real bug, caught
-- by testing RLS as non-owner roles rather than trusting a service-role
-- read-through, which bypasses RLS and would never have surfaced it).

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
  created_at timestamptz not null default now()
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
  check (team_id is not null or player_id is not null)
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
  created_at timestamptz not null default now()
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

create policy completions_coach_read on completions
  for select
  using (
    exists (
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
-- ---------------------------------------------------------------------------
insert into drills (name, category, is_default) values
  ('50 form shooting reps', 'shooting', true),
  ('100 free throws', 'shooting', true),
  ('Spot-up shooting, 5 spots x 10', 'shooting', true),
  ('Two-ball dribbling, 5 min', 'ballhandling', true),
  ('Cone weave dribbling, 10 reps', 'ballhandling', true),
  ('Crossover series, 5 min', 'ballhandling', true),
  ('Suicides x 5', 'conditioning', true),
  ('Defensive slides, 5 min', 'conditioning', true),
  ('Jump rope, 10 min', 'conditioning', true),
  ('Full-court sprints x 10', 'conditioning', true);
