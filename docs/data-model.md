# 資料模型規劃

把選手資料與賽事紀錄從 localStorage 搬上資料庫的設計。**尚未實作** —— 這份文件是動工前要先定下來的契約。

目前（2026-10）的實際狀態：

| 資料 | 位置 |
|---|---|
| 賽事紀錄 | `localStorage['plakoro_tournaments_v1']` |
| 選手外觀 | `src/data/nameplates.json`（寫死的假資料） |
| 本機身份 | `localStorage['plakoro_current_player_v1']` |
| 戰績數字 | 不存，由 `aggregatePlayers()` 即時算 |

要搬的理由不是「徽章需要資料庫」，而是**紀錄只活在主辦的一台瀏覽器裡**：清掉瀏覽資料就全沒了，而且選手看不到自己的成績。

## 兩種比賽

這份文件涵蓋兩種來源的對戰，它們的紀錄分開存、勝率分開算：

| | 線下比賽 | 線上對戰 |
|---|---|---|
| 是什麼 | 實體聚會，賽程編排／桌次表／名牌 | 開房間，玩家自由進入 |
| 現況 | localStorage | `trystero` 走 P2P |
| 要變成 | 上資料庫 | 常駐房間 server，不再 P2P |
| 對局表 | `matches` | `online_matches` |
| 勝率欄位 | `tour_*` | `online_*` |
| 獎牌／名次 | 有 | 無 |

房間本身（誰在房裡、開打了沒）是伺服器記憶體裡的暫時狀態，不進資料庫。

---

## 核心原則

### 1. DB 只存 id，內容留在 repo

圖檔由 `src/data/nameplateAssets.js` 用 `import.meta.glob` 打包進前端，稱號文案在 `src/data/titleCatalogue.js`。資料庫存的是 `'2026-9-champion'`、`'m1-champion'` 這種字串，不存任何圖片或文案。

好處是 API 回應極小（一個選手不到 500 bytes），而且換圖、改文案不用動資料庫。

### 2. 真實來源與衍生資料分開

| 類型 | 表／欄位 | 壞掉怎麼辦 |
|---|---|---|
| **真實來源** | `tournaments` / `matches` / `player_unlocks` | 救不回來，要備份 |
| **衍生快取** | `players` 上的 stats 欄位 | 重跑一次 UPDATE |

戰績數字全部能從對局重算。**但手動授予的稱號不行** —— 「我在現場看到他剩 120 血贏，所以發了〈怎麼結束了？〉」這件事不存在於任何其他地方。

### 3. 衍生欄位一律重算覆寫，永不累加

不要「讀出目前勝率 → 加上這場 → 寫回」。那個做法在三種情況會錯且不會自己修正：改掉舊賽事的錯誤結果、刪除賽事、同一場上傳兩次。

實測全重算的成本（16 人 4 輪瑞士制）：

```
   場數   JSON大小   aggregate
     12      42 KB      2.0 ms
     36     127 KB      0.8 ms
    120     429 KB      1.4 ms
    600    2196 KB      7.1 ms
```

一個月寫一次、花 1.4ms，不值得為了省這個去寫增量更新的回退邏輯。

---

## 資料表

SQL 為 PostgreSQL（選型理由見〈決策紀錄〉）。

### `players`

一個選手一列。身份、玩家自選的外觀、以及**衍生的戰績欄位**。

```sql
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
```

戰績放在這張表而不是獨立一張，因為一個選手**只有一組**戰績（1:1）。查選手資料一次查詢拿完，不用 join。

### `tournaments`

```sql
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
```

`total_rounds` 必須存。少了它，匯入的瑞士制賽事會永遠判定為「未完成」，連帶壞掉冠軍判定、產生下一輪、以及獎牌計算。

### `tournament_players`

賽事 ↔ 選手編號。

```sql
CREATE TABLE tournament_players (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  code          TEXT NOT NULL REFERENCES players(code),
  place         INTEGER,                 -- 最終名次，只在賽事完整打完後填
  PRIMARY KEY (tournament_id, code)
);

CREATE INDEX idx_tp_code ON tournament_players(code);
```

`place` 為 NULL 代表賽事還沒打完。名次只有在 `isFullyPlayed()` 成立時才有意義 —— 第一輪就有排名，但那個領先者下午可能被翻盤。

### `matches`

```sql
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
```

`ON DELETE CASCADE`：刪一場賽事，它的對局和參賽名單自動消失，不留孤兒資料。

### `online_matches`

線上對戰的結果。與 `matches` 分開，因為兩者形狀本來就不同 —— 線上沒有輪空、沒有輪數、不屬於任何賽事。

```sql
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
```

兩邊都是 `NOT NULL` 外鍵，因為**線上對戰一律要求登入**。訪客進不了房間，所以不會有寫不進去的對局。

房間本身（誰在房裡、開打了沒）是常駐行程記憶體裡的狀態，打完就沒了，不進資料庫。

### `player_unlocks`

擁有哪些頭像／旗幟／稱號。**只存賺到的**，公開素材（三隻吉祥物、`*-default`）不寫進來。

```sql
CREATE TABLE player_unlocks (
  code  TEXT NOT NULL REFERENCES players(code) ON DELETE CASCADE,
  kind  TEXT NOT NULL CHECK (kind IN ('avatar','background','title')),
  asset TEXT NOT NULL,
  src   TEXT NOT NULL,                   -- 'auto:m1-place1' | 'manual:ADMIN'
  at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (code, kind, asset)
);

CREATE INDEX idx_unlocks_asset ON player_unlocks(asset);   -- 這個素材發給過誰
```

獨立一張表而不是 `players` 上的 JSON 欄位，原因：

- 一個選手有**很多個**解鎖，數量會長（1:N）
- 跨選手查詢（「這面旗發給過誰」「幾個人拿到九死一生」）在 JSON 欄位裡只能全表掃描 + 逐筆 parse
- JSON 陣列新增一筆是 read-modify-write，並行授予會覆蓋彼此。獨立資料列的兩個 INSERT 都會成功
- `src` 和 `at` 是掛在**單一筆解鎖**上的，不是掛在選手上

公開素材不入表，是為了避免新增一張免費頭像時要對全部選手各 INSERT 一筆。改成在前端目錄標記 public 即可。

範例資料（Ray 打完 Meetup#1 拿冠軍）：

```
code     | kind       | asset               | src             | at
---------+------------+---------------------+-----------------+------------
P000001  | avatar     | 2026-9-participants | auto:m1-attend  | 2026-09-14
P000001  | avatar     | 2026-9-champion     | auto:m1-place1  | 2026-09-14
P000001  | background | 2026-9-participants | auto:m1-attend  | 2026-09-14
P000001  | background | 2026-9-champion     | auto:m1-place1  | 2026-09-14
P000001  | title      | m1-attendee         | auto:m1-attend  | 2026-09-14
P000001  | title      | m1-champion         | auto:m1-place1  | 2026-09-14
```

### `auth_identities`

登入身份。**與 `players` 分開**，因為現有的八位選手有編號但還沒有帳號；帳號上線後他們要能「認領」既有紀錄，而不是註冊時拿到一個新編號、把歷史丟在舊編號上。

```sql
CREATE TABLE auth_identities (
  id         TEXT PRIMARY KEY,
  provider   TEXT NOT NULL,              -- 'claim' | 'line' | 'google' | 'email'
  subject    TEXT NOT NULL,              -- provider 給的唯一 id
  code       TEXT REFERENCES players(code),  -- 認領的選手，NULL = 尚未認領
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, subject)
);
```

同一個 `players` 列可以同時掛多個身份，所以之後加 LINE Login 不影響既有使用者。

### `claim_codes`

> **登入與註冊的流程尚未定案，之後要另外討論。** 以下是目前傾向的方向，不是結論。
> 無論最後選什麼，`auth_identities` 的形狀都能容納（多一個 `provider` 值而已），所以
> 這件事不會回頭改到其他表。

第一階段的登入方式，不接任何第三方。

```sql
CREATE TABLE claim_codes (
  code       TEXT PRIMARY KEY,           -- 一次性認領碼，例如 7KQ2-M4XP
  player     TEXT NOT NULL REFERENCES players(code) ON DELETE CASCADE,
  used_at    TIMESTAMPTZ,                -- NULL = 還沒用
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

流程：主辦產碼 → LINE 私訊給選手 → 選手輸入「編號 + 認領碼」→ 建 `auth_identities(provider='claim')` → 發簽章 token 存 localStorage。

這裡唯一要保護的動作是「玩家改自己的外觀」。沒有金流、沒有個資、沒有破壞性操作，被冒用的最壞後果是有人把別人的旗子換掉 —— 為此接 OAuth provider 不成比例。人多到發碼變負擔時再加 LINE Login。

---

## `player_stats` view

戰績的**唯一定義**。`players` 上的欄位只是它的快取。

```sql
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
```

每個 CTE 分開算再 join，不是一個查詢直接 join 多張表 —— 後者會產生笛卡兒積（每位選手的對局數 × 參賽場數 × 線上場數），數字全部錯掉。

### 輪空的處理

**輪空不計入勝場，也不計入勝率分母。**

這一點 codebase 裡有兩套刻意不同的規則，搬上線時務必對齊：

| 函式 | 用途 | 輪空 |
|---|---|---|
| `computeStandings()` | 當場排名 | **算一勝**（瑞士制要給積分） |
| `aggregatePlayers()` | 跨賽事戰績 | **不算勝**，只記 `byes` |

`playerBadges.js` 的註解寫明理由：*"A bye is a win in the standings but says nothing about the player, and counting it would quietly inflate everyone who ever sat out an odd round."*

view 跟隨 `aggregatePlayers()`。

另外 `aggregatePlayers()` 是**從對局直接數**而非從排名數，所以進行中的賽事也會貢獻已打完的場次 —— view 的行為一致。

---

## 寫入流程

```
主辦按「上傳賽事」
      ↓
POST /api/tournaments
      ↓  （單一 transaction）
  ├─ 1. upsert tournaments / tournament_players / matches
  ├─ 2. 對未知編號建立 players 列
  ├─ 3. 授予解鎖（INSERT ... ON CONFLICT DO NOTHING）
  └─ 4. 重算 stats（整批覆寫）
```

### 4. 重算

```sql
UPDATE players SET
  events          = s.events,          ranked        = s.ranked,
  tour_wins       = s.tour_wins,       tour_losses   = s.tour_losses,
  tour_draws      = s.tour_draws,      tour_byes     = s.tour_byes,
  tour_win_rate   = s.tour_win_rate,
  online_wins     = s.online_wins,     online_losses = s.online_losses,
  online_draws    = s.online_draws,
  online_win_rate = s.online_win_rate,
  gold            = s.gold,            silver        = s.silver,
  bronze          = s.bronze,          podiums       = s.podiums,
  best            = s.best,
  stats_at        = now()
FROM player_stats s
WHERE s.code = players.code;
```

線上對戰結束時也跑同一段 —— 它一次算完兩邊，不需要為線上另外寫一套。

**整批覆寫，不帶 WHERE 篩選特定選手。** 全表更新的成本遠低於維護「哪些人受這次上傳影響」的邏輯。

想確認有沒有漂掉就比對 `players` 和 `player_stats`；修復就是再跑一次這段。另外開一個 `POST /api/records/rebuild` 做手動重建。

### 3. 授予

avatar／background／title 三種都要發，不是只有外觀兩種 —— 下面範例對齊前面「範例資料」那段：每個參賽者先拿 `participants` 這一層，`place = 1` 的人再疊加 `champion` 這一層。title 的 asset id（`m1-champion`）跟 avatar/background 的 asset id（`2026-9-champion`）命名方式不同，所以不能共用同一個字面值，拆成兩段 `UNION ALL`：

```sql
-- 每個參賽者：出席外觀 + 出席稱號
INSERT INTO player_unlocks (code, kind, asset, src)
SELECT tp.code, 'avatar',      '2026-9-participants', 'auto:m1-attend' FROM tournament_players tp WHERE tp.tournament_id = $1
UNION ALL
SELECT tp.code, 'background',  '2026-9-participants', 'auto:m1-attend' FROM tournament_players tp WHERE tp.tournament_id = $1
UNION ALL
SELECT tp.code, 'title',       'm1-attendee',         'auto:m1-attend' FROM tournament_players tp WHERE tp.tournament_id = $1
ON CONFLICT (code, kind, asset) DO NOTHING;

-- 冠軍：疊加冠軍外觀 + 冠軍稱號
INSERT INTO player_unlocks (code, kind, asset, src)
SELECT tp.code, 'avatar',      '2026-9-champion', 'auto:m1-place1' FROM tournament_players tp WHERE tp.tournament_id = $1 AND tp.place = 1
UNION ALL
SELECT tp.code, 'background',  '2026-9-champion', 'auto:m1-place1' FROM tournament_players tp WHERE tp.tournament_id = $1 AND tp.place = 1
UNION ALL
SELECT tp.code, 'title',       'm1-champion',     'auto:m1-place1' FROM tournament_players tp WHERE tp.tournament_id = $1 AND tp.place = 1
ON CONFLICT (code, kind, asset) DO NOTHING;
```

`tierOf()` 的 `winner`（第二、三名）層照同樣形狀再補一段，`place IN (2, 3)`、asset 換成當季的 `winner` 那組即可，這裡不重複列出。

`ON CONFLICT DO NOTHING` 配上複合主鍵讓授予**冪等** —— 同一場重複上傳、或手動重跑授予，都不會產生重複列或覆蓋掉原本的 `at`。

授予規則目前存在於 `src/game/playerNameplate.js` 的 `tierOf(record)` / `defaultAsset(record, season)`：

```
best === 1          → champion
best === 2 or 3     → winner
events > 0          → participants
其他                 → default
```

搬上線是把這段從前端的即時計算改成寫進資料表，邏輯不用重想。

### 線上對戰的寫入

```
房間裡一場打完
      ↓
INSERT INTO online_matches (...)
      ↓
重算 stats（同一段 UPDATE，一次算完線上線下兩套）
```

比上傳賽事頻繁得多，但同樣只有 1.4ms，而且不需要另外寫一套邏輯。

### 不觸發重算的操作

玩家改自己的 `avatar` / `background` / `title_id` **不會**引起任何重算。那條路徑只寫 `players` 的三個欄位，跟成績無關。

---

## API

```
POST  /api/players/lookup       { codes: [...] }  → 整桌選手的 nameplate + stats
GET   /api/players/:code                          → 單一選手 + 他的解鎖清單
PATCH /api/players/:code        { equipped }      → 改外觀，需登入
POST  /api/players/:code/grants                   → 主辦手動發稱號／旗幟
POST  /api/tournaments                            → 上傳賽事，需主辦權限
GET   /api/tournaments                            → 列表
POST  /api/records/rebuild                        → 手動重建 stats
```

### `GET /api/players/:code` 回應

```jsonc
{
  "code": "P000001",
  "name": "Ray",
  "equipped": { "avatar": "2026-9-champion", "background": "2026-9-champion",
                "titleId": "m1-champion" },
  "stats": {
    "events": 1, "gold": 1, "silver": 0, "bronze": 0, "podiums": 1,
    "tour":   { "wins": 3, "losses": 0, "draws": 0, "byes": 0, "winRate": 1.0 },
    "online": { "wins": 12, "losses": 9, "draws": 1, "winRate": 0.545 }
  },
  "unlocks": {
    "avatars":     ["2026-9-participants", "2026-9-champion"],
    "backgrounds": ["2026-9-participants", "2026-9-champion"],
    "titles":      ["m1-attendee", "m1-champion"]
  }
}
```

不到 500 bytes，因為只有 id。圖檔和稱號文案都已經在前端 bundle 裡。

### `PATCH` 的驗證

```sql
SELECT 1 FROM player_unlocks
WHERE code = $1 AND kind = $2 AND asset = $3;
```

不存在且不屬於公開素材就回 400。

**前端的 `:disabled` 只是 UX，這個檢查才是規則。** 否則改一行 JS 就能把自己的旗換成冠軍旗。

---

## 離線快照

現行架構是純本機，**斷網也能辦比賽**。改成打 API 之後，場地網路不穩就撈不到選手外觀 —— 而那正是最不能出事的時刻。

解法：**建立賽事時把查到的 nameplate 快照寫進賽事本身**，開打之後整場讀快照，不再連線。

```jsonc
{
  "id": "t-meetup2",
  "players": [
    { "id": "<uuid>", "name": "Ray", "code": "P000001",
      "nameplate": { "avatar": "2026-9-champion", "background": "2026-9-champion",
                     "titleId": "m1-champion", "winRate": 1.0, "gold": 1 } }
  ]
}
```

每人約 100 bytes，一場 16 人才 1.6KB。

這在語意上本來就比較對：看歷史賽事時應該顯示選手**當時**戴的旗幟和稱號。Meetup#1 的桌次表不該因為他後來拿了 Meetup#2 冠軍就整張變樣。`nameplateStore.js` 的 `withEventName()` 註解也是這個立場 —— store 的資料是快照，現場登記的名字才是當下。

---

## 前端接點

| 檔案 | 要改什麼 | 呼叫點 |
|---|---|---|
| `src/data/nameplateStore.js` | `loadNameplates()` 改打 API、變 async | **2 處**（都在 `TournamentDetail.vue`） |
| `src/data/tournaments.js` | `loadTournaments` / `saveTournament` 改打 API | **5 處**（都在 `TournamentApp.vue`） |
| `src/game/playerBadges.js` | **不動** | — |
| `src/components/PlayerProfileApp.vue` | 依 `unlocks` 把未擁有的項目設為鎖定 | — |

`aggregatePlayers()` 吃的是賽事陣列，資料從 localStorage 或 API 來對它沒差別。`nameplateStore.js` 當初就留了交換點：

> *Whatever replaces it — a database, an API, a file the organiser imports — swaps in behind `lookupNameplates` without the tournament screens noticing.*

唯一有工程量的是 `loadNameplates()` 從同步變非同步，它目前在 render path 上被呼叫，要改成「先載入、再渲染」。

### 個人資料頁的鎖定狀態

`PlayerProfileApp.vue` 目前把 11 個頭像、8 面旗、15 個稱號全部列出來隨便選（mock 狀態）。接 API 後未擁有的要顯示成**鎖定而非隱藏**，旁邊帶上解鎖條件 —— `titleCatalogue.js` 的 `condition` 欄位當初就是為此設計的：

> *`condition` is shown beside a title so a player can see what it takes, whether or not they hold it.*

---

## 匯入選手的既有鏈路

```
貼上「Ray;P000001」（分號／全形分號／Tab 皆可，試算表兩欄可直接貼）
   ↓  parsePlayerLine()
{ name: 'Ray', code: 'P000001' }        ← code 自動轉大寫
   ↓  keyFor()
'code:P000001'
   ↓  lookupNameplates()
{ avatar, background, title, winRate, medals }
```

這條鏈路已經完整，只差 `loadNameplates()` 換資料來源。

### 沒有編號的人

`fallbackNameplate()` 已處理：預設頭像、預設旗、無稱號、數字全 0，名字照顯示。桌次表不會破版。

但**身份建議當場發編號**，不要走 `name:` 退路。`identityOf()` 在沒編號時退成 `name:小明`，下次他帶著編號來，第一場的紀錄就永遠接不回來。報到台不會多做事 —— 編號欄位留空時由工具自動產下一號即可（目前沒有這段邏輯，編號全靠手打）。他看到的仍是預設旗，因為 `tierOf()` 在 `events: 0` 時本來就回 `'default'`。

### 編號打錯的靜默失敗

`P000O01`（字母 O）和 `P000001`（數字 0）打錯之後畫面**看起來完全正常**，但成績會記到一個不存在的人身上。匯入時既然要打 API 查，就順手擋：

> 這 3 個編號查無此人：`P000O01`、`P00O023`、`P000999`
> 〔是新選手，建立〕　〔我打錯了，回去改〕

這件事的價值比外觀高 —— 頭像錯了看得出來，編號錯了看不出來。

---

## 用 GUI 工具直接改資料庫時

可以改的：

- `tournaments` / `matches` / `tournament_players` 的內容（修正輸入錯誤的結果）
- `player_unlocks`（手動發／收回稱號、旗幟）
- `players` 的 `name` / `avatar` / `background` / `title_id`

**改完對局或名次之後，一定要跑一次重算**，否則 `players` 上的戰績會停留在舊值：

```sql
UPDATE players SET ... FROM player_stats s WHERE s.code = players.code;   -- 見上方
```

或呼叫 `POST /api/records/rebuild`。

不要手改的：`players` 上所有衍生欄位（`tour_wins`、`tour_win_rate`、`online_*`、`gold`、`podiums`…）。改了不會報錯，但下一場線上對戰結束就被整批覆蓋，中間那段時間畫面顯示的是錯的。要調整這些數字，正確做法是去改對局資料然後重算。

---

## 決策紀錄

談這份規劃時推翻過幾個決定，記下來避免重複來回：

| 決定 | 理由 |
|---|---|
| **SQLite / Postgres，不用 MongoDB** | 資料是關聯式的 —— 外鍵能擋孤兒資料、`ON DELETE CASCADE`、聚合查詢。「賽事是巢狀文件」不成立：rounds/matches 本來就該拆表 |
| **戰績存成 `players` 的欄位，不獨立一張表** | 一個選手只有一組戰績（1:1）。獨立一張表換不到任何東西 |
| **但戰績要存，不是每次現算** | 成本不在 CPU（1.4ms）而在 read amplification —— 查一個人的勝率要撈出整個 `matches` 表 |
| **解鎖獨立一張表，不是 JSON 欄位** | 1:N、需要跨選手查詢、並行寫入不能 read-modify-write |
| **解鎖只存賺到的，公開素材不入表** | 否則新增一張免費頭像要對全部選手各 INSERT 一筆 |
| **`auth_identities` 與 `players` 分開** | 現有八位選手有編號沒帳號，要能認領而不是拿新編號 |
| **先用認領碼，不接 OAuth** | 唯一要保護的是「改自己的外觀」。無金流無個資，接 provider 不成比例 |
| **線上與線下勝率分開統計** | 線上隨手打輸幾場不該拉低實體賽事的戰績 |
| **線上對戰另開一張表** | 沒有輪空、沒有輪數、不屬於任何賽事 —— 形狀本來就不同 |
| **線上對戰一律要求登入** | 外鍵兩邊都 `NOT NULL`，不會有寫不進去的對局 |
| **Postgres，不用 SQLite** | 要用 GUI 工具從自己電腦連進去改。SQLite 的檔案在容器裡，而且 Vercel 的檔案系統用完即丟、根本寫不了 |

---

## 部署架構

```
容器 PaaS ─┬─ Node 常駐行程：API + 線上房間 server
           └─ 託管 Postgres（同平台）

前端       靜態託管（Vercel / Cloudflare Pages / GitHub Pages）
```

**後端不能放 Vercel。** 它是 serverless，沒有常駐行程、沒有持久檔案系統、沒有 shell，而線上房間需要常駐記憶體保存房間狀態。

**用平台的託管 Postgres，不要自己在 VPS 上跑一個。** 搬上資料庫的理由是「資料只活在一台瀏覽器會沒掉」—— 搬到一台沒有備份的機器上只是換個地方沒掉。託管版的備份和版本升級由平台處理，從操作感受上仍然是「一個地方」。

**前端建議留在靜態託管**，不是為了 CDN（使用者都在台灣），是為了停機時的行為：前端在同一台時，重新部署或機器掛掉就整個開不起來；放靜態託管的話，後端出事只是撈不到選手外觀，賽程編排靠離線快照照常運作 —— 而那通常正是比賽現場。

---

## 待定

- **avatar 要不要也走擁有制**：banner 明確要記錄擁有權；avatar 當初說的是「之後給他們自己換」，聽起來是全開放。目前 schema 兩種都撐得住
- **線上與線下勝率怎麼顯示**：資料已經分開存，顯示方式未定
- **線上勝率的防刷**：跟朋友對打、快輸就斷線，都能灌水。等決定怎麼顯示時一起想
- **現場走進來報名的人**：建議由主辦當場建立臨時選手列（有編號、無帳號），之後本人註冊時認領
- **登入與註冊流程**：`claim_codes` 那段只是傾向，要另外討論。`auth_identities` 的形狀不受影響
