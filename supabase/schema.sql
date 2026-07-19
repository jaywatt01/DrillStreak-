-- DrillStreak — draft schema
--
-- This is a starting point to hand to Claude Code during the live Supabase
-- backend build step (see ../README.md, prompt 2) — not verified against a
-- running Supabase instance. Treat the RLS policies as a strong first draft
-- to test and correct live, not as already-audited security rules.

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
-- No cap on custom drill count (decided July 19, 2026) — see DRILLSTREAK.md
-- ---------------------------------------------------------------------------
create table drills (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text, -- e.g. ballhandling / shooting / conditioning
  is_default boolean not null default false,
  created_by_user_id uuid references auth.users(id), -- null for seeded defaults
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

-- teams: full access for the coach who owns it; read-only implied for
-- rostered players via team_memberships/players policies above
create policy teams_coach_access on teams
  for all
  using (coach_user_id = auth.uid());

create policy team_memberships_access on team_memberships
  for all
  using (
    exists (select 1 from teams t where t.id = team_memberships.team_id and t.coach_user_id = auth.uid())
    or exists (
      select 1 from players p
      where p.id = team_memberships.player_id
      and (p.created_by_user_id = auth.uid()
        or exists (select 1 from guardianships g where g.player_id = p.id and g.guardian_user_id = auth.uid()))
    )
  );

-- drills: default library is world-readable; custom drills are visible to
-- their creator, plus anyone who can see an assignment/completion using them
create policy drills_select on drills
  for select
  using (
    is_default = true
    or created_by_user_id = auth.uid()
    or exists (
      select 1 from assignments a
      where a.drill_id = drills.id
      and (
        exists (select 1 from teams t where t.id = a.team_id and t.coach_user_id = auth.uid())
        or exists (
          select 1 from players p
          where p.id = a.player_id
          and (p.created_by_user_id = auth.uid()
            or exists (select 1 from guardianships g where g.player_id = p.id and g.guardian_user_id = auth.uid()))
        )
      )
    )
  );

create policy drills_insert on drills
  for insert
  with check (created_by_user_id = auth.uid());

-- assignments: coach manages team assignments; guardian/player manages
-- their own individual (non-team) assignments
create policy assignments_access on assignments
  for all
  using (
    (team_id is not null and exists (select 1 from teams t where t.id = assignments.team_id and t.coach_user_id = auth.uid()))
    or (player_id is not null and exists (
      select 1 from players p
      where p.id = assignments.player_id
      and (p.created_by_user_id = auth.uid()
        or exists (select 1 from guardianships g where g.player_id = p.id and g.guardian_user_id = auth.uid()))
    ))
  );

-- completions: writable by the player's owner/guardian; readable by them
-- AND by the coach of any team the player is on (accountability is the
-- whole point — coach sees real logs regardless of who defined the drill)
create policy completions_owner_access on completions
  for all
  using (
    exists (
      select 1 from players p
      where p.id = completions.player_id
      and (p.created_by_user_id = auth.uid()
        or exists (select 1 from guardianships g where g.player_id = p.id and g.guardian_user_id = auth.uid()))
    )
  );

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
