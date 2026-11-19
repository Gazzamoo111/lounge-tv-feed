// QA-only exact channel-to-EXISTING EPG aliases. The n gateway accepts an
// alias only if lounge_delivery.shared_epg_channels has a current guide.
// Never infer listings from unrelated regions, event banks, or names alone.
export function qaEpgAlias(group, rawName) {
  const name=String(rawName||'').toUpperCase()
    .replace(/[ᴿᴬᵂ⁶⁰ᶠᵖˢᴴᴰ]/g,'')
    .replace(/^(?:NZ|AU|AUSTRALIA)\s*[:|]\s*/,'')
    .replace(/\s+/g,' ').trim();
  if(group==='New Zealand'||group==='Sports Networks'){
    // Exact NZ Sky Sport alternatives. The normal curated SKY SPORT 1–9
    // already resolve through effectiveLiveEpgId(), but RAW FHD / HD BACKUP
    // / the SKY SPORTS NZ alternative catalogue need explicit associations.
    const nz=/^SKY SPORT ([1-9])(?: (?:FHD|HD|HD BACKUP))?$/.exec(name)
      || /^SKY SPORTS NZ ([1-9])$/.exec(name);
    if(nz)return 'SkySport'+nz[1]+'.nz';
    if(name==='SKY SPORTS NZ PL')return 'SkySport8.nz';
    if(group==='Sports Networks'){
      if(name==='ESPNU')return 'live:espnu';
      if(name==='ESPN8: THE OCHO')return 'live:espn8-the-ocho';
      if(name==='SKY SPORTS TENNIS')return 'live:sky-sports-tennis';
    }
  }
  if (group !== 'Australia') return null;
  if (name === 'ABC NEWS SYDNEY') return 'live:abc-news-sydney';
  if (/^ABC KIDS(?: NATIONAL)?$/.test(name)) return 'ABC Kids';
  if (name === 'SEVEN'||name==='CHANNEL 7 HD')return 'live:au-seven';
  const fox=/^FOX SPORTS (501|502|504|507)(?: (?:HD|FHD))?$/.exec(name);
  if(fox)return 'live:au-fox-sports-'+fox[1];
  const classic=/^(7FLIX|7MATE|7TWO|10 PEACH)(?: (?:SYDNEY|NATIONAL))?$/.exec(name);
  if(classic)return ({'7FLIX':'7Flix.au','7MATE':'7Mate.au',
    '7TWO':'7TWO.au','10 PEACH':'10Peach.au'})[classic[1]]||null;
  const normalized=name.replace(/^9NOW\s+/,'');
  const nine=/^(9GEM|9GO!|9LIFE|9RUSH)(?:\s+\(([^)]+)\))?$/.exec(normalized);
  if(!nine||(nine[2]&&!['NSW','SYDNEY','NATIONAL'].includes(nine[2])))return null;
  return ({'9GEM':'live:au-9gem','9GO!':'live:au-9go',
    '9LIFE':'live:au-9life','9RUSH':'live:au-9rush'})[nine[1]]||null;
}

// Exact BEST source and legacy guide ID, verified against the canonical XMLTV.
// Resolve at output time so the catalogue's guide-based sort uses the same inputs.
const verifiedLiveEpgIds = new Map([
  [30493, ["SkySportsPremiereLeague.uk", "uk.Sky Sports Premier League"]],
  [45474, ["US-The Tennis Channel", "TennisChannel.us"]],
  [45532, ["US| NBC GOLF", "GolfChannel.us"]],
  [90958, ["ESPNU.us", "live:espnu"]],
  [45596, ["US| CINEMAX MOREMAX HD", "MoreMax.us"]],
  [45498, ["StarzInBlack.us", "live:starz-in-black"]],
  [30556, ["CartoonNetwork.uk", "uk.Cartoon Network"]],
]);

export function verifiedLiveEpgAlias(row) {
  if (row.provider_name !== "BEST") return null;
  const match = verifiedLiveEpgIds.get(Number(row.provider_stream_id));
  return match && match[0] === row.epg_id ? match[1] : null;
}

export function tenPerthGuideId(row) {
  return row.provider_name === "BEST" && Number(row.provider_stream_id) === 1789688
    && row.canonical_key === "live:au-ten" ? row.canonical_key : null;
}
