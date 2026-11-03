# 娛樂紀錄

我的電子娛樂紀錄：遊戲、動漫、YouTube／B站頻道。從原本的 Google Slides（`Entertainment.pptx`）轉換而來。

網站：<https://rollandcjwu.github.io/entertainment-log/>（密碼 `2a921804`）

> 網站是公開的，密碼只用來擋一般訪客。資料檔（`data/*.json`）本身任何人都讀得到，所以不要放真正私密的內容。

## 使用方式

- **瀏覽**：左側目錄依「地區 → 公司 → 系列」排列。手機上按左上角 ☰ 打開目錄。
- **搜尋**：最上方的搜尋框可以找作品名稱、連結文字和備註；多個關鍵字用空白分開。
- **篩選**：在搜尋頁可以依「已玩過、遊玩中、看過影片、未標記影片連結、舞秋風…」、紀錄類型、區塊篩選。不輸入關鍵字也能篩選，例如列出所有「遊玩中」。
- **統計**、**頻道**、**待確認**：在右上角。

顏色沿用原 PPT 的圖例：藍綠＝看過的遊戲影片、洋紅＝聽過的音樂、深綠＝看過的動畫、黃＝已玩過、土黃＝遊玩中、棕＝退坑。
「合集」標籤代表播放清單，「舞」代表舞秋風的影片。

## 修改紀錄

### 方法一：請 Claude 修改（推薦）

直接說要改什麼，例如「Persona 3 Reload 已通關，加上這個全流程連結」，Claude 會改好資料並推上來。

### 方法二：網頁編輯器

1. 按右上角「編輯」。
2. 到想修改的項目頁面，在表單裡修改，按「套用變更」。可以新增紀錄、子項目，也可以移動、刪除項目。
3. 上方會出現黃色提示列，按「提交到 GitHub」。

第一次提交時需要 GitHub Token（只會存在你的瀏覽器）：

1. 打開 <https://github.com/settings/personal-access-tokens/new>
2. Repository access 選 **Only select repositories** → `entertainment-log`
3. Permissions → Repository permissions → **Contents: Read and write**
4. 產生之後複製 token，貼到提交視窗裡

連結的寫法請看編輯表單下方的說明，或參考 [docs/schema.md](docs/schema.md)。

## 給維護者

- 資料格式：[docs/schema.md](docs/schema.md)
- AI 維護說明：[CLAUDE.md](CLAUDE.md)
- 驗證資料：`python3 tools/validate.py`
- 失效連結：GitHub Actions 每月 1 號自動檢查，結果顯示在「待確認」頁面的最下方。也可以到 Actions → Check links → Run workflow 手動執行。
