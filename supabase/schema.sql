-- Run this file in Supabase Dashboard > SQL Editor.
-- One private JSON backup per authenticated WalletZen user.
create table if not exists public.walletzen_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.walletzen_data enable row level security;

drop policy if exists "Users can read their own WalletZen data" on public.walletzen_data;
create policy "Users can read their own WalletZen data"
  on public.walletzen_data for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own WalletZen data" on public.walletzen_data;
create policy "Users can insert their own WalletZen data"
  on public.walletzen_data for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own WalletZen data" on public.walletzen_data;
create policy "Users can update their own WalletZen data"
  on public.walletzen_data for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own WalletZen data" on public.walletzen_data;
create policy "Users can delete their own WalletZen data"
  on public.walletzen_data for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.walletzen_data to authenticated;
revoke all on public.walletzen_data from anon;
