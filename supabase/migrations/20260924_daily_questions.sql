create schema if not exists private;

create table if not exists public.daily_questions (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  question_date date not null,
  question text not null,
  category text not null,
  difficulty text not null default 'medium',
  ai_model text,
  created_at timestamptz not null default now(),
  unique(space_id, question_date)
);

create table if not exists public.daily_question_answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.daily_questions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  answer text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(question_id, user_id)
);

create index if not exists daily_questions_space_date_idx on public.daily_questions(space_id, question_date desc);
create index if not exists daily_question_answers_question_idx on public.daily_question_answers(question_id);
create index if not exists daily_question_answers_user_idx on public.daily_question_answers(user_id);

create or replace function private.user_space_ids()
returns setof uuid language sql stable security definer set search_path = ''
as $$ select sm.space_id from public.space_members sm where sm.user_id = (select auth.uid()) $$;

create or replace function private.is_space_member(p_space_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.space_members sm where sm.space_id = p_space_id and sm.user_id = (select auth.uid())) $$;

create or replace function private.daily_question_answer_count(p_question_id uuid)
returns integer language sql stable security definer set search_path = ''
as $$ select count(*)::integer from public.daily_question_answers where question_id = p_question_id $$;

create or replace function private.is_daily_question_revealed(p_question_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select
    private.daily_question_answer_count(p_question_id) >= 2
    and exists (
      select 1 from public.daily_questions q
      join public.space_members sm on sm.space_id = q.space_id
      where q.id = p_question_id
      group by q.id
      having count(sm.user_id) >= 2
    )
$$;

create or replace function public.get_daily_question_status(p_question_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare
  q_space_id uuid;
  own_answer text;
  answer_count integer := 0;
begin
  select q.space_id into q_space_id from public.daily_questions q where q.id = p_question_id;
  if q_space_id is null or not private.is_space_member(q_space_id) then raise exception 'Question not available'; end if;
  answer_count := private.daily_question_answer_count(p_question_id);
  select a.answer into own_answer from public.daily_question_answers a where a.question_id = p_question_id and a.user_id = (select auth.uid());
  return jsonb_build_object(
    'own_answer',own_answer,
    'has_answered',own_answer is not null,
    'partner_answered',answer_count >= 2,
    'revealed',answer_count >= 2,
    'answer_count',answer_count
  );
end;
$$;

create or replace function public.submit_daily_answer(p_question_id uuid,p_answer text)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  q_space_id uuid;
  cleaned text;
begin
  cleaned:=btrim(coalesce(p_answer,''));
  if length(cleaned)<1 then raise exception 'Answer cannot be empty'; end if;
  if length(cleaned)>2000 then raise exception 'Answer is too long'; end if;
  select q.space_id into q_space_id from public.daily_questions q where q.id=p_question_id;
  if q_space_id is null or not private.is_space_member(q_space_id) then raise exception 'Question not available'; end if;
  if private.is_daily_question_revealed(p_question_id) then raise exception 'Answers are already revealed and locked'; end if;
  insert into public.daily_question_answers(question_id,user_id,answer,created_at,updated_at)
  values(p_question_id,(select auth.uid()),cleaned,now(),now())
  on conflict(question_id,user_id) do update set answer=excluded.answer,updated_at=now();
  return public.get_daily_question_status(p_question_id);
end;
$$;

alter table public.daily_questions enable row level security;
alter table public.daily_question_answers enable row level security;

revoke all on public.daily_questions from anon, authenticated;
revoke all on public.daily_question_answers from anon, authenticated;
grant select on public.daily_questions to authenticated;
grant select,insert,update on public.daily_question_answers to authenticated;

drop policy if exists "Daily questions are visible to space members" on public.daily_questions;
create policy "Daily questions are visible to space members"
on public.daily_questions for select to authenticated
using (space_id in (select private.user_space_ids()));

drop policy if exists "Users see their own answer or revealed answers" on public.daily_question_answers;
create policy "Users see their own answer or revealed answers"
on public.daily_question_answers for select to authenticated
using (user_id=(select auth.uid()) or private.is_daily_question_revealed(question_id));

drop policy if exists "Users can submit their own daily answer" on public.daily_question_answers;
create policy "Users can submit their own daily answer"
on public.daily_question_answers for insert to authenticated
with check (
  user_id=(select auth.uid())
  and private.is_space_member((select q.space_id from public.daily_questions q where q.id=question_id))
);

drop policy if exists "Users can edit their answer before reveal" on public.daily_question_answers;
create policy "Users can edit their answer before reveal"
on public.daily_question_answers for update to authenticated
using (user_id=(select auth.uid()) and not private.is_daily_question_revealed(question_id))
with check (user_id=(select auth.uid()) and not private.is_daily_question_revealed(question_id));

revoke execute on function public.get_daily_question_status(uuid) from public,anon;
grant execute on function public.get_daily_question_status(uuid) to authenticated;
revoke execute on function public.submit_daily_answer(uuid,text) from public,anon;
grant execute on function public.submit_daily_answer(uuid,text) to authenticated;

revoke execute on function private.user_space_ids() from public;
revoke execute on function private.is_space_member(uuid) from public;
revoke execute on function private.daily_question_answer_count(uuid) from public;
revoke execute on function private.is_daily_question_revealed(uuid) from public;
grant execute on function private.user_space_ids() to authenticated;
grant execute on function private.is_space_member(uuid) to authenticated;
grant execute on function private.daily_question_answer_count(uuid) to authenticated;
grant execute on function private.is_daily_question_revealed(uuid) to authenticated;
