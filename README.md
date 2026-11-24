# 娛樂紀錄

我的電子娛樂紀錄：遊戲、動漫、YouTube／B站頻道。最初從 Google Slides（`Entertainment.pptx`）轉換而來，現在這個網站就是唯一的資料來源。

網站：<https://rollandcjwu.github.io/entertainment-log/>（密碼 `2a921804`）

> 網站是公開的，密碼只用來擋一般訪客。資料檔（`data/*.json`）本身任何人都讀得到，所以不要放真正私密的內容。

## 使用方式

- **瀏覽**：左側目錄依「地區 → 公司 → 系列」排列。手機上按左上角 ☰ 打開目錄。
- **搜尋**：最上方的搜尋框可以找作品名稱、連結文字和備註；多個關鍵字用空白分開。
- **篩選**：在搜尋頁可以依「已玩過、遊玩中、看過影片、未標記影片連結、舞秋風…」、區塊篩選。不輸入關鍵字也能篩選，例如列出所有「遊玩中」。
- **統計**、**頻道**、**待確認**：在右上角。

顏色沿用原 PPT 的圖例：藍綠＝看過的遊戲影片、洋紅＝聽過的音樂、深綠＝看過的動畫、黃＝已玩過、土黃＝遊玩中、棕＝退坑。
「合集」標籤代表播放清單，「舞」代表舞秋風的影片。

## 資料存在哪裡

**主要資料放在電腦上的本機資料夾**，GitHub 只是偶爾上傳的備份；手機和其他裝置看到的是 GitHub 上的版本。

### 設定本機資料夾（電腦版 Chrome / Edge，每台電腦做一次）

1. 按右上角「本機資料夾」→「選擇資料夾」。選一個空資料夾，網頁會先從 GitHub 下載目前的資料。
   - **建議選 OneDrive／Google Drive 裡的資料夾**，個人電腦和實驗室電腦就會共用同一份檔案。
   - 也可以直接選這個 repo 的 clone，網頁會自動使用裡面的 `data/`。
2. 之後每次打開網站，瀏覽器可能會要你按一下「開啟本機資料夾」重新授權；在授權視窗選「每次造訪都允許」就不用再按。
3. 按鈕會變成「本機：資料夾名稱」，代表目前讀寫的是本機檔案。

資料夾裡除了 6 個 JSON 外還會有：`_sync.json`（記錄上次和 GitHub 一致時的狀態，不要手動改）、`_backups/`（處理衝突時被取代的版本）。

### 和 GitHub 同步

上方的提示列會告訴你目前的狀態：

- **還沒上傳到 GitHub**：有空時按「上傳到 GitHub」，所有修改合成一個 commit。
- **GitHub 上有比較新的版本**：通常是另一台電腦上傳的，或是請 Claude 改的。按「從 GitHub 更新」。
- **本機和 GitHub 都改過**：按「詳細」，每個檔案選要保留哪一邊；另一邊會先備份到 `_backups/`。

兩台電腦如果沒有共用雲端資料夾，換電腦前記得先上傳，到另一台先更新，就不會出現衝突。

## 修改紀錄

### 方法一：網頁編輯器

1. 按右上角「編輯」。
2. 到想修改的項目頁面，在表單裡修改，按「套用變更」。可以新增紀錄、子項目，也可以移動、刪除項目。
3. 連結了本機資料夾時，按「套用變更」就會直接存檔，有空再上傳到 GitHub。
   沒有連結本機資料夾時，上方會出現黃色提示列，按「提交到 GitHub」。

### 方法二：請 Claude 修改

直接說要改什麼，例如「Persona 3 Reload 已通關，加上這個全流程連結」。Claude 能存取你電腦上的資料夾時會直接改本機檔案；否則會改 GitHub，之後你在網頁按「從 GitHub 更新」。

上傳到 GitHub 時需要 GitHub Token（每台電腦的瀏覽器貼一次，只會存在那個瀏覽器）：

1. 打開 <https://github.com/settings/personal-access-tokens/new>
2. Repository access 選 **Only select repositories** → `entertainment-log`
3. Permissions → Repository permissions → **Contents: Read and write**
4. 產生之後複製 token，貼到提交視窗裡

連結的寫法請看編輯表單下方的說明，或參考 [docs/schema.md](docs/schema.md)。

## 給維護者

- 資料格式：[docs/schema.md](docs/schema.md)
- AI 維護說明：[CLAUDE.md](CLAUDE.md)
- 驗證資料：`python3 tools/validate.py`（本機資料夾：`python3 tools/validate.py --dir 資料夾路徑`）
- 失效連結：GitHub Actions 每月 1 號自動檢查，結果顯示在「待確認」頁面的最下方。也可以到 Actions → Check links → Run workflow 手動執行。
