# 資料格式（schema）

所有紀錄都放在 `data/` 底下的 JSON 檔裡。網站和 AI 都只讀寫這些檔案。

| 檔案 | 內容 |
|---|---|
| `data/games.json` | 遊戲，依「地區 → 公司 → 系列 → …」排列 |
| `data/other-games.json` | 其他遊戲（舞秋風小遊戲、RPG Maker、依年代分類…） |
| `data/anime.json` | 動漫作品 |
| `data/misc.json` | 書、音樂、節目等雜項 |
| `data/channels.json` | 頻道（常看但未訂閱的頻道，以及舞秋風） |
| `data/review.json` | 待確認清單（從 PPT 轉換時判斷不確定的地方） |
| `data/link-report.json` | 失效連結報告，由 GitHub Actions 自動產生，不要手動編輯 |

格式慣例：UTF-8、`json.dump(obj, ensure_ascii=False, indent=1)`，檔尾要有換行。執行 `python3 tools/validate.py` 會檢查格式。

## 區塊檔（games / other-games / anime / misc）

```json
{ "version": 1, "section": "games", "title": "遊戲（依公司）", "nodes": [ Node, ... ] }
```

## Node（項目）

樹狀結構，可以任意深度。

| 欄位 | 必填 | 說明 |
|---|---|---|
| `id` | ✔ | 唯一 ID。新增時用 `python3 tools/validate.py --new-id n` 產生 |
| `kind` | ✔ | `region` 地區、`company` 公司、`category` 分類、`series` 系列、`subseries` 子系列、`group` 分組、`work` 作品 |
| `title` | ✔ | 名稱 |
| `status` | | 個人遊玩狀態：`played` 已玩過、`playing` 遊玩中、`dropped` 退坑 |
| `source` | | 動漫的原作媒介：`light-novel`、`manga`、`game`、`original` |
| `release` | | 發行／上映日期，見下方說明 |
| `tags` | | 字串陣列，自由標籤 |
| `links` | | Segment 陣列，標題連結。作品層級的 Wiki 放這裡；文字跟 `title` 相同的那個連結會直接掛在標題上，其餘排在標題下方。只放有 `url` 的 segment，不要放標點或空白。某一季、某張專輯的 Wiki 留在該筆紀錄裡 |
| `notes` | | 字串陣列，備註 |
| `extra` | | `{ "欄位名": "字串" }`，自訂欄位，之後想記錄新類型資訊時使用 |
| `entries` | | Entry 陣列，這個項目的紀錄（為空時省略此欄位） |
| `children` | | 子項目（為空時省略此欄位） |
| `origin` | | 原 PPT 頁碼，例如 `"ppt:23"`。只是參考用 |
| `subsidiary` | | `true` 表示是子公司（只用在 `company`） |

### release

```json
{ "date": "1996-10-25", "precision": "day", "region": "JP", "source": "https://..." }
```

- `date`：`YYYY`、`YYYY-MM` 或 `YYYY-MM-DD`。`precision` 要跟著長度設成 `year` / `month` / `day`。
- `region`：選填，`JP`、`NA`、`EU`、`TW`、`CN`、`WW`…。預設填最早的發行日期。
- `source`：選填但建議要有，填日期資料的出處網址。

## Entry（一筆紀錄）

```json
{ "id": "e0123", "type": "video", "segments": [ Segment, ... ], "notes": ["..."] }
```

| 欄位 | 說明 |
|---|---|
| `type` | 選填。省略表示遊玩紀錄（類型欄顯示文字上的 `played`／`playing`／`dropped` 標記）。其餘：`video` 影片（實況、全流程）、`lore` 劇情解說、`music` 音樂、`anime` 動畫、`reading` 小說／漫畫、`evolution` 系列演進（Evo.）、`compare` 版本比較（Ver. Compare）、`trivia` 雜談、`reference` 資料（Wiki、資料庫）、`other` 其他 |
| `segments` | 這筆紀錄的內容，由多段文字和連結組成 |
| `notes` | 選填，備註（例如「巴哈含第 24.5 集總集篇」） |

紀錄不再分「紀錄／音樂」兩區，音樂只用 `type: "music"` 區分；習慣上音樂類紀錄排在項目的後面。

## Segment（一段文字或連結）

| 欄位 | 說明 |
|---|---|
| `text` | 顯示的文字（必填） |
| `url` | 連結網址（選填） |
| `mark` | 標記，對應原 PPT 的顏色：`video` 看過的遊戲影片（藍綠）、`music` 聽過的音樂（洋紅）、`anime` 看過的動畫（深綠）、`played` 已玩過（黃）、`playing` 遊玩中（土黃）、`dropped` 退坑（棕） |
| `playlist` | `true` 表示連結是播放清單／合集（原 PPT 的 `*`） |
| `channel` | 影片來自哪個頻道，例如 `"舞秋風"`（原 PPT 的「舞」） |

沒有 `mark` 的連結代表「先記下來、還沒看」，或是 Wiki、資料庫這類參考連結。

## 網頁編輯器的連結語法

網頁上編輯一筆紀錄時，segments 會顯示成一行文字：

```
Doom 1993 ([Full](https://youtu.be/...){影片}, [Final Boss](https://youtu.be/...)), [OST](https://...){音樂,合集,舞}
[Shadow of Mordor]{已玩}
```

- `[文字](網址)`：連結
- `{...}`：選項，可用 影片／音樂／動畫／已玩／遊玩中／退坑、`合集`、`舞`（舞秋風）、`ch:頻道名`
- `[文字]{已玩}`：沒有連結、但有標記的文字
- `\[`、`\]`：一般的方括號

## channels.json

```json
{ "version": 1, "channels": [ { "id": "c0001", "name": "亚食人", "url": "https://space.bilibili.com/...", "category": "遊戲雜談與評測", "platform": "bilibili", "subscribed": false, "note": "" } ] }
```

## review.json

```json
{ "version": 1, "items": [ { "id": "r0001", "slide": 12, "node": "n0042", "issue": "說明", "text": "原文" } ] }
```

處理完的項目直接刪除。
