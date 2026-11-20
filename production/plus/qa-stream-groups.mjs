// QA-only routing of existing streaming and themed live-TV inventory.
// Category metadata only; never alters stream identity, EPG, or provider rows.
export function nuvioStreamingGroup(category,subcategory,displayName='') {
  const t=String(category||"").trim().toUpperCase();
  const v=String(subcategory||"").trim().toUpperCase().replace(/\s+/g," ");
  // v28: move only event fixtures and regional/alternate sports feeds into
  // the existing final Category 99. Keep the source identity, EPG and playback
  // unchanged so apps can still discover every sports event automatically.
  const n=String(displayName||"").trim().toUpperCase();
  // Group unscheduled movie banks separately, retaining provider/stream/EPG IDs.
  if(t==="RAW" && /^(?:UK\|\s*SKY STORE|US\|\s*CINEMANIA HOLLYWOOD)$/.test(v))
    return "Movie Streams";
  // Specific event feeds, not permanent sports services, belong in Live Events.
  const event=/\b(?:PPV|EVENTS?|RED BUTTON|MATCH FEEDS?|GAME FEEDS?|ESPN PLAY)\b/.test(n)
    || /\b(?:NBA|NFL|NCAA)\s*•\s*\S/.test(n);
  const sport=t==="SPORTS"||t==="UK SPORT"
    || (t==="RAW" && /^(?:UK|US)\|/.test(v)
      && /\b(?:SPORTS?|ESPN|NBA|NFL|DAZN|TNT|FOX|SKY|WORLD)\b/.test(v));
  if(event && sport) return "Live Events";
  if(t==="SPORTS" && v==="NBA & NFL"
     && (/^(?:NBA|NFL)\s*•\s*\S/.test(n) || /^WNBA ON ION \d+$/.test(n)))
    return "Live Events";
  if(t==="RAW" && /^US\|\s*(?:NFL NETWORK HULU|NBA NETWORK VIP)$/.test(v))
    return "Live Events";
  // Curated 24/7 series should be in the existing 24/7 Series shelf.
  if(t==="ENTERTAINMENT" && v==="CINEMANIA TV SHOWS")return "24/7 Series";
  if(t==="STREAMING" && (v==="PLUTO TV"||v==="TUBI"))return "FAST TV";
  if(t!=="RAW")return null;
  // These are provider-named collections of themed linear channels,
  // not Netflix/Prime-style originals or on-demand libraries.
  if(/^US\|\s*PRIME$/.test(v))return "FAST TV";
  if(/^UK\|\s*PRIME(?:\s|$)/.test(v) && !/^UK\|\s*PRIME VIDEO/.test(v))return "FAST TV";
  if(/^US\|\s*(?:TUBI|PLUTO TV)(?:\s|$)/.test(v))return "FAST TV";
  return null;
}
