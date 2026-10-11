-- Admin-configurable tournament rewards, replacing the hardcoded "season" naming convention
-- (`${season}-participants`/`-champion`/`-winner`) that POST /api/admin/tournaments used to
-- derive avatar/flag grants from. A package bundles what 1st/2nd/3rd/participant actually get —
-- any mix of avatar, background and title — so a new event's rewards no longer require a code
-- change, and titles (previously never auto-granted at all) can be included too.
CREATE TABLE reward_packages (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reward_package_items (
  package_id TEXT NOT NULL REFERENCES reward_packages(id) ON DELETE CASCADE,
  place      TEXT NOT NULL CHECK (place IN ('1', '2', '3', 'participant')),
  kind       TEXT NOT NULL CHECK (kind IN ('avatar', 'background', 'title')),
  asset      TEXT NOT NULL,
  PRIMARY KEY (package_id, place, kind)
);
