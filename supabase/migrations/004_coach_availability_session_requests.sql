-- Coach recurring weekly availability + manual blocks + player session requests.

create table public.coach_weekly_slots (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  weekday smallint not null check (weekday >= 0 and weekday <= 6),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  constraint coach_weekly_slots_time_ok check (end_time > start_time)
);

create index ix_coach_weekly_slots_coach on public.coach_weekly_slots(coach_id);

comment on column public.coach_weekly_slots.weekday is '0 = Monday … 6 = Sunday (Python weekday convention).';

create table public.coach_availability_blocks (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  constraint coach_availability_blocks_range_ok check (ends_at > starts_at)
);

create index ix_coach_availability_blocks_coach on public.coach_availability_blocks(coach_id);

create table public.session_requests (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  requested_start timestamptz not null,
  requested_end timestamptz not null,
  note text,
  status varchar(32) not null default 'pending',
  coaching_session_id uuid references public.coaching_sessions(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint session_requests_range_ok check (requested_end > requested_start),
  constraint session_requests_status_chk check (status in ('pending', 'accepted', 'declined', 'cancelled'))
);

create index ix_session_requests_coach_status on public.session_requests(coach_id, status);
create index ix_session_requests_player on public.session_requests(player_id);
