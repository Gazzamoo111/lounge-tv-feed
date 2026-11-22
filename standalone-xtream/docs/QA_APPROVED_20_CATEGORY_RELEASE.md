# Lounge TV | Issue #23 | Restored approved 20-category QA order

**Status:** PRIVATE R2 seed prepared and integrity-verified. **Not deployed** to `xtream-qa.loungetv.nz`. Production remains untouched.

## Source of the decision
The owner explicitly approved the 21-group proposed layout on **19 November 2026**, then instructed removal of **Asia Sports**, leaving **20 categories in this exact order**. The subsequent 25-category curation was rejected as a wrong order. This release returns to the approved design, rather than inventing a new navigation.

| # | Display category | QA visible streams |
|---:|---|---:|
| 1 | 🇳🇿 New Zealand | 23 |
| 2 | 🇦🇺 Australia | 77 |
| 3 | 🇬🇧 UK TV & Entertainment | 213 |
| 4 | 🇬🇧 UK Sports | 296 |
| 5 | 🇺🇸 US TV & Entertainment | 1,346 |
| 6 | 🇺🇸 US Sports | 221 |
| 7 | 🌍 Sports Networks | 216 |
| 8 | 📺 Streaming Services | 614 |
| 9 | 🎬 Movie Channels | 358 |
| 10 | 🧸 Kids and Family | 82 |
| 11 | 🔎 Documentaries and Lifestyle | 285 |
| 12 | 📡 FAST TV | 592 |
| 13 | 🎵 Music | 118 |
| 14 | 🍿 24/7 Movies | 436 |
| 15 | 📺 24/7 Series | 801 |
| 16 | 😄 24/7 Comedy & Reality | 655 |
| 17 | 🎭 24/7 Drama & Crime | 673 |
| 18 | 📺 24/7 Streaming & OnePlay | 367 |
| 19 | 🧩 24/7 Kids & Cartoons | 287 |
| 20 | 🏆 Live Events | 6,709 |

**Original inventory:** 14,717 IDs across 37 groups. **New visible catalogue:** 14,369. The remaining **348 decorative `##...` and `INFO` entries** are excluded from public channel browsing but preserved in the private audit; none has an EPG ID. The complete original private master and D1 stream IDs remain unchanged.

**Source distinctions:** UK/US general entertainment and news are classified by original channel prefix where available. Sports network channels are separated from regional UK and US sports, FAST programmes from Streaming Services, and OnePlay from general kids where possible. All content keeps the original name, icon, numeric playback ID and EPG ID. Original XMLTV and short EPG files are unchanged byte-for-byte. Only display groups, category IDs and channel numbering/order change.

**Important:** The approved source file currently contains only NZ Sky Sport (23 items), not full general NZ Freeview channels. The category title `New Zealand` is correct under the approved sequence, but restoring TVNZ/other broadcast channels requires a verified source addition. This package does not invent missing streams.

## Integrity and release

- Private deliverable: `LoungeTV_QA_Approved_20_Categories_Private_20261123.zip`.
- ZIP SHA-256: `925708e567d723e12ccf296c136d463dddb8104daf6b377a51b6b50ecd440b16`.
- 20 categories, 14,369 visible, 348 hidden, **3,272 nonempty EPG IDs preserved**.
- All original 14,717 numeric stream IDs remain present across visible plus hidden inventories and in unchanged D1 seed.
- Original XMLTV `seed/epg/guide.xml.gz`, every `seed/epg/short/*.json`, original `seed/stream_ids_seed.sql` unchanged.
- All manifest SHA-256 checks pass, including corrected `seed/manifest.json`, which records 20 categories (fixed missing-manifest defect in previous private 25-category prototype).
- The curation generator and assertions are in `scripts/curate_qa_catalog.py` and `tests/test_curation.py` on the draft PR #24 branch.

## Work-only QA release procedure

1. Confirm this private ZIP hash and the current live R2 `current.json` release pointer. Do not publish the ZIP, raw private guide, or credentials to public GitHub.
2. Upload the private `seed/catalog/` and `seed/epg/` files as a **new immutable prefix** such as `releases/v20261123-approved20/` to the existing private QA R2 bucket.
3. Do not alter existing D1 account records, stream entitlements, or production routes. The source D1 seed is identical to the previous version.
4. Verify object counts/integrity and preserve any independent guide `epg_release` pointer before changing only the QA release pointer using an ETag-conditional update.
5. With the private QA login: `get_live_categories` must return 20 in exact order; `get_live_streams` 14,369 without placeholder banners; `get.php` 14,369 lines; guide identical and working.
6. On Nuvio, refresh only the **QA** Xtream connection and inspect categories/INFO and programmes. If category IDs are cached, remove and re-add only QA.
7. Rollback: restore the entire previous `current.json` pointer exactly, preserving any separate guide-release reference.

**The earlier `QA_25_CATEGORY_RELEASE.md` is superseded and MUST NOT be used to deploy category order.**

No changes to `connect.loungetv.nz`, Supabase, or any customer account are authorised by this presentation change. Playback remains a separate QA acceptance issue.
