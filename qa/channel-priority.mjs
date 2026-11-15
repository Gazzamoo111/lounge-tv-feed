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
  // UK/US and sports use the approved country/group identity; ranking never reassigns a feed.
  if(group==='UK TV'){
    const n1=n.replace(/^(?:TV|D\+|PRIME)\s*\|\s*/,'').trim();
    // Regional and time-shift variants stay visible, behind the main service.
    if(/(?:\+\s*[12]|\bPLUS [12]\b)$/.test(n1))return 180+bias;
    if(/\b(?:LONDON|SCOTLAND|WALES|NORTHERN IRELAND|GRANADA|YORKSHIRE|TYNE TEES|WEST COUNTRY|BORDER|ANGLIA|MERIDIAN|MIDLANDS|SOUTH EAST|SOUTH WEST|NORTH EAST|NORTH WEST|REGIONAL|CHANNEL ISLAND|EAST MIDLANDS)\b/.test(n1))return 160+bias;
    const main=[
      [/^(?:BBC ONE|BBC 1)$/,0], [/^(?:BBC TWO|BBC 2)$/,1],
      [/^(?:ITV\s*1|ITV)$/,2], [/^CHANNEL 4$/,3], [/^CHANNEL 5$/,4],
      [/^BBC THREE$/,5], [/^BBC FOUR$/,6],
      [/^ITV\s*2$/,7], [/^ITV\s*3$/,8], [/^ITV\s*4$/,9],
      [/^E4$/,10], [/^MORE\s*4$/,11], [/^FILM\s*4$/,12],
      [/^SKY SHOWCASE$/,20], [/^SKY ATLANTIC$/,21],
      [/^SKY MAX$/,22], [/^SKY WITNESS$/,23], [/^SKY MIX$/,24],
      [/^SKY COMEDY$/,25], [/^DAVE$/,30], [/^GOLD$/,31],
      [/^COMEDY CENTRAL$/,32], [/^W$/,33], [/^5\s*STAR$/,34],
      [/^5\s*USA$/,35], [/^5ACTION$/,36], [/^BBC BRIT$/,38]
    ];
    for(const [re,score] of main)if(re.test(n1))return score+bias;
    if(/^(?:BBC|ITV|CHANNEL [45]|STV|UTV)\b/.test(n1))return 95+bias;
    if(/^BBC RADIO|\bRADIO\b/.test(n1))return 210+bias;
    return 100+bias;
  }
  if(group==='US TV'){
    const n1=n.replace(/^(?:TV|D\+|PRIME)\s*\|\s*/,'').trim();
    // Local affiliates, West/East duplicates and time-shifts are retained after main networks.
    if(/\b(?:A3|LOCAL|NEW YORK|CHICAGO|BOSTON|LOS ANGELES|PHILADELPHIA|HOUSTON|ATLANTA|SEATTLE|DETROIT|BAY AREA|DALLAS|SAN FRANCISCO|MIAMI)\b/.test(n1)
      || /\b(?:W[A-Z]{3}|K[A-Z]{3})\b/.test(n1))return 200+bias;
    if(/\b(?:WEST|EAST|PACIFIC|MOUNTAIN)\b/.test(n1))return 160+bias;
    const main=[
      [/^ABC$/,0], [/^CBS$/,1], [/^NBC$/,2], [/^FOX$/,3], [/^PBS$/,4],
      [/^USA NETWORK$/,10], [/^TNT$/,11], [/^TBS$/,12], [/^FX$/,13], [/^FXX$/,14],
      [/^AMC(?: PLUS)?$/,15], [/^A&E$/,16], [/^BRAVO$/,17], [/^HGTV$/,18],
      [/^FOOD NETWORK$/,19], [/^DISCOVERY(?: CHANNEL)?$/,20],
      [/^HISTORY$/,21], [/^(?:NAT GEO|NATIONAL GEOGRAPHIC)$/,22],
      [/^TLC$/,23], [/^COMEDY CENTRAL$/,24], [/^PARAMOUNT NETWORK$/,25],
      [/^MTV$/,26], [/^BET$/,27], [/^SYFY$/,28], [/^LIFETIME$/,29],
      [/^HALLMARK(?: CHANNEL)?$/,30], [/^E!(?: ENTERTAINMENT)?$/,31],
      [/^FREEFORM$/,32], [/^ION$/,33], [/^ANIMAL PLANET$/,34],
      [/^CARTOON NETWORK$/,35], [/^ADULT SWIM$/,36], [/^BBC AMERICA$/,37]
    ];
    for(const [re,score] of main)if(re.test(n1))return score+bias;
    return 100+bias;
  }
  if(group==='Sports Networks'){
    const n1=n.replace(/^(?:TV|D\+|PRIME)\s*\|\s*/,'').trim();
    if(/^SKY SPORTS? MAIN EVENTS?$/.test(n1))return 0+bias;
    if(/^SKY SPORT [1-9]$/.test(n1))return 3+number(n1,/^SKY SPORT ([1-9])$/)+bias;
    const sky=[
      [/^SKY SPORTS? (?:PL|PREMIER LEAGUE)$/,14],
      [/^SKY SPORTS? FOOTBALL$/,15], [/^SKY SPORTS? CRICKET$/,16],
      [/^SKY SPORTS? F1$/,17], [/^SKY SPORTS? GOLF$/,18],
      [/^SKY SPORTS? TENNIS$/,19], [/^SKY SPORTS? ACTION$/,20],
      [/^SKY SPORTS? ARENA$/,21], [/^SKY SPORTS? NEWS$/,22],
      [/^SKY SPORTS? MIX$/,23], [/^SKY SPORTS? \+$/,24]
    ];
    for(const [re,score] of sky)if(re.test(n1))return score+bias;
    if(/^NFL REDZONE$/.test(n1))return 26+bias;
    if(/^NFL NETWORK$/.test(n1))return 27+bias;
    if(/^NBA TV$/.test(n1))return 28+bias;
    if(/^MLB NETWORK$/.test(n1))return 29+bias;
    if(/^NHL NETWORK$/.test(n1))return 30+bias;
    if(/^ESPN$/.test(n1))return 31+bias;
    if(/^ESPN\s*2$/.test(n1))return 32+bias;
    if(/^ESPNU$/.test(n1))return 33+bias;
    if(/^ESPN(?: NEWS|NEWS)$/.test(n1))return 34+bias;
    if(/^FOX SPORTS? (?:1|2)$/.test(n1))return 35+Number(n1.match(/[12]$/)[0])+bias;
    if(/^TNT SPORTS? [1-5]$/.test(n1))return 39+Number(n1.match(/[1-5]$/)[0])+bias;
    if(/^BEIN SPORTS?(?: [1-9])?$/.test(n1))return 49+(Number(n1.match(/[1-9]$/)?.[0]||0))+bias;
    if(/^EUROSPORT [12]$/.test(n1))return 59+Number(n1.match(/[12]$/)[0])+bias;
    if(/^PREMIER SPORTS? [12]$/.test(n1))return 64+Number(n1.match(/[12]$/)[0])+bias;
    if(/^CBS SPORTS NETWORK$/.test(n1))return 68+bias;
    if(/^GOLF CHANNEL$/.test(n1))return 69+bias;
    if(/^TENNIS CHANNEL$/.test(n1))return 70+bias;
    if(/^UFC$/.test(n1))return 71+bias;
    if(/^DAZN(?: [1-9])?$/.test(n1))return 75+bias;
    // Don't present regional/event-only/alternate feeds above the main networks.
    if(/\b(?:ALTERNATE|OVERFLOW|EVENT ONLY|PLUS|BACKUP)\b/.test(n1))return 180+bias;
    return 100+bias;
  }
  return 100+bias;
}
