-- Lounge TV universal catalogue delivery layer.
-- STAGING ONLY. This migration is not applied by committing this file.
-- It deliberately reuses existing Lounge customer/subscription/provider plumbing.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.lounge_catalogue_releases (
  id uuid primary key default gen_random_uuid(),
  release_key text not null unique,
  live_version text not null,
  vod_version text not null,
  status text not null default 'draft'
    check (status in ('draft','staging','active','retired')),
  expected_live_count integer not null default 0,
  expected_movie_count integer not null default 0,
  expected_series_count integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  locked_at timestamptz,
  activated_at timestamptz
);

create table if not exists public.lounge_catalogue_categories (
  release_id uuid not null references public.lounge_catalogue_releases(id) on delete cascade,
  content_kind text not null check (content_kind in ('live','movie','series')),
  category_id integer not null,
  category_key text not null,
  display_name text not null,
  view_group text not null default 'catalogue',
  sort_order integer not null default 0,
  primary key (release_id, content_kind, category_id),
  unique (release_id, content_kind, category_key)
);

create table if not exists public.lounge_catalogue_items (
  release_id uuid not null references public.lounge_catalogue_releases(id) on delete cascade,
  content_kind text not null check (content_kind in ('live','movie','series')),
  item_id bigint not null,
  canonical_id uuid not null,
  name text not null,
  icon_url text,
  backdrop_url text,
  epg_id text,
  container_extension text,
  release_year smallint,
  rating numeric,
  plot text,
  sort_order integer not null default 0,
  snapshot jsonb not null default '{}'::jsonb,
  primary key (release_id, content_kind, item_id),
  unique (release_id, content_kind, canonical_id)
);

create table if not exists public.lounge_catalogue_item_categories (
  release_id uuid not null,
  content_kind text not null check (content_kind in ('live','movie','series')),
  item_id bigint not null,
  category_id integer not null,
  rank numeric not null default 0,
  primary key (release_id, content_kind, item_id, category_id),
  foreign key (release_id, content_kind, item_id)
    references public.lounge_catalogue_items(release_id, content_kind, item_id)
    on delete cascade,
  foreign key (release_id, content_kind, category_id)
    references public.lounge_catalogue_categories(release_id, content_kind, category_id)
    on delete cascade
);

create table if not exists public.lounge_catalogue_episode_items (
  release_id uuid not null references public.lounge_catalogue_releases(id) on delete cascade,
  series_item_id bigint not null,
  episode_item_id bigint not null,
  canonical_episode_id uuid not null,
  season_number integer not null,
  episode_number integer not null,
  name text,
  icon_url text,
  plot text,
  release_date date,
  container_extension text,
  snapshot jsonb not null default '{}'::jsonb,
  primary key (release_id, episode_item_id),
  unique (release_id, canonical_episode_id),
  foreign key (release_id, content_kind, series_item_id)
    references public.lounge_catalogue_items(release_id, content_kind, item_id)
    on delete cascade
    deferrable initially deferred
);

-- The FK above is constrained to series via this check trigger because a composite
-- constant cannot be expressed directly in a normal FK.
create or replace function public.lounge_catalogue_episode_series_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.lounge_catalogue_items i
    where i.release_id = new.release_id
      and i.content_kind = 'series'
      and i.item_id = new.series_item_id
  ) then
    raise exception 'episode parent is not a released series';
  end if;
  return new;
end;
$$;

drop trigger if exists lounge_catalogue_episode_series_guard_trg
  on public.lounge_catalogue_episode_items;
create trigger lounge_catalogue_episode_series_guard_trg
before insert or update on public.lounge_catalogue_episode_items
for each row execute function public.lounge_catalogue_episode_series_guard();

create table if not exists public.lounge_delivery_credentials (
  user_id uuid primary key,
  username text not null,
  password_hash text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists lounge_delivery_credentials_username_ci
  on public.lounge_delivery_credentials (lower(username));

-- These tables are server-side only. The Worker uses service_role.
alter table public.lounge_catalogue_releases enable row level security;
alter table public.lounge_catalogue_categories enable row level security;
alter table public.lounge_catalogue_items enable row level security;
alter table public.lounge_catalogue_item_categories enable row level security;
alter table public.lounge_catalogue_episode_items enable row level security;
alter table public.lounge_delivery_credentials enable row level security;

revoke all on public.lounge_catalogue_releases from anon, authenticated;
revoke all on public.lounge_catalogue_categories from anon, authenticated;
revoke all on public.lounge_catalogue_items from anon, authenticated;
revoke all on public.lounge_catalogue_item_categories from anon, authenticated;
revoke all on public.lounge_catalogue_episode_items from anon, authenticated;
revoke all on public.lounge_delivery_credentials from anon, authenticated;

grant all on public.lounge_catalogue_releases to service_role;
grant all on public.lounge_catalogue_categories to service_role;
grant all on public.lounge_catalogue_items to service_role;
grant all on public.lounge_catalogue_item_categories to service_role;
grant all on public.lounge_catalogue_episode_items to service_role;
grant all on public.lounge_delivery_credentials to service_role;

create or replace function public.lounge_delivery_set_credential(
  p_user_id uuid,
  p_username text,
  p_password text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if length(trim(coalesce(p_username,''))) < 3
     or length(coalesce(p_password,'')) < 8 then
    raise exception 'invalid Lounge credential';
  end if;

  insert into public.lounge_delivery_credentials(user_id, username, password_hash, enabled, updated_at)
  values (
    p_user_id,
    trim(p_username),
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    true,
    now()
  )
  on conflict (user_id) do update
    set username = excluded.username,
        password_hash = excluded.password_hash,
        enabled = true,
        updated_at = now();
end;
$$;

create or replace function public.lounge_delivery_authenticate(
  p_username text,
  p_password text,
  p_release_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_subscription public.subscriptions%rowtype;
  v_release public.lounge_catalogue_releases%rowtype;
  v_max_connections integer := 1;
begin
  select c.user_id
    into v_user_id
  from public.lounge_delivery_credentials c
  where lower(c.username) = lower(trim(p_username))
    and c.enabled
    and c.password_hash = extensions.crypt(p_password, c.password_hash)
  limit 1;

  if v_user_id is null then
    return jsonb_build_object('ok',false,'status','invalid_credentials');
  end if;

  select s.*
    into v_subscription
  from public.subscriptions s
  where s.user_id = v_user_id
    and s.status = 'active'
    and (s.current_period_end is null or s.current_period_end > now())
  order by s.current_period_end desc nulls first, s.created_at desc
  limit 1;

  if v_subscription.id is null then
    return jsonb_build_object('ok',false,'status','subscription_not_active');
  end if;

  select r.*
    into v_release
  from public.lounge_catalogue_releases r
  where r.release_key = p_release_key
    and r.status in ('staging','active')
  limit 1;

  if v_release.id is null then
    return jsonb_build_object('ok',false,'status','catalogue_release_unavailable');
  end if;

  select greatest(1, coalesce(p.simultaneous_streams,1))
    into v_max_connections
  from public.plans p
  where p.id = v_subscription.plan_id;

  return jsonb_build_object(
    'ok', true,
    'status', 'active',
    'user_id', v_user_id,
    'subscription_id', v_subscription.id,
    'expires_at', v_subscription.current_period_end,
    'max_connections', coalesce(v_max_connections,1),
    'release_id', v_release.id,
    'release_key', v_release.release_key,
    'live_count', v_release.expected_live_count,
    'movie_count', v_release.expected_movie_count,
    'series_count', v_release.expected_series_count
  );
end;
$$;

create or replace function public.lounge_delivery_validate_release(p_release_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with expected as (
    select * from public.lounge_catalogue_releases where id = p_release_id
  ),
  actual as (
    select
      count(*) filter (where content_kind='live')::int live_count,
      count(*) filter (where content_kind='movie')::int movie_count,
      count(*) filter (where content_kind='series')::int series_count
    from public.lounge_catalogue_items
    where release_id = p_release_id
  )
  select jsonb_build_object(
    'ok',
      a.live_count = e.expected_live_count
      and a.movie_count = e.expected_movie_count
      and a.series_count = e.expected_series_count,
    'expected_live', e.expected_live_count,
    'actual_live', a.live_count,
    'expected_movies', e.expected_movie_count,
    'actual_movies', a.movie_count,
    'expected_series', e.expected_series_count,
    'actual_series', a.series_count
  )
  from expected e cross join actual a;
$$;

create or replace function public.lounge_delivery_series_info(
  p_release_id uuid,
  p_series_item_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_info jsonb;
  v_episodes jsonb := '{}'::jsonb;
begin
  select coalesce(i.snapshot,'{}'::jsonb)
      || jsonb_build_object(
        'name',i.name,
        'series_id',i.item_id,
        'cover',i.icon_url,
        'plot',i.plot,
        'rating',i.rating,
        'release_year',i.release_year,
        'backdrop_path',
          case when i.backdrop_url is null then '[]'::jsonb
               else jsonb_build_array(i.backdrop_url) end
      )
    into v_info
  from public.lounge_catalogue_items i
  where i.release_id=p_release_id
    and i.content_kind='series'
    and i.item_id=p_series_item_id;

  if v_info is null then
    return jsonb_build_object('info',null,'episodes','{}'::jsonb);
  end if;

  select coalesce(jsonb_object_agg(x.season_number::text, x.episodes),'{}'::jsonb)
    into v_episodes
  from (
    select e.season_number,
      jsonb_agg(
        coalesce(e.snapshot,'{}'::jsonb)
        || jsonb_build_object(
          'id',e.episode_item_id,
          'episode_num',e.episode_number,
          'title',coalesce(e.name,'Episode '||e.episode_number),
          'container_extension',coalesce(e.container_extension,'mp4'),
          'info',jsonb_build_object(
            'plot',e.plot,
            'movie_image',e.icon_url,
            'releasedate',e.release_date
          )
        )
        order by e.episode_number
      ) as episodes
    from public.lounge_catalogue_episode_items e
    where e.release_id=p_release_id
      and e.series_item_id=p_series_item_id
    group by e.season_number
  ) x;

  return jsonb_build_object('info',v_info,'episodes',v_episodes);
end;
$$;

create or replace function public.lounge_delivery_epg(
  p_release_id uuid,
  p_stream_id bigint default null,
  p_hours integer default 48
)
returns table(
  stream_id bigint,
  epg_id text,
  start_at timestamptz,
  end_at timestamptz,
  title text,
  description text,
  icon_url text
)
language sql
security definer
set search_path = ''
as $$
  select
    i.item_id,
    i.epg_id,
    e.start_at,
    e.end_at,
    e.title,
    e.description,
    e.icon_url
  from public.lounge_catalogue_items i
  join lounge_core.live_epg_programmes e
    on e.live_channel_id=i.canonical_id
  where i.release_id=p_release_id
    and i.content_kind='live'
    and (p_stream_id is null or i.item_id=p_stream_id)
    and e.end_at > now()
    and e.start_at < now() + make_interval(hours => greatest(1,least(p_hours,168)))
  order by i.item_id,e.start_at;
$$;

create or replace function public.lounge_delivery_resolve_source(
  p_user_id uuid,
  p_release_id uuid,
  p_content_kind text,
  p_item_id bigint,
  p_client_key text default ''
)
returns table(
  route_kind text,
  source_ref text,
  source_format text,
  server_url text,
  provider_username text,
  provider_password text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_canonical_id uuid;
  v_provider_account_id uuid;
  v_provider_id uuid;
  v_slot_count integer;
  v_slot_offset integer;
  v_server_secret uuid;
  v_username_secret uuid;
  v_password_secret uuid;
begin
  if p_content_kind not in ('live','movie','episode') then
    raise exception 'unsupported content kind';
  end if;

  if p_content_kind='episode' then
    select e.canonical_episode_id
      into v_canonical_id
    from public.lounge_catalogue_episode_items e
    where e.release_id=p_release_id and e.episode_item_id=p_item_id;
  else
    select i.canonical_id
      into v_canonical_id
    from public.lounge_catalogue_items i
    where i.release_id=p_release_id
      and i.content_kind=p_content_kind
      and i.item_id=p_item_id;
  end if;

  if v_canonical_id is null then
    raise exception 'catalogue item unavailable';
  end if;

  with eligible as (
    select distinct ss.source_id, ss.slot_index
    from public.stream_slots ss
    join public.service_assignments sa on sa.id=ss.service_assignment_id
    join public.subscriptions s on s.id=sa.subscription_id
    join public.provider_accounts pa on pa.id=ss.source_id
    where sa.user_id=p_user_id
      and sa.status='active'
      and (sa.expires_at is null or sa.expires_at>now())
      and s.status='active'
      and (s.current_period_end is null or s.current_period_end>now())
      and pa.status='assigned'
      and (pa.expires_at is null or pa.expires_at>now())
    order by ss.slot_index, ss.source_id
  )
  select count(*) into v_slot_count from eligible;

  if coalesce(v_slot_count,0)=0 then
    raise exception 'no active provider slot';
  end if;

  v_slot_offset := mod(abs(hashtextextended(coalesce(p_client_key,''),0)),v_slot_count);

  with eligible as (
    select distinct ss.source_id, ss.slot_index
    from public.stream_slots ss
    join public.service_assignments sa on sa.id=ss.service_assignment_id
    join public.subscriptions s on s.id=sa.subscription_id
    join public.provider_accounts pa on pa.id=ss.source_id
    where sa.user_id=p_user_id
      and sa.status='active'
      and (sa.expires_at is null or sa.expires_at>now())
      and s.status='active'
      and (s.current_period_end is null or s.current_period_end>now())
      and pa.status='assigned'
      and (pa.expires_at is null or pa.expires_at>now())
    order by ss.slot_index, ss.source_id
  )
  select e.source_id into v_provider_account_id
  from eligible e
  offset v_slot_offset limit 1;

  select pa.provider_id
    into v_provider_id
  from public.provider_accounts pa
  where pa.id=v_provider_account_id;

  select pas.server_url_vault_id,pas.username_vault_id,pas.password_vault_id
    into v_server_secret,v_username_secret,v_password_secret
  from public.provider_account_secrets pas
  where pas.provider_account_id=v_provider_account_id;

  if p_content_kind='live' then
    select
      'live',
      ls.provider_stream_id::text,
      coalesce(nullif(ls.source_format,''),'ts'),
      s.decrypted_secret::text,
      u.decrypted_secret::text,
      p.decrypted_secret::text
    into route_kind,source_ref,source_format,server_url,provider_username,provider_password
    from lounge_core.live_sources ls
    join vault.decrypted_secrets s on s.id=v_server_secret
    join vault.decrypted_secrets u on u.id=v_username_secret
    join vault.decrypted_secrets p on p.id=v_password_secret
    where ls.live_channel_id=v_canonical_id
      and ls.provider_id=v_provider_id
      and ls.status not in ('dead','rejected')
    order by
      case ls.source_role when 'primary' then 0 when 'alternate' then 1 else 2 end,
      case ls.status when 'verified' then 0 when 'candidate' then 1 else 2 end,
      ls.health_score desc,
      ls.quality_score desc
    limit 1;
  elsif p_content_kind='movie' then
    select
      'movie',
      vs.provider_item_id::text,
      coalesce(nullif(vs.file_ext,''),'mp4'),
      s.decrypted_secret::text,
      u.decrypted_secret::text,
      p.decrypted_secret::text
    into route_kind,source_ref,source_format,server_url,provider_username,provider_password
    from lounge_core.sources vs
    join vault.decrypted_secrets s on s.id=v_server_secret
    join vault.decrypted_secrets u on u.id=v_username_secret
    join vault.decrypted_secrets p on p.id=v_password_secret
    where vs.title_id=v_canonical_id
      and vs.provider_id=v_provider_id
      and vs.provider_kind='movies'
      and vs.status not in ('rejected','missing')
      and not vs.is_cam
      and not vs.is_foreign
    order by
      case vs.source_role when 'primary' then 0 else 1 end,
      case vs.status when 'verified' then 0 when 'candidate' then 1 when 'degraded' then 2 else 3 end,
      vs.quality_score desc
    limit 1;
  else
    select
      'series',
      es.provider_episode_id,
      coalesce(nullif(es.file_ext,''),'mp4'),
      s.decrypted_secret::text,
      u.decrypted_secret::text,
      p.decrypted_secret::text
    into route_kind,source_ref,source_format,server_url,provider_username,provider_password
    from lounge_core.episode_sources es
    join vault.decrypted_secrets s on s.id=v_server_secret
    join vault.decrypted_secrets u on u.id=v_username_secret
    join vault.decrypted_secrets p on p.id=v_password_secret
    where es.episode_id=v_canonical_id
      and es.provider_id=v_provider_id
      and es.status<>'rejected'
    order by
      case es.source_role when 'primary' then 0 else 1 end,
      case es.status when 'verified' then 0 when 'degraded' then 1 else 2 end,
      es.quality_score desc
    limit 1;
  end if;

  if source_ref is null then
    raise exception 'no usable source for released item';
  end if;

  return next;
end;
$$;

-- Privileged delivery functions must only be callable by service_role.
revoke execute on function public.lounge_delivery_set_credential(uuid,text,text)
  from public, anon, authenticated;
revoke execute on function public.lounge_delivery_authenticate(text,text,text)
  from public, anon, authenticated;
revoke execute on function public.lounge_delivery_validate_release(uuid)
  from public, anon, authenticated;
revoke execute on function public.lounge_delivery_series_info(uuid,bigint)
  from public, anon, authenticated;
revoke execute on function public.lounge_delivery_epg(uuid,bigint,integer)
  from public, anon, authenticated;
revoke execute on function public.lounge_delivery_resolve_source(uuid,uuid,text,bigint,text)
  from public, anon, authenticated;

grant execute on function public.lounge_delivery_set_credential(uuid,text,text) to service_role;
grant execute on function public.lounge_delivery_authenticate(text,text,text) to service_role;
grant execute on function public.lounge_delivery_validate_release(uuid) to service_role;
grant execute on function public.lounge_delivery_series_info(uuid,bigint) to service_role;
grant execute on function public.lounge_delivery_epg(uuid,bigint,integer) to service_role;
grant execute on function public.lounge_delivery_resolve_source(uuid,uuid,text,bigint,text) to service_role;
