-- Profile completion + location for coach search; session venue for dashboards.

alter table public.profiles
  add column if not exists primary_place text,
  add column if not exists bio text,
  add column if not exists profile_completed boolean not null default false;

alter table public.coaching_sessions
  add column if not exists venue_place text;

comment on column public.profiles.primary_place is 'City / area shown on profile and used for coach discovery.';
comment on column public.coaching_sessions.venue_place is 'Where the training took place (court / city).';
