# 給 AI 的維護說明

這個 repo 是使用者的個人電子娛樂紀錄（遊戲、動漫、頻道），以靜態網站形式放在 GitHub Pages。
**使用者希望由 AI 維護資料與程式**，自己只偶爾用網頁表單修改。請用繁體中文回覆。

## 結構

```
index.html, assets/       網站（純 HTML/CSS/ES modules，沒有 build 步驟）
  app.js                  載入資料、瀏覽、搜尋、統計、頻道、待確認
  editor.js               網頁編輯器（表單、移動、刪除、提交到 GitHub）
  markup.js               編輯器的連結語法 ⇄ segments
  github.js               GitHub REST：讀檔、多檔一次 commit
data/*.json               所有紀錄（唯一的資料來源）
docs/schema.md            資料格式 ← 修改資料前先讀
tools/validate.py         驗證資料格式；--new-id 產生新 ID
tools/check_links.py      檢查失效連結 → data/link-report.json（GitHub Actions 每月執行）
tools/convert_pptx.py     當初從 PPT 轉換用的腳本，僅供參考，不要再執行（會覆蓋網頁上的修改）
```

## 修改資料的流程

1. 先讀 `docs/schema.md`，再用 Python 讀寫 JSON（不要用 sed 或手動拼字串）。
   寫回時一律 `json.dump(obj, f, ensure_ascii=False, indent=1)`，最後寫一個 `\n`。
2. 新的 id 用 `python3 tools/validate.py --new-id n`（節點）、`--new-id e`（紀錄）、`--new-id c`（頻道）。
3. 找項目時用標題搜尋整棵樹；同名的可能不只一個（例如「Arcade」），要看上層路徑。
4. 改完執行 `python3 tools/validate.py`，必須 0 errors 才能 commit。
5. commit 訊息用英文簡述，例如 `Add Persona 3 Reload playthrough`。直接推到 `main`；GitHub Pages 約 1 分鐘後更新。
6. 推之前先 `git pull --rebase`：使用者可能剛從網頁編輯器提交過，Actions 也會更新連結報告。

## 把使用者的話對應到欄位

| 使用者說 | 怎麼記 |
|---|---|
| 「我玩過／通關了 X」 | 節點 `status: "played"`；如果只是系列裡的某一代，就在 entry 裡給那段文字加 `mark: "played"` |
| 「正在玩 X」「X 退坑了」 | `status: "playing"` / `"dropped"` |
| 「看了 X 的實況／全流程」 | entry `type: "video"`，連結加 `mark: "video"`；是播放清單就加 `playlist: true` |
| 「舞秋風的 X 實況」 | 同上，再加 `channel: "舞秋風"` |
| 「看了 X 的劇情解說」 | `type: "lore"`，連結 `mark: "video"` |
| 「聽了 X 的 OST」 | `section: "music"`、`type: "music"`，連結 `mark: "music"`，Wiki／VGMdb 不加 mark |
| 「看完 X 動畫第 N 季」 | 動漫節點的 entry `type: "anime"`，看的那個連結 `mark: "anime"`；備註寫在 `notes` |
| 「先記下 X 的影片，還沒看」 | 連結不加 `mark` |
| 「系列演進／版本比較影片」 | `type: "evolution"` / `"compare"` |
| 「X 的發行日」 | `release`，一定要附 `source` 網址；查不到就不要填 |
| 新的作品 | 遊戲放 `data/games.json` 對應的公司底下（找不到公司就在對應地區新增 `company`）；不屬於任何公司的放 `data/other-games.json`；動漫放 `data/anime.json` 的最上層，`kind: "work"` |

不確定該放哪裡，或使用者的描述有兩種合理解讀時，先問使用者。

## 修改網站程式

- 不使用框架和 build 工具，維持「直接打開就能跑」。
- 改完用本機伺服器測試：`python3 -m http.server`，密碼 `2a921804`（寫在 `assets/app.js`，只是擋一般訪客，不是加密）。
- 資料新增欄位時，要同步更新 `docs/schema.md`、`tools/validate.py`、`assets/editor.js` 的表單和 `assets/app.js` 的顯示。

## 待辦（使用者已同意的下一步）

- 分批補上 `release` 發行日期（每筆附來源網址）。
- 依 `data/review.json` 和使用者回饋修正轉換錯誤。
