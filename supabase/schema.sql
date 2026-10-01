-- Database schema for the Life Sciences department portal (Supabase / Postgres).
-- Run once in a fresh Supabase project: SQL Editor -> paste -> Run.
-- It creates the tables, security rules (RLS), helper functions, permissions and realtime.
-- Secrets are NOT included: fill in the values in the "Initial data" section at the bottom.

-- ===== Schemas and extensions =====

set check_function_bodies = off;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create extension if not exists pgcrypto with schema extensions;

-- ===== Tables =====

create table public.absences (
  user_id uuid default auth.uid() not null,
  subject_id uuid not null,
  count integer default 0 not null,
  updated_at timestamp with time zone default now() not null
);

create table public.announcements (
  id uuid default gen_random_uuid() not null,
  title text not null,
  body text default ''::text not null,
  urgent boolean default false not null,
  pinned boolean default false not null,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.exams (
  id uuid default gen_random_uuid() not null,
  subject_id uuid not null,
  kind text default 'شهري'::text not null,
  exam_date date not null,
  exam_time time without time zone,
  room text default ''::text not null,
  syllabus text default ''::text not null,
  created_at timestamp with time zone default now() not null
);

create table public.materials (
  id uuid default gen_random_uuid() not null,
  subject_id uuid not null,
  title text not null,
  url text not null,
  kind text default 'محاضرة'::text not null,
  week smallint,
  created_at timestamp with time zone default now() not null
);

create table public.profiles (
  id uuid not null,
  username text not null,
  email text not null,
  full_name text default ''::text not null,
  student_no text default ''::text not null,
  role text default 'student'::text not null,
  status text default 'active'::text not null,
  last_pin_sent_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table public.schedule (
  id uuid default gen_random_uuid() not null,
  subject_id uuid not null,
  day smallint not null,
  start_time time without time zone not null,
  end_time time without time zone not null,
  type text default 'نظري'::text not null,
  room text default ''::text not null,
  note text default ''::text not null,
  created_at timestamp with time zone default now() not null
);

create table public.settings (
  id integer default 1 not null,
  university text default 'جامعة آشور'::text not null,
  department text default 'قسم علوم الحياة'::text not null,
  stage text default 'المرحلة الرابعة'::text not null,
  section text default ''::text not null,
  rep_name text default ''::text not null,
  rep_contact text default ''::text not null,
  absence_limit integer default 6 not null,
  updated_at timestamp with time zone default now() not null
);

create table public.subjects (
  id uuid default gen_random_uuid() not null,
  name text not null,
  code text default ''::text not null,
  teacher text default ''::text not null,
  color text default '#1F8A6B'::text not null,
  sort integer default 0 not null,
  created_at timestamp with time zone default now() not null
);

create table private.config (
  id integer default 1 not null,
  join_code text not null,
  test_key text,
  brevo_api_key text,
  mail_from text,
  mail_from_name text default 'بوابة علوم الحياة'::text not null,
  app_url text
);

create table private.rate_events (
  key text not null,
  created_at timestamp with time zone default now() not null,
  id bigint generated always as identity
);

-- ===== Keys and constraints =====

alter table public.absences add constraint absences_pkey PRIMARY KEY (user_id, subject_id);
alter table public.announcements add constraint announcements_pkey PRIMARY KEY (id);
alter table public.exams add constraint exams_pkey PRIMARY KEY (id);
alter table public.materials add constraint materials_pkey PRIMARY KEY (id);
alter table public.profiles add constraint profiles_pkey PRIMARY KEY (id);
alter table public.schedule add constraint schedule_pkey PRIMARY KEY (id);
alter table public.settings add constraint settings_pkey PRIMARY KEY (id);
alter table public.subjects add constraint subjects_pkey PRIMARY KEY (id);
alter table private.config add constraint config_pkey PRIMARY KEY (id);
alter table private.rate_events add constraint rate_events_pkey PRIMARY KEY (id);
alter table public.profiles add constraint profiles_email_key UNIQUE (email);
alter table public.profiles add constraint profiles_username_key UNIQUE (username);
alter table public.absences add constraint absences_count_check CHECK (((count >= 0) AND (count <= 99)));
alter table public.announcements add constraint announcements_body_check CHECK ((char_length(body) <= 4000));
alter table public.announcements add constraint announcements_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 120)));
alter table public.exams add constraint exams_kind_check CHECK ((kind = ANY (ARRAY['يومي'::text, 'شهري'::text, 'فصلي'::text, 'نهائي'::text, 'عملي'::text])));
alter table public.exams add constraint exams_room_check CHECK ((char_length(room) <= 80));
alter table public.exams add constraint exams_syllabus_check CHECK ((char_length(syllabus) <= 1000));
alter table public.materials add constraint materials_kind_check CHECK ((kind = ANY (ARRAY['محاضرة'::text, 'ملزمة'::text, 'سلايدات'::text, 'تقرير'::text, 'أسئلة'::text, 'أخرى'::text])));
alter table public.materials add constraint materials_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 160)));
alter table public.materials add constraint materials_url_check CHECK (((url ~* '^https?://[^\s]+$'::text) AND (char_length(url) <= 2000)));
alter table public.materials add constraint materials_week_check CHECK (((week >= 1) AND (week <= 30)));
alter table public.profiles add constraint profiles_email_check CHECK (((email = lower(email)) AND (char_length(email) <= 254)));
alter table public.profiles add constraint profiles_full_name_check CHECK ((char_length(full_name) <= 80));
alter table public.profiles add constraint profiles_role_check CHECK ((role = ANY (ARRAY['student'::text, 'rep'::text, 'owner'::text])));
alter table public.profiles add constraint profiles_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text])));
alter table public.profiles add constraint profiles_student_no_check CHECK ((char_length(student_no) <= 30));
alter table public.profiles add constraint profiles_username_check CHECK ((username ~ '^[a-z0-9-]{4,20}$'::text));
alter table public.schedule add constraint schedule_check CHECK ((end_time > start_time));
alter table public.schedule add constraint schedule_day_check CHECK (((day >= 0) AND (day <= 6)));
alter table public.schedule add constraint schedule_note_check CHECK ((char_length(note) <= 160));
alter table public.schedule add constraint schedule_room_check CHECK ((char_length(room) <= 80));
alter table public.schedule add constraint schedule_type_check CHECK ((type = ANY (ARRAY['نظري'::text, 'عملي'::text])));
alter table public.settings add constraint settings_absence_limit_check CHECK (((absence_limit >= 1) AND (absence_limit <= 99)));
alter table public.settings add constraint settings_department_check CHECK ((char_length(department) <= 80));
alter table public.settings add constraint settings_id_check CHECK ((id = 1));
alter table public.settings add constraint settings_rep_contact_check CHECK ((char_length(rep_contact) <= 80));
alter table public.settings add constraint settings_rep_name_check CHECK ((char_length(rep_name) <= 80));
alter table public.settings add constraint settings_section_check CHECK ((char_length(section) <= 60));
alter table public.settings add constraint settings_stage_check CHECK ((char_length(stage) <= 60));
alter table public.settings add constraint settings_university_check CHECK ((char_length(university) <= 80));
alter table public.subjects add constraint subjects_code_check CHECK ((char_length(code) <= 20));
alter table public.subjects add constraint subjects_color_check CHECK ((color ~ '^#[0-9A-Fa-f]{6}$'::text));
alter table public.subjects add constraint subjects_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 80)));
alter table public.subjects add constraint subjects_teacher_check CHECK ((char_length(teacher) <= 80));
alter table private.config add constraint config_id_check CHECK ((id = 1));
alter table public.absences add constraint absences_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE;
alter table public.absences add constraint absences_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public.announcements add constraint announcements_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public.exams add constraint exams_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE;
alter table public.materials add constraint materials_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE;
alter table public.profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.schedule add constraint schedule_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE;

-- ===== Indexes =====

CREATE INDEX absences_subject_idx ON public.absences USING btree (subject_id);
CREATE INDEX announcements_created_by_idx ON public.announcements USING btree (created_by);
CREATE INDEX exams_subject_idx ON public.exams USING btree (subject_id);
CREATE INDEX materials_subject_idx ON public.materials USING btree (subject_id);
CREATE INDEX rate_events_key_time ON private.rate_events USING btree (key, created_at);
CREATE INDEX schedule_subject_idx ON public.schedule USING btree (subject_id);

-- ===== Functions =====

CREATE OR REPLACE FUNCTION public.check_join_code(p_code text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from private.config where id = 1 and join_code = upper(trim(coalesce(p_code,''))));
$function$
;

CREATE OR REPLACE FUNCTION public.delete_member(p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare target_role text;
begin
  if not private.is_staff() then raise exception 'not_allowed'; end if;
  if p_user = auth.uid() then raise exception 'cannot_change_self'; end if;
  select role into target_role from public.profiles where id = p_user;
  if target_role is null then raise exception 'not_found'; end if;
  if target_role = 'owner' then raise exception 'not_allowed'; end if;
  if target_role = 'rep' and not private.is_owner() then raise exception 'not_allowed'; end if;
  delete from auth.users where id = p_user;
end $function$
;

CREATE OR REPLACE FUNCTION public.get_join_code()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_staff() then raise exception 'not_allowed'; end if;
  return (select join_code from private.config where id = 1);
end $function$
;

CREATE OR REPLACE FUNCTION public.get_mail_config()
 RETURNS TABLE(brevo_api_key text, mail_from text, mail_from_name text, app_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select c.brevo_api_key, c.mail_from, c.mail_from_name, c.app_url from private.config c where c.id = 1;
$function$
;

CREATE OR REPLACE FUNCTION public.get_test_key()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select test_key from private.config where id = 1;
$function$
;

CREATE OR REPLACE FUNCTION public.rate_hit(p_key text, p_limit integer, p_window_seconds integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n int;
begin
  delete from private.rate_events where created_at < now() - interval '2 days';
  select count(*) into n from private.rate_events
    where key = p_key and created_at > now() - make_interval(secs => p_window_seconds);
  if n >= p_limit then return false; end if;
  insert into private.rate_events(key) values (p_key);
  return true;
end $function$
;

CREATE OR REPLACE FUNCTION public.set_join_code(p_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_staff() then raise exception 'not_allowed'; end if;
  if p_code !~ '^[A-Za-z0-9-]{4,20}$' then raise exception 'bad_code'; end if;
  update private.config set join_code = upper(p_code) where id = 1;
end $function$
;

CREATE OR REPLACE FUNCTION public.set_member_role(p_user uuid, p_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare target_role text;
begin
  if not private.is_owner() then raise exception 'not_allowed'; end if;
  if p_role not in ('student','rep') then raise exception 'bad_role'; end if;
  select role into target_role from public.profiles where id = p_user;
  if target_role is null then raise exception 'not_found'; end if;
  if target_role = 'owner' then raise exception 'not_allowed'; end if;
  update public.profiles set role = p_role where id = p_user;
end $function$
;

CREATE OR REPLACE FUNCTION public.set_member_status(p_user uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare target_role text;
begin
  if not private.is_staff() then raise exception 'not_allowed'; end if;
  if p_status not in ('active','disabled') then raise exception 'bad_status'; end if;
  if p_user = auth.uid() then raise exception 'cannot_change_self'; end if;
  select role into target_role from public.profiles where id = p_user;
  if target_role is null then raise exception 'not_found'; end if;
  if target_role = 'owner' then raise exception 'not_allowed'; end if;
  if target_role = 'rep' and not private.is_owner() then raise exception 'not_allowed'; end if;
  update public.profiles set status = p_status where id = p_user;
end $function$
;

CREATE OR REPLACE FUNCTION private.is_member()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active');
$function$
;

CREATE OR REPLACE FUNCTION private.is_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active' and p.role = 'owner');
$function$
;

CREATE OR REPLACE FUNCTION private.is_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active' and p.role in ('rep','owner'));
$function$
;

-- ===== Row level security =====

alter table public.absences enable row level security;
alter table public.announcements enable row level security;
alter table public.exams enable row level security;
alter table public.materials enable row level security;
alter table public.profiles enable row level security;
alter table public.schedule enable row level security;
alter table public.settings enable row level security;
alter table public.subjects enable row level security;

-- ===== Policies =====

create policy "absences: own rows" on public.absences as PERMISSIVE for ALL to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.is_member() AS is_member)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.is_member() AS is_member)));

create policy "announcements: members read" on public.announcements as PERMISSIVE for SELECT to authenticated
  using (( SELECT private.is_member() AS is_member));

create policy "announcements: staff delete" on public.announcements as PERMISSIVE for DELETE to authenticated
  using (( SELECT private.is_staff() AS is_staff));

create policy "announcements: staff insert" on public.announcements as PERMISSIVE for INSERT to authenticated
  with check (( SELECT private.is_staff() AS is_staff));

create policy "announcements: staff update" on public.announcements as PERMISSIVE for UPDATE to authenticated
  using (( SELECT private.is_staff() AS is_staff))
  with check (( SELECT private.is_staff() AS is_staff));

create policy "exams: members read" on public.exams as PERMISSIVE for SELECT to authenticated
  using (( SELECT private.is_member() AS is_member));

create policy "exams: staff delete" on public.exams as PERMISSIVE for DELETE to authenticated
  using (( SELECT private.is_staff() AS is_staff));

create policy "exams: staff insert" on public.exams as PERMISSIVE for INSERT to authenticated
  with check (( SELECT private.is_staff() AS is_staff));

create policy "exams: staff update" on public.exams as PERMISSIVE for UPDATE to authenticated
  using (( SELECT private.is_staff() AS is_staff))
  with check (( SELECT private.is_staff() AS is_staff));

create policy "materials: members read" on public.materials as PERMISSIVE for SELECT to authenticated
  using (( SELECT private.is_member() AS is_member));

create policy "materials: staff delete" on public.materials as PERMISSIVE for DELETE to authenticated
  using (( SELECT private.is_staff() AS is_staff));

create policy "materials: staff insert" on public.materials as PERMISSIVE for INSERT to authenticated
  with check (( SELECT private.is_staff() AS is_staff));

create policy "materials: staff update" on public.materials as PERMISSIVE for UPDATE to authenticated
  using (( SELECT private.is_staff() AS is_staff))
  with check (( SELECT private.is_staff() AS is_staff));

create policy "profiles: read self or staff" on public.profiles as PERMISSIVE for SELECT to authenticated
  using (((id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_staff() AS is_staff)));

create policy "profiles: update own name fields" on public.profiles as PERMISSIVE for UPDATE to authenticated
  using ((id = ( SELECT auth.uid() AS uid)))
  with check ((id = ( SELECT auth.uid() AS uid)));

create policy "schedule: members read" on public.schedule as PERMISSIVE for SELECT to authenticated
  using (( SELECT private.is_member() AS is_member));

create policy "schedule: staff delete" on public.schedule as PERMISSIVE for DELETE to authenticated
  using (( SELECT private.is_staff() AS is_staff));

create policy "schedule: staff insert" on public.schedule as PERMISSIVE for INSERT to authenticated
  with check (( SELECT private.is_staff() AS is_staff));

create policy "schedule: staff update" on public.schedule as PERMISSIVE for UPDATE to authenticated
  using (( SELECT private.is_staff() AS is_staff))
  with check (( SELECT private.is_staff() AS is_staff));

create policy "settings: anyone reads" on public.settings as PERMISSIVE for SELECT to anon, authenticated
  using (true);

create policy "settings: staff updates" on public.settings as PERMISSIVE for UPDATE to authenticated
  using (( SELECT private.is_staff() AS is_staff))
  with check (( SELECT private.is_staff() AS is_staff));

create policy "subjects: members read" on public.subjects as PERMISSIVE for SELECT to authenticated
  using (( SELECT private.is_member() AS is_member));

create policy "subjects: staff delete" on public.subjects as PERMISSIVE for DELETE to authenticated
  using (( SELECT private.is_staff() AS is_staff));

create policy "subjects: staff insert" on public.subjects as PERMISSIVE for INSERT to authenticated
  with check (( SELECT private.is_staff() AS is_staff));

create policy "subjects: staff update" on public.subjects as PERMISSIVE for UPDATE to authenticated
  using (( SELECT private.is_staff() AS is_staff))
  with check (( SELECT private.is_staff() AS is_staff));

-- ===== Table permissions =====

revoke all on table private.config from public, anon, authenticated;
revoke all on table private.rate_events from public, anon, authenticated;
revoke all on table public.absences from public, anon, authenticated;
revoke all on table public.announcements from public, anon, authenticated;
revoke all on table public.exams from public, anon, authenticated;
revoke all on table public.materials from public, anon, authenticated;
revoke all on table public.profiles from public, anon, authenticated;
revoke all on table public.schedule from public, anon, authenticated;
revoke all on table public.settings from public, anon, authenticated;
revoke all on table public.subjects from public, anon, authenticated;
grant delete, insert, select, update on table public.absences to authenticated;
grant delete, insert, select, update on table public.announcements to authenticated;
grant delete, insert, select, update on table public.exams to authenticated;
grant delete, insert, select, update on table public.materials to authenticated;
grant select on table public.profiles to authenticated;
grant delete, insert, select, update on table public.schedule to authenticated;
grant select on table public.settings to anon;
grant select on table public.settings to authenticated;
grant delete, insert, select, update on table public.subjects to authenticated;

-- Column-level update rights (students may edit only their name fields; staff edit settings through RLS)
grant update (full_name, student_no) on table public.profiles to authenticated;
grant update (university, department, stage, section, rep_name, rep_contact, absence_limit, updated_at) on table public.settings to authenticated;

-- ===== Function permissions =====

revoke all on function private.is_member() from public, anon, authenticated;
revoke all on function private.is_owner() from public, anon, authenticated;
revoke all on function private.is_staff() from public, anon, authenticated;
revoke all on function public.check_join_code(p_code text) from public, anon, authenticated;
revoke all on function public.delete_member(p_user uuid) from public, anon, authenticated;
revoke all on function public.get_join_code() from public, anon, authenticated;
revoke all on function public.get_mail_config() from public, anon, authenticated;
revoke all on function public.get_test_key() from public, anon, authenticated;
revoke all on function public.rate_hit(p_key text, p_limit integer, p_window_seconds integer) from public, anon, authenticated;
revoke all on function public.set_join_code(p_code text) from public, anon, authenticated;
revoke all on function public.set_member_role(p_user uuid, p_role text) from public, anon, authenticated;
revoke all on function public.set_member_status(p_user uuid, p_status text) from public, anon, authenticated;
grant execute on function private.is_member() to authenticated;
grant execute on function private.is_owner() to authenticated;
grant execute on function private.is_staff() to authenticated;
grant execute on function public.delete_member(p_user uuid) to authenticated;
grant execute on function public.get_join_code() to authenticated;
grant execute on function public.set_join_code(p_code text) to authenticated;
grant execute on function public.set_member_role(p_user uuid, p_role text) to authenticated;
grant execute on function public.set_member_status(p_user uuid, p_status text) to authenticated;

-- ===== Schema permissions =====

grant usage on schema private to authenticated;

-- ===== Realtime =====

alter publication supabase_realtime add table public.announcements;
alter publication supabase_realtime add table public.exams;
alter publication supabase_realtime add table public.materials;
alter publication supabase_realtime add table public.schedule;
alter publication supabase_realtime add table public.settings;
alter publication supabase_realtime add table public.subjects;

-- ===== Initial data =====

insert into public.settings (id) values (1) on conflict (id) do nothing;

-- Replace the placeholders before running.
-- join_code: the department code students type when they register.
-- brevo_api_key: your Brevo API key (or leave null and set BREVO_API_KEY as an Edge Function secret instead).
-- mail_from: a sender address verified in Brevo.  app_url: the public link of the app.
insert into private.config (id, join_code, test_key, brevo_api_key, mail_from, mail_from_name, app_url)
values (1, 'BIO-0000', null, null, 'you@example.com', 'بوابة علوم الحياة | Life Sciences Portal', 'https://example.github.io/app/')
on conflict (id) do nothing;
