# 決策記錄：自訂輸出路徑與資料頁 UI 調整
**時間**：2026-06-08 09:32:00

---

## 1. 背景與使用者需求說明
使用者提出關於輸入與輸出路徑的以下修改：
1.  **輸入/輸出連動**：每次重新選取 Input 目錄時，Output 目錄應自動同步變更為 `[Input路徑]/runs`。
2.  **Output 自定義與 UI 擴充**：移除 Output 的唯讀限制，使其可自訂，並為其補上資料夾選擇 icon 按鈕。
3.  **移除訓練頁重複欄位**：移除「3. 模型訓練與配置」分頁最下方的「專案儲存路徑」輸入框，以簡化介面。

---

## 2. 技術修改與實作步驟

### A. 後端修改 (`server.py`)
*   修改 `ProjectConfig` 模型，加入 `output_path` 欄位。
*   新增 `POST /api/project/update` 接口，以便前端在「資料頁面」修改 Input 或 Output 路徑後，後端能即時同步 active_project 設定並重新寫入本機 `project_config.json`。

### B. 前端 HTML 修改 (`index.html`)
*   資料頁面：移除 `output-path-display` 輸入框的 `readonly` 屬性，改為 `<div class="input-with-btn">` 結構，並新增資料夾按鈕 `btn-data-choose-output-dir`。
*   訓練頁面：刪除 id 為 `runs-folder-display` 的 `form-group` 區塊。

### C. 前端 JS 修改 (`js/app.js`)
*   在 `setupDataPageEvents` 綁定 `btn-data-choose-output-dir` 的點擊事件。
*   當點選 `btn-data-choose-dir` 成功更新 Input 路徑後，**自動計算並回填 `output-path-display` 的值為 `[Input路徑]/runs`**，然後呼叫新增的 `update` API 同步給後端。
*   當點選 `btn-data-choose-output-dir` 成功更新 Output 路徑後，同樣呼叫 `update` API 同步後端。
*   移除在 `onProjectLoaded` 中對已刪除元素 `runs-folder-display` 的賦值操作，避免 JS 執行期錯誤。
