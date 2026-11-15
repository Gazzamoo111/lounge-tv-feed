/**
 * QA-only XMLTV stream scrubber. Keep the full guide streaming, not in memory.
 * Replace Sky Sport schedules only when fresh canonical fragments are available.
 */
export function cleanXmltvStream(source, canonical = new Map()) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const reader = source.getReader();
  const seen = new Set();
  const presentChannels = new Set();
  let pending = '';
  let done = false;
  const skyIds = new Set(canonical.keys());
  const channelRx = /<channel\b[^>]*\bid=["']([^"']+)["'][^>]*>/gi;
  const programmeStart = /<programme\b/i;
  const programmeEnd = '</programme>';
  const attribute = (tag, name) => {
    const m = new RegExp('\\b' + name + '\\s*=\\s*["\']([^"\']+)["\']', 'i').exec(tag);
    return m?.[1] || '';
  };
  const contentKey = (block) => {
    const header = block.slice(0, block.indexOf('>') + 1);
    const channel = attribute(header, 'channel');
    const start = attribute(header, 'start');
    const stop = attribute(header, 'stop');
    const title = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i.exec(block)?.[1] || '';
    return { channel, key: channel + '\u001f' + start + '\u001f' + stop + '\u001f' + title.trim().toLowerCase() };
  };
  return new ReadableStream({
    async pull(controller) {
      if (done) return;
      const emit = (str) => { if (str) controller.enqueue(encoder.encode(str)); };
      const scanChannels = (txt) => {
        let m;
        while ((m = channelRx.exec(txt)) !== null) presentChannels.add(m[1]);
        channelRx.lastIndex = 0;
      };
      try {
        for (;;) {
          const next = await reader.read();
          pending += decoder.decode(next.value || new Uint8Array(), { stream: !next.done });
          let emitted = false;
          while (true) {
            const match = programmeStart.exec(pending);
            if (!match) {
              if (!next.done && pending.length > 32768) {
                const safe = pending.slice(0, -32);
                scanChannels(safe);
                emit(safe);
                pending = pending.slice(-32);
                emitted = true;
              }
              break;
            }
            const at = match.index;
            if (at > 0) {
              const text = pending.slice(0, at);
              scanChannels(text);
              emit(text);
              pending = pending.slice(at);
              emitted = true;
            }
            const end = pending.indexOf(programmeEnd);
            if (end < 0) break;
            const block = pending.slice(0, end + programmeEnd.length);
            pending = pending.slice(end + programmeEnd.length);
            const { channel, key } = contentKey(block);
            if (skyIds.has(channel)) continue;
            if (seen.has(key)) continue;
            seen.add(key);
            emit(block);
            emitted = true;
          }
          if (next.done) {
            done = true;
            const close = pending.lastIndexOf('</tv>');
            if (close < 0) throw new Error('Incomplete XMLTV root');
            const beforeClose = pending.slice(0, close);
            scanChannels(beforeClose);
            emit(beforeClose);
            for (const [id, fragment] of canonical) {
              if (!presentChannels.has(id)) {
                const ch = /<channel\b[^>]*>[\s\S]*?<\/channel>/i.exec(fragment)?.[0];
                if (ch) emit(ch + '\n');
              }
              const rows = fragment.match(/<programme\b[^>]*>[\s\S]*?<\/programme>/gi) || [];
              for (const row of rows) emit(row + '\n');
            }
            emit(pending.slice(close));
            controller.close();
            reader.releaseLock();
            return;
          }
          if (emitted) return;
        }
      } catch (e) {
        done = true;
        await reader.cancel(e).catch(() => {});
        controller.error(e);
      }
    },
    async cancel(reason) { done = true; await reader.cancel(reason); },
  }, { highWaterMark: 1 });
}