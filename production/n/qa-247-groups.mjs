// QA-only presentation grouping for 24/7 sources.
// Never changes provider IDs, playback bindings, EPG assignments or source inventory.
export function nuvio247Group(category, subcategory) {
  const c=String(category||"").trim().toUpperCase();
  const v=String(subcategory||"").trim().toUpperCase();
  if(c!=="RAW" && c!=="24/7") return null;
  if(c==="RAW" && !(/24\/7|CINEMANIA TV SHOWS|NETFLIX ON AIR/.test(v))) return null;
  if(/ONEPLAY/.test(v)) return "24/7 OnePlay";
  if(/CARTOON|KIDS|FAMILY|DISNEY\+/.test(v)) return "24/7 Kids & Cartoons";
  if(/CINEMANIA TV SHOWS|(?:CLASSIC\s+)?SHOWS(?:\s+VIP)?(?:\s|$)/.test(v)) return "24/7 Series";
  if(/COMEDY/.test(v)) return "24/7 Comedy";
  if(/DRAMA|CRIME|ACTION\s*(?:&|AND)\s*ADVENTURE/.test(v)) return "24/7 Drama & Crime";
  if(/REALITY/.test(v)) return "24/7 Reality";
  if(/MOVIES\s*\/\s*ACTORS/.test(v)) return "24/7 Movies";
  if(/NETFLIX ON AIR|PRIME VIDEO/.test(v)) return "24/7 Streaming";
  return "24/7 Movies & Series";
}
