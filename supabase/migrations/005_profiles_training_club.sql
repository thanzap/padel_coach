-- Training club shown under a coach's name in player search results.

alter table public.profiles
  add column if not exists training_club text;

comment on column public.profiles.training_club is 'Club / academy the coach trains at, shown in coach discovery.';
