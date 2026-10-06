-- Bulletproof: initial tables.
-- Everything lives in the "bulletproof" schema. Nothing outside it is created, altered or dropped.
-- The runner creates the schema itself before applying this file.

-- Records are stored exactly as the client holds them (JSONB), plus bookkeeping columns:
--   updated_at : the client's own timestamp; last-write-wins is decided on this.
--   synced_at  : when the server accepted the record; the pull cursor ("since") uses this, so a record
--                edited offline hours ago still reaches other devices that already pulled.

CREATE TABLE bulletproof.settings (
  id         text        PRIMARY KEY,           -- the client keeps a single record with a fixed id
  data       jsonb       NOT NULL,
  updated_at timestamptz NOT NULL,
  synced_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bulletproof.sessions (
  id         uuid        PRIMARY KEY,
  data       jsonb       NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted    boolean     NOT NULL DEFAULT false,
  synced_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bulletproof.decisions (
  id         uuid        PRIMARY KEY,
  data       jsonb       NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted    boolean     NOT NULL DEFAULT false,
  synced_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_synced_at_idx  ON bulletproof.sessions  (synced_at);
CREATE INDEX decisions_synced_at_idx ON bulletproof.decisions (synced_at);
CREATE INDEX settings_synced_at_idx  ON bulletproof.settings  (synced_at);
