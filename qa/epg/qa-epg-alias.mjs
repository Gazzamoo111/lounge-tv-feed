// QA-only, exact channel-to-existing-EPG aliases.
// Do not assign a region's guide to a different region, or invent EPG for event feeds.
export function qaEpgAlias(group, rawName) {
  if (group !== 'Australia') return null;
  const name=String(rawName||'').toUpperCase()
    .replace(/[ᴿᴬᵂ⁶⁰ᶠᵖˢᴴᴰ]/g,'')
    .replace(/^(?:AU|AUSTRALIA)\s*[:|]\s*/,'')
    .replace(/\s+/g,' ').trim();
  if (name === 'ABC NEWS SYDNEY') return 'live:abc-news-sydney';
  if (/^ABC KIDS(?: NATIONAL)?$/.test(name)) return 'ABC Kids';
  const classic=/^(7FLIX|7MATE|7TWO|10 PEACH)(?: (?:SYDNEY|NATIONAL))?$/i.exec(name);
  if (classic) return ({'7FLIX':'7Flix.au','7MATE':'7Mate.au',
      '7TWO':'7TWO.au','10 PEACH':'10Peach.au'})[classic[1]] || null;
  const normalized=name.replace(/^9NOW\s+/,'');
  const m=/^(9GEM|9GO!|9LIFE|9RUSH)(?:\s+\(([^)]+)\))?$/.exec(normalized);
  if (!m || (m[2] && !['NSW','SYDNEY','NATIONAL'].includes(m[2]))) return null;
  return ({'9GEM':'live:au-9gem','9GO!':'live:au-9go',
    '9LIFE':'live:au-9life','9RUSH':'live:au-9rush'})[m[1]] || null;
}