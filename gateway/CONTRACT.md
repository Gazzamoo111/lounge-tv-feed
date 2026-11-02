# Universal delivery contract

Release: `lounge-universal-staging-v1`

Expected locked counts:
- Live: 2,391
- Movies: 5,142
- Series: 3,395

Customer surfaces:
- Live
- Movies
- Series
- Streaming
- Kids & Family

VOD rule:
- KEEP only
- HOLD hidden
- DROP hidden

Provider sync rule:
- may update source availability and source metadata
- may not alter release membership, display names, categories or ordering

Xtream actions implemented:
- authentication
- get_live_categories
- get_live_streams
- get_vod_categories
- get_vod_streams
- get_vod_info
- get_series_categories
- get_series
- get_series_info
- get_short_epg
- get_simple_data_table

Additional:
- M3U via /get.php
- XMLTV via /xmltv.php
- paginated native catalogue via /api/v1/catalogue
- Live/Movie/Series playback proxy routes

Known out of scope:
- TVNZ redesign
- production cutover
- customer migration
