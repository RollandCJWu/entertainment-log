# 給 AI 的維護說明

這個 repo 是使用者的個人電子娛樂紀錄（遊戲、動漫、頻道），以靜態網站形式放在 GitHub Pages。
**使用者希望由 AI 維護資料與程式**，自己只偶爾用網頁表單修改。請用繁體中文回覆。

## 結構

```
index.html, assets/       網站（純 HTML/CSS/ES modules，沒有 build 步驟）
  app.js                  載入資料、瀏覽、搜尋、統計、頻道、待確認
  editor.js               網頁編輯器（表單、移動、刪除、提交到 GitHub）
  local.js                本機資料夾模式（File System Access API）與 GitHub 同步、衝突處理
  markup.js               編輯器的連結語法 ⇄ segments
  github.js               GitHub REST：讀檔、多檔一次 commit
data/*.json               所有紀錄在 GitHub 上的備份（主要版本在使用者電腦的本機資料夾）
docs/schema.md            資料格式 ← 修改資料前先讀
tools/validate.py         驗證資料格式；--new-id 產生新 ID
tools/check_links.py      檢查失效連結 → data/link-report.json（GitHub Actions 每月執行）
```

## 資料的主要版本在使用者電腦上

使用者用網頁的「本機資料夾」功能把資料存在電腦上（個人電腦、實驗室電腦），GitHub 上的 `data/*.json` 只是偶爾上傳的備份，**可能比本機舊**。
本機資料夾裡是同樣 6 個 JSON（直接放在資料夾裡，沒有 `data/` 這層），另外有 `_sync.json`（同步狀態，不要改）和 `_backups/`。

使用者請你改資料時：

- **這個對話能存取使用者電腦上的那個資料夾**（Claude 桌面版連結了該資料夾）→ 直接改那裡的檔案，用 `python3 tools/validate.py --dir 資料夾路徑` 驗證。不要動 `_sync.json`；網頁會把它顯示成「還沒上傳到 GitHub」，由使用者自己上傳。
- **否則** → 照下面的流程改 repo 並推上去，然後提醒使用者在電腦上打開網站，按提示列的「從 GitHub 更新」。如果他本機也有還沒上傳的修改，同一個檔案會變成衝突，所以改之前先問他本機有沒有還沒上傳的東西。

## 修改 repo 資料的流程

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
| 「我玩過／通關了 X」 | X 的作品節點 `status: "played"`；系列裡的某一代也是開一個 `work` 節點（見 `docs/schema.md` 的作品規則） |
| 「正在玩 X」「X 退坑了」 | `status: "playing"` / `"dropped"` |
| 「看了 X 的實況／全流程」 | 新增一筆 entry，連結文字寫清楚內容（`Full Walkthrough`、`舞秋風實況`…），加 `mark: "video"`；是播放清單就加 `playlist: true` |
| 「舞秋風的 X 實況」 | 同上，再加 `channel: "舞秋風"` |
| 「看了 X 的劇情解說」 | 連結文字寫 `劇情解說`，`mark: "video"` |
| 「聽了 X 的 OST」 | 加在項目紀錄的後面，寫成 `[OST](…){音樂} ([Wiki](…))`：聽的連結 `mark: "music"`，Wiki／VGMdb 不加 mark |
| 「看完 X 動畫第 N 季」 | 照 `docs/schema.md` 的「動漫的寫法」：季名連結 `mark: "anime"`，併入同段正篇那筆；備註寫在該筆 `notes` |
| 「先記下 X 的影片，還沒看」 | 連結不加 `mark` |
| 「X 的 Wiki」 | 作品本身的 Wiki 放節點 `links`，文字用作品標題（會掛在標題上）；某一季／某張專輯的 Wiki 放在那筆紀錄裡 |
| 「系列演進／版本比較影片」 | 放在系列節點，連結文字寫 `Evolution 年份–年份` 或說明比較內容 |
| 「X 的發行日」 | `release`，一定要附 `source` 網址；查不到就不要填 |
| 新的作品 | 遊戲放 `data/games.json` 對應的公司底下（找不到公司就在對應地區新增 `company`；隸屬於某集團的子公司或開發團隊用 `studio`，放在母公司底下）；不屬於任何公司的放 `data/other-games.json`；動漫放 `data/anime.json` 的最上層，`kind: "work"` |

不確定該放哪裡，或使用者的描述有兩種合理解讀時，先問使用者。

## 修改網站程式

- 不使用框架和 build 工具，維持「直接打開就能跑」。
- 改完用本機伺服器測試：`python3 -m http.server`，密碼 `2a921804`（寫在 `assets/app.js`，只是擋一般訪客，不是加密）。
- 資料新增欄位時，要同步更新 `docs/schema.md`、`tools/validate.py`、`assets/editor.js` 的表單和 `assets/app.js` 的顯示。

## 待辦（使用者已同意的下一步）

- games.json 與 other-games.json 已依「每款遊戲一個 work」規則重整完（Minecraft 維持使用者自己整理的樣子）。接下來依 `data/review.json` 的回覆逐項修正，尤其是暫時寫「影片」的連結文字。
- 分批補上 `release` 發行日期（每筆附來源網址）。
- 依 `data/review.json` 和使用者回饋修正轉換錯誤。
