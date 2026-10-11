-- Schema from docs/data-model.md. If you change a table here, update that doc too — it is the
-- design record (what each column is for, the decisions behind it); this file is just the DDL.

CREATE TABLE players (
  code        TEXT PRIMARY KEY,          -- P000001，主辦發的編號，大寫
  name        TEXT NOT NULL,             -- 後備顯示名
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 玩家自己能改的，就這三欄。其他欄位一律拒絕來自玩家的寫入。
  avatar      TEXT,
  background  TEXT,
  title_id    TEXT,

  -- 衍生欄位：只由 recompute 覆寫，任何手動修改都會在下次上傳時被蓋掉
  --
  -- 線下與線上的勝率分開統計。線上隨手打輸幾場不該拉低實體賽事的戰績，所以兩套數字
  -- 永遠不混在一起。獎牌、名次、參賽場數不加前綴 —— 線上沒有對應概念。
  events          INTEGER NOT NULL DEFAULT 0,
  ranked          INTEGER NOT NULL DEFAULT 0,
  tour_wins       INTEGER NOT NULL DEFAULT 0,
  tour_losses     INTEGER NOT NULL DEFAULT 0,
  tour_draws      INTEGER NOT NULL DEFAULT 0,
  tour_byes       INTEGER NOT NULL DEFAULT 0,
  tour_win_rate   REAL,
  online_wins     INTEGER NOT NULL DEFAULT 0,
  online_losses   INTEGER NOT NULL DEFAULT 0,
  online_draws    INTEGER NOT NULL DEFAULT 0,
  online_win_rate REAL,
  gold            INTEGER NOT NULL DEFAULT 0,
  silver          INTEGER NOT NULL DEFAULT 0,
  bronze          INTEGER NOT NULL DEFAULT 0,
  podiums         INTEGER NOT NULL DEFAULT 0,
  best            INTEGER,
  stats_at        TIMESTAMPTZ
);

CREATE INDEX idx_players_tour_win_rate ON players(tour_win_rate DESC NULLS LAST);

CREATE TABLE tournaments (
  id           TEXT PRIMARY KEY,         -- 賽事唯一編號
  name         TEXT NOT NULL,
  date         DATE NOT NULL,
  venue        TEXT,
  total_rounds INTEGER,                  -- 瑞士制預定輪數
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by  TEXT
);

CREATE INDEX idx_tournaments_date ON tournaments(date DESC);

CREATE TABLE tournament_players (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  code          TEXT NOT NULL REFERENCES players(code),
  place         INTEGER,                 -- 最終名次，只在賽事完整打完後填
  PRIMARY KEY (tournament_id, code)
);

CREATE INDEX idx_tp_code ON tournament_players(code);

CREATE TABLE matches (
  id            TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round_number  INTEGER NOT NULL,
  p1            TEXT NOT NULL REFERENCES players(code),
  p2            TEXT          REFERENCES players(code),   -- NULL = 輪空
  result        TEXT CHECK (result IN ('p1','p2','draw')) -- NULL = 還沒打
);

CREATE INDEX idx_matches_p1 ON matches(p1);
CREATE INDEX idx_matches_p2 ON matches(p2);

CREATE TABLE online_matches (
  id        TEXT PRIMARY KEY,
  p1        TEXT NOT NULL REFERENCES players(code),
  p2        TEXT NOT NULL REFERENCES players(code),
  result    TEXT NOT NULL CHECK (result IN ('p1','p2','draw')),
  room_id   TEXT,                        -- 只為了查問題，房間本身不進資料庫
  played_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_online_p1 ON online_matches(p1);
CREATE INDEX idx_online_p2 ON online_matches(p2);

CREATE TABLE player_unlocks (
  code  TEXT NOT NULL REFERENCES players(code) ON DELETE CASCADE,
  kind  TEXT NOT NULL CHECK (kind IN ('avatar','background','title')),
  asset TEXT NOT NULL,
  src   TEXT NOT NULL,                   -- 'auto:m1-place1' | 'manual:ADMIN'
  at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (code, kind, asset)
);

CREATE INDEX idx_unlocks_asset ON player_unlocks(asset);   -- 這個素材發給過誰

CREATE TABLE auth_identities (
  id         TEXT PRIMARY KEY,
  provider   TEXT NOT NULL,              -- 'claim' | 'line' | 'google' | 'email'
  subject    TEXT NOT NULL,              -- provider 給的唯一 id
  code       TEXT REFERENCES players(code),  -- 認領的選手，NULL = 尚未認領
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, subject)
);

CREATE TABLE claim_codes (
  code       TEXT PRIMARY KEY,           -- 一次性認領碼，例如 7KQ2-M4XP
  player     TEXT NOT NULL REFERENCES players(code) ON DELETE CASCADE,
  used_at    TIMESTAMPTZ,                -- NULL = 還沒用
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The single definition of a player's stats — see docs/data-model.md「player_stats view」.
-- `players` carries these same fields as a cache; this view is what rebuild/reconcile reads.
CREATE VIEW player_stats AS
WITH tour AS (
  SELECT p.code,
         COUNT(*) FILTER (WHERE m.id IS NOT NULL AND m.p2 IS NOT NULL AND (
                    (m.p1 = p.code AND m.result = 'p1') OR
                    (m.p2 = p.code AND m.result = 'p2')))          AS tour_wins,
         COUNT(*) FILTER (WHERE m.id IS NOT NULL AND m.p2 IS NOT NULL AND (
                    (m.p1 = p.code AND m.result = 'p2') OR
                    (m.p2 = p.code AND m.result = 'p1')))          AS tour_losses,
         COUNT(*) FILTER (WHERE m.result = 'draw')                 AS tour_draws,
         COUNT(*) FILTER (WHERE m.id IS NOT NULL AND m.p2 IS NULL)  AS tour_byes
  FROM players p
  LEFT JOIN matches m ON m.p1 = p.code OR m.p2 = p.code
  GROUP BY p.code
),
online AS (
  SELECT p.code,
         COUNT(*) FILTER (WHERE o.id IS NOT NULL AND (
                    (o.p1 = p.code AND o.result = 'p1') OR
                    (o.p2 = p.code AND o.result = 'p2')))          AS online_wins,
         COUNT(*) FILTER (WHERE o.id IS NOT NULL AND (
                    (o.p1 = p.code AND o.result = 'p2') OR
                    (o.p2 = p.code AND o.result = 'p1')))          AS online_losses,
         COUNT(*) FILTER (WHERE o.result = 'draw')                 AS online_draws
  FROM players p
  LEFT JOIN online_matches o ON o.p1 = p.code OR o.p2 = p.code
  GROUP BY p.code
),
event_stats AS (
  SELECT p.code,
         COUNT(tp.tournament_id)                     AS events,
         COUNT(tp.place)                             AS ranked,
         COUNT(*) FILTER (WHERE tp.place = 1)        AS gold,
         COUNT(*) FILTER (WHERE tp.place = 2)        AS silver,
         COUNT(*) FILTER (WHERE tp.place = 3)        AS bronze,
         MIN(tp.place)                               AS best
  FROM players p
  LEFT JOIN tournament_players tp ON tp.code = p.code
  GROUP BY p.code
)
SELECT p.code,
       e.events, e.ranked, e.gold, e.silver, e.bronze, e.best,
       e.gold + e.silver + e.bronze AS podiums,
       t.tour_wins, t.tour_losses, t.tour_draws, t.tour_byes,
       CASE WHEN (t.tour_wins + t.tour_losses + t.tour_draws) > 0
            THEN t.tour_wins::real / (t.tour_wins + t.tour_losses + t.tour_draws)
            ELSE NULL END AS tour_win_rate,
       o.online_wins, o.online_losses, o.online_draws,
       CASE WHEN (o.online_wins + o.online_losses + o.online_draws) > 0
            THEN o.online_wins::real / (o.online_wins + o.online_losses + o.online_draws)
            ELSE NULL END AS online_win_rate
FROM players p
JOIN event_stats e ON e.code = p.code
JOIN tour       t ON t.code = p.code
JOIN online     o ON o.code = p.code;
