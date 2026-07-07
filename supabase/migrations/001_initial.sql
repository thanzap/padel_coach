-- Run in Supabase SQL Editor (or via Supabase CLI migrations).

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'player' check (role in ('coach', 'player', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'role', ''), 'player')
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;

create policy "profiles_select_own"
on public.profiles for select to authenticated
using (id = auth.uid());

create policy "profiles_update_own"
on public.profiles for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- Programs & exercises (coach-owned template)
-- ---------------------------------------------------------------------------
create table public.training_programs (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  description text,
  created_at timestamptz not null default now()
);

create table public.program_exercises (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.training_programs (id) on delete cascade,
  sort_order int not null,
  title text not null,
  description text,
  target_duration_sec int,
  unique (program_id, sort_order)
);

-- ---------------------------------------------------------------------------
-- Session + snapshot timeline (one row per exercise for this session)
-- ---------------------------------------------------------------------------
create table public.coaching_sessions (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.training_programs (id) on delete restrict,
  coach_id uuid not null references public.profiles (id) on delete cascade,
  player_id uuid not null references public.profiles (id) on delete cascade,
  title text,
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'completed', 'cancelled')),
  scheduled_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.session_exercises (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.coaching_sessions (id) on delete cascade,
  sort_order int not null,
  title text not null,
  description text,
  target_duration_sec int,
  source_program_exercise_id uuid references public.program_exercises (id) on delete set null,
  unique (session_id, sort_order)
);

create table public.exercise_recordings (
  id uuid primary key default gen_random_uuid(),
  session_exercise_id uuid not null references public.session_exercises (id) on delete cascade,
  storage_object_path text not null,
  duration_ms int,
  mime_type text,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.exercise_scores (
  id uuid primary key default gen_random_uuid(),
  session_exercise_id uuid not null references public.session_exercises (id) on delete cascade,
  coach_id uuid not null references public.profiles (id) on delete cascade,
  score numeric(4, 1) not null check (score >= 0 and score <= 10),
  notes text,
  created_at timestamptz not null default now(),
  unique (session_exercise_id, coach_id)
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.training_programs enable row level security;
alter table public.program_exercises enable row level security;
alter table public.coaching_sessions enable row level security;
alter table public.session_exercises enable row level security;
alter table public.exercise_recordings enable row level security;
alter table public.exercise_scores enable row level security;

create policy "programs_coach_rw"
on public.training_programs for all to authenticated
using (coach_id = auth.uid())
with check (coach_id = auth.uid());

create policy "programs_player_read_via_session"
on public.training_programs for select to authenticated
using (
  exists (
    select 1 from public.coaching_sessions s
    where s.program_id = training_programs.id
      and (s.player_id = auth.uid() or s.coach_id = auth.uid())
  )
);

create policy "program_exercises_coach_rw"
on public.program_exercises for all to authenticated
using (
  exists (
    select 1 from public.training_programs p
    where p.id = program_exercises.program_id and p.coach_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.training_programs p
    where p.id = program_exercises.program_id and p.coach_id = auth.uid()
  )
);

create policy "program_exercises_player_read_via_session"
on public.program_exercises for select to authenticated
using (
  exists (
    select 1 from public.coaching_sessions s
    where s.program_id = program_exercises.program_id
      and (s.player_id = auth.uid() or s.coach_id = auth.uid())
  )
);

create policy "sessions_participant_select"
on public.coaching_sessions for select to authenticated
using (coach_id = auth.uid() or player_id = auth.uid());

create policy "sessions_coach_insert"
on public.coaching_sessions for insert to authenticated
with check (coach_id = auth.uid());

create policy "sessions_coach_update"
on public.coaching_sessions for update to authenticated
using (coach_id = auth.uid())
with check (coach_id = auth.uid());

create policy "session_exercises_participant_select"
on public.session_exercises for select to authenticated
using (
  exists (
    select 1 from public.coaching_sessions s
    where s.id = session_exercises.session_id
      and (s.coach_id = auth.uid() or s.player_id = auth.uid())
  )
);

-- Timeline rows are created server-side (service role) or by coach via API; allow coach insert.
create policy "session_exercises_coach_insert"
on public.session_exercises for insert to authenticated
with check (
  exists (
    select 1 from public.coaching_sessions s
    where s.id = session_exercises.session_id and s.coach_id = auth.uid()
  )
);

create policy "recordings_participant_select"
on public.exercise_recordings for select to authenticated
using (
  exists (
    select 1
    from public.session_exercises se
    join public.coaching_sessions s on s.id = se.session_id
    where se.id = exercise_recordings.session_exercise_id
      and (s.coach_id = auth.uid() or s.player_id = auth.uid())
  )
);

create policy "recordings_participant_insert"
on public.exercise_recordings for insert to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.session_exercises se
    join public.coaching_sessions s on s.id = se.session_id
    where se.id = exercise_recordings.session_exercise_id
      and (s.coach_id = auth.uid() or s.player_id = auth.uid())
  )
);

create policy "scores_participant_select"
on public.exercise_scores for select to authenticated
using (
  exists (
    select 1
    from public.session_exercises se
    join public.coaching_sessions s on s.id = se.session_id
    where se.id = exercise_scores.session_exercise_id
      and (s.coach_id = auth.uid() or s.player_id = auth.uid())
  )
);

create policy "scores_coach_write"
on public.exercise_scores for insert to authenticated
with check (
  coach_id = auth.uid()
  and exists (
    select 1
    from public.session_exercises se
    join public.coaching_sessions s on s.id = se.session_id
    where se.id = exercise_scores.session_exercise_id
      and s.coach_id = auth.uid()
  )
);

create policy "scores_coach_update"
on public.exercise_scores for update to authenticated
using (coach_id = auth.uid())
with check (coach_id = auth.uid());

create policy "scores_coach_delete"
on public.exercise_scores for delete to authenticated
using (coach_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('exercise-recordings', 'exercise-recordings', false)
on conflict (id) do nothing;

create policy "recording_objects_select_participants"
on storage.objects for select to authenticated
using (
  bucket_id = 'exercise-recordings'
  and split_part(name, '/', 1) in (
    select id::text from public.coaching_sessions
    where coach_id = auth.uid() or player_id = auth.uid()
  )
);

create policy "recording_objects_insert_participants"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'exercise-recordings'
  and split_part(name, '/', 1) in (
    select id::text from public.coaching_sessions
    where coach_id = auth.uid() or player_id = auth.uid()
  )
);

create policy "recording_objects_update_participants"
on storage.objects for update to authenticated
using (
  bucket_id = 'exercise-recordings'
  and split_part(name, '/', 1) in (
    select id::text from public.coaching_sessions
    where coach_id = auth.uid() or player_id = auth.uid()
  )
);

create policy "recording_objects_delete_coach"
on storage.objects for delete to authenticated
using (
  bucket_id = 'exercise-recordings'
  and split_part(name, '/', 1) in (
    select id::text from public.coaching_sessions
    where coach_id = auth.uid()
  )
);
