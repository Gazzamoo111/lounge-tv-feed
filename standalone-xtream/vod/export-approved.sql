-- One-time read-only export. Run through a private database session from the approved project.
-- The export contains private editorial metadata and IDs. Keep it out of Git and workflow logs.
with release as (
  select id from lounge_delivery.catalogue_releases where state='active'
  order by activated_at desc nulls last limit 1
), requested(kind) as (values ('movie'), ('series')), titles as (
      select requested.kind, i.external_id, v.display_name, t.tmdb_id,
             (t.metadata->>'number_of_episodes') expected_episodes,
             coalesce(src.provider_item_id, bi.provider_item_id) provider_item_id,
             bi.provider_item_id inventory_provider_item_id, v.poster_url, v.backdrop_url,
             t.release_year, t.release_date, t.overview, t.runtime_minutes,
             t.primary_audio_language, t.content_rating,
             t.metadata->>'vote_average' rating, t.metadata->>'vote_count' votes,
             t.metadata->>'popularity' popularity,
             t.metadata->>'type' format,
             t.metadata->'cast' cast,
             bi.first_seen_at, src.file_ext, src.resolution_height, src.video_codec,
             src.audio_codec, src.runtime_verified,
             genre.names genres, collection.name collection, collection.sequence_order collection_order,
             series.latest_episode_added_at
      from release cross join requested
      join lounge_delivery.vod_release_items v on true
      join lounge_delivery.item_ids i
        on i.item_kind=requested.kind::lounge_delivery.item_kind and i.canonical_id=v.title_id
      join lounge_core.titles t on t.id=v.title_id and t.status<>'excluded'
      join lounge_sync.best_inventory_items bi
        on bi.kind=case when requested.kind::text='movie' then 'movies' else 'series' end
        and bi.provider_item_id=(v.editorial->>'primary_provider_item_id')::bigint
        and bi.is_present and bi.is_adult is not true
      left join lateral (
        select array_agg(g.name order by g.name) names
        from lounge_core.title_genres tg
        join lounge_core.genres g on g.id=tg.genre_id
        where tg.title_id=v.title_id
      ) genre on true
      left join lateral (
        select c.name, tc.sequence_order
        from lounge_core.title_collections tc
        join lounge_core.collections c on c.id=tc.collection_id
        where requested.kind::text='movie' and tc.title_id=v.title_id
          and c.tmdb_collection_id is not null
        order by c.sort_order, c.id
        limit 1
      ) collection on true
      left join lateral (
        select s.provider_item_id, s.file_ext, s.resolution_height, s.video_codec, s.audio_codec,
               (s.runtime_verified and s.runtime_health='good') runtime_verified
        from lounge_core.sources s
        join public.providers p on p.id=s.provider_id and p.name='BEST'
        join lounge_sync.best_inventory_items source_inventory on source_inventory.kind='movies'
          and source_inventory.provider_item_id=s.provider_item_id and source_inventory.is_present
          and source_inventory.is_adult is not true
        where requested.kind::text='movie' and s.title_id=v.title_id and s.provider_kind='movies'
          and s.status not in ('rejected','missing','hidden')
          and s.is_cam is not true and s.runtime_health is distinct from 'dead'
        order by
          case when s.runtime_verified and s.runtime_health='good' then 0 else 1 end,
          case when s.provider_item_id=bi.provider_item_id then 0 else 1 end,
          case s.status when 'verified' then 0 when 'candidate' then 1 else 2 end,
          s.quality_score desc nulls last, s.provider_item_id
        limit 1
      ) src on true
      left join lateral (
        select count(*) episode_count,
               max(e.created_at) filter (
                 where e.release_date between current_date - 30 and current_date
               ) latest_episode_added_at
        from lounge_core.seasons se
        join lounge_core.episodes e on e.season_id=se.id and e.status<>'excluded'
        join lounge_delivery.item_ids ei on ei.item_kind='episode' and ei.canonical_id=e.id
        where requested.kind::text='series' and se.series_title_id=v.title_id and se.status<>'excluded'
          and exists (
            select 1 from lounge_core.episode_sources es
            join public.providers p on p.id=es.provider_id and p.name='BEST'
            where es.episode_id=e.id and es.provider_series_item_id=bi.provider_item_id
              and es.status in ('verified','candidate','degraded')
              and es.runtime_health is distinct from 'dead'
          )
      ) series on true
      where v.release_id=release.id and v.content_type=requested.kind and v.admission='keep'
        and (case when requested.kind::text='movie' then src.file_ext is not null else series.episode_count>0 end)
), episodes as (
  select t.external_id series_external_id, i.external_id, x.provider_episode_id provider_item_id,
         coalesce(x.file_ext, 'mkv') file_ext, s.season_number, s.title season_title,
         s.poster_url season_poster, e.episode_number, e.title, e.overview, e.release_date, e.still_url
  from titles t
  join lounge_delivery.item_ids ti on ti.item_kind='series' and ti.external_id=t.external_id
  join lounge_core.seasons s on s.series_title_id=ti.canonical_id and s.status<>'excluded'
  join lounge_core.episodes e on e.season_id=s.id and e.status<>'excluded'
  join lounge_delivery.item_ids i on i.item_kind='episode' and i.canonical_id=e.id
  join lateral (
    select x.provider_episode_id, x.file_ext
    from lounge_core.episode_sources x
    join public.providers p on p.id=x.provider_id and p.name='BEST'
    where x.episode_id=e.id and x.provider_series_item_id=t.inventory_provider_item_id
      and x.status in ('verified','candidate','degraded') and x.runtime_health is distinct from 'dead'
    order by case x.status when 'verified' then 0 when 'candidate' then 1 else 2 end,
             x.runtime_verified desc, x.quality_score desc, x.provider_episode_id
    limit 1
  ) x on true
  where t.kind='series'
)
select json_build_object(
  'movies', (select json_agg(to_jsonb(t)-'kind' order by external_id) from titles t where kind='movie'),
  'series', (select json_agg(to_jsonb(t)-'kind' order by external_id) from titles t where kind='series'),
  'episodes', (select json_agg(e order by external_id) from episodes e)
);
