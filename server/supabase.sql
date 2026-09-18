create extension if not exists pgcrypto;

create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists chats_user_updated_idx
on public.chats(user_id, updated_at desc);

create index if not exists messages_chat_created_idx
on public.messages(chat_id, created_at);

-- The server uses the Supabase service-role key, so RLS policies are not
-- required for this demo. Enable RLS + authenticated-user policies before
-- exposing the app publicly.

create or replace function public.touch_chat()
returns trigger
language plpgsql
as $$
begin
  update public.chats
  set updated_at = now()
  where id = new.chat_id;
  return new;
end;
$$;

drop trigger if exists messages_touch_chat on public.messages;

create trigger messages_touch_chat
after insert on public.messages
for each row execute function public.touch_chat();
