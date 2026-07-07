-- Session end time; mark one-off routines created from the scheduler.

alter table public.coaching_sessions add column if not exists ends_at timestamptz;

alter table public.training_programs add column if not exists adhoc boolean not null default false;

comment on column public.coaching_sessions.ends_at is 'Planned session end (paired with scheduled_at as start).';
comment on column public.training_programs.adhoc is 'True when created only for a specific session (not intended as a reusable library routine).';
