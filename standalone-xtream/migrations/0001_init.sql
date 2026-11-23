CREATE TABLE IF NOT EXISTS accounts (
 username TEXT PRIMARY KEY,
 auth_digest TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 expires_at INTEGER NOT NULL,
 max_connections INTEGER NOT NULL DEFAULT 1 CHECK(max_connections>0),
 provider_iv TEXT NOT NULL,
 provider_cipher TEXT NOT NULL,
 created_at INTEGER NOT NULL DEFAULT(unixepoch()),
 updated_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE INDEX IF NOT EXISTS accounts_active_expiry ON accounts(enabled,expires_at);
CREATE TABLE IF NOT EXISTS stream_ids (
 stream_id INTEGER PRIMARY KEY,
 category_id INTEGER NOT NULL,
 epg_id TEXT NOT NULL DEFAULT ''
);
