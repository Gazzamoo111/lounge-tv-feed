// QA-only Australian guide guard. Never replace a channel with unrelated EPG.
// Deliberately narrow: other Australian services and all provider bindings untouched.
export function qaAuWrongGuide(row) {
  return String(row?.category || '').trim().toLowerCase() === 'australia'
    && String(row?.display_name || '').trim().toUpperCase() === 'TEN'
    && String(row?.epg_id || '').trim().toLowerCase() === '10bold.au';
}
