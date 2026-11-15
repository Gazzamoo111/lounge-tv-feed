// QA-only channel ranking. Never changes channel identities, playback or EPG.
const tidy = (value) => String(value || '').toUpperCase()
  .replace(/^(?:NZ|AU|UK|US|CA|EN)\s*[|:]\s*/,'')
  .replace(/[ᴿᴬᵂ⁶⁰ᶠᵖˢᴴᴰ]/g,'')
  .replace(/\b(?:FHD|HD|UHD|4K|1080P|720P|RAW)\b/g,'')
  .replace(/\s+/g,' ').trim();
const isRaw = (row) => String(row.category||'').toUpperCase()==='RAW';
const number = (name,re) => Number(re.exec(name)?.[1] || 0);
export function nuvioChannelPriority(group, row) {
  const n = tidy(row.display_name);
  const bias = isRaw(row) ? 0.25 : 0;
  if(group==='New Zealand'){
    if(/^TVNZ 1$/.test(n)) return 0+bias;
    if(/^TVNZ 2$/.test(n)) return 1+bias;
    if(/^THREE$/.test(n)) return 2+bias;
    if(/^WHAKAATA(?: MĀORI| MAORI)?$/.test(n)) return 3+bias;
    const sky=number(n,/^SKY SPORT ([1-9])$/);
    if(sky)return sky+3+bias; // 4..12
    if(/^(?:TVNZ )?DUKE$/.test(n))return 13+bias;
    if(/^BRAVO$/.test(n))return 14+bias;
    if(/^HGTV$/.test(n))return 15+bias;
    if(/^TE REO$/.test(n))return 16+bias;
    if(/^SKY SPORT (?:SELECT|10 SELECT|POP UP)/.test(n))return 17+bias;
    return 100+bias;
  }
  if(group==='Australia'){
    // Keep region-specific source variants further down, NOT as faux backups.
    const regional=/(?:\b(?:NSW|VIC|QLD|WA|SA|TAS|NT|SYDNEY|MELBOURNE|BRISBANE|PERTH|ADELAIDE|CANBERRA|HOBART|DARWIN|LISMORE|NEWCASTLE|GOLD.COAST)\b)/.test(n);
    if(regional && isRaw(row))return 200+bias;
    const leading = [
      [/^ABC$/,0],[/^(?:SEVEN|CHANNEL 7)$/,1],[/^(?:NINE|CHANNEL 9)$/,2],
      [/^(?:TEN|CHANNEL 10)$/,3],[/^SBS$/,4],
      [/^ABC KIDS(?: NATIONAL)?$/,10],[/^ABC NEWS(?: AUSTRALIA)?$/,11],
      [/^7MATE$/,12],[/^7TWO$/,13],[/^7FLIX$/,14],
      [/^9GEM$/,15],[/^9GO!?$/,16],[/^9LIFE$/,17],[/^9RUSH$/,18],
      [/^10 (?:PEACH|BOLD|SHAKE)$/,19],
      [/^SBS (?:VICELAND|FOOD|WORLD MOVIES)$/,22],
    ];
    for(const [re,score] of leading)if(re.test(n))return score+bias;
    if(/^FOX SPORTS? (?:50[1-7])$/.test(n))return 30+Number(n.match(/50([1-7])/)[1])+bias;
    if(/^FOX CRICKET$/.test(n))return 38+bias;
    if(/^ESPN(?:2)?(?: AUSTRALIA)?$/.test(n))return (/2/.test(n)?41:40)+bias;
    if(/^BEIN SPORTS? [1-9]$/.test(n))return 44+Number(n.match(/\d$/)[0])+bias;
    if(/^SKY NEWS(?: AUSTRALIA)?$/.test(n))return 60+bias;
    if(/^(?:AU: )?9NOW\b|^KAYO\b/.test(n))return 170+bias;
    return 100+bias;
  }
  if(group==='Sports Networks'){
    if(/^SKY SPORT [1-9]$/.test(n))return 5+number(n,/^SKY SPORT ([1-9])$/)+bias;
    if(/^ESPN/.test(n))return 20+bias;
    if(/^TNT SPORT/.test(n))return 30+bias;
    if(/^BEIN SPORT/.test(n))return 40+bias;
    if(/^NBA TV|^NFL NETWORK|^NFL REDZONE|^MLB NETWORK|^NHL NETWORK/.test(n))return 50+bias;
  }
  return 100+bias;
}
