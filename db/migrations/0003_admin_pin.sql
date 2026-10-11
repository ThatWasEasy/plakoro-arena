-- A single admin PIN, separate from ADMIN_SECRET (the env-var header used by ops scripts like
-- minting claim codes). This one gates the in-app admin mode (triple-tap the version number),
-- so it lives in the database rather than an env var: changing it shouldn't need a redeploy.
CREATE TABLE admin_pin (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  pin_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
