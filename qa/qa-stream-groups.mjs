// QA-only routing of existing streaming and themed live-TV inventory.
// Category metadata only; never alters stream identity, EPG, or provider rows.
export function nuvioStreamingGroup(category,subcategory) {
  const t=String(category||"").trim().toUpperCase();
  const v=String(subcategory||"").trim().toUpperCase().replace(/\s+/g," ");
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
