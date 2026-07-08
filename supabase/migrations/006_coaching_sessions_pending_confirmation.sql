-- Allow coach-proposed sessions to await player confirmation before becoming 'planned'.

alter table public.coaching_sessions
  drop constraint if exists coaching_sessions_status_check;

alter table public.coaching_sessions
  add constraint coaching_sessions_status_check
  check (status in ('pending_confirmation', 'planned', 'in_progress', 'completed', 'cancelled'));
