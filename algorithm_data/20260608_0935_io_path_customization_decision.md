# 決策記錄：輸入與輸出路徑自定義與連動優化

## 決策背景
使用者希望調整 YOLO UI 的輸入與輸出路徑行為：
1. **輸入與輸出路徑連動**：每次重新選取 Input 路徑後，Output 路徑必須自動同步變更為 `[Input路徑]/runs`。
2. **輸出路徑自定義與 Icon 補強**：解除 Output 欄位限制，使其可自定義（允許手動修改或點擊資料夾選擇器自訂），並在 Output 欄位旁補上資料夾圖示。
3. **移除訓練頁面重複欄位**：訓練頁面不應顯示重複的 Output 路徑。
4. **開啟結果資料夾功能**：優化「開啟結果資料夾」按鈕，實作後端 API 以便能在本機檔案管理員中真正開啟該目錄。

## 方案設計

### 1. 輸入/輸出連動邏輯
- 在 `js/app.js` 的 `btn-data-choose-dir` 點擊事件中：
  - 當選取新的 Input 路徑（例如 `PATH`）後，自動計算 `outPath = PATH + "/runs"`。
  - 將這兩個路徑更新至 UI 上對應的 Input/Output 欄位。
  - 發送請求至後端 `/api/project/create` 重新載入或建立專案，帶上 `input_path` 與 `output_path`，確保後端儲存的 `project_config.json` 包含最新的 output_path。
- 當使用者在「建立新專案」Modal 中選取 `new-input-path` 並點選確認時：
  - 由於後端在 `create_project` 時若無傳遞 `output_path` 會預設為 `input_path / "runs"`，此行為與前端完全一致。
  - 當建立成功並觸發 `onProjectLoaded` 時，會正確把連動後的 `runs` 路徑更新至 Output 輸入框。

### 2. 輸出路徑自定義與資料夾選擇按鈕 (Icon)
- 目前 `index.html` 的資料頁面（`data-view`）已包含 `output-path-display` 且旁邊有 `btn-data-choose-output-dir` 按鈕。
- 我們將進一步優化 `js/app.js` 的 `btn-data-choose-output-dir` 點擊邏輯：
  - 點擊時彈出本機資料夾選擇器。
  - 選定後更新 `output-path-display` 輸入框的值。
  - 若已載入專案，立即調用 `/api/project/update` 與後端同步更新；若尚未載入專案，則暫存該路徑，於專案建立時套用。
- 優化手動打字修改 `output-path-display` 的同步時機：
  - 原本監聽 `change` 事件（只有失去焦點且值改變才觸發）。
  - 我們將改為或額外監聽 `input`（防抖）以及 `blur` 事件，確保手動輸入能即時同步至後端。

### 3. 訓練頁面的 Output 路徑移除
- 經檢視，目前的 `index.html` 中的訓練頁面配置區塊已無 output 路徑輸入框。
- 原有的 `runs-folder-display` 欄位已確認在之前的修改中被完全移除。
- 專案程式中已無對此已移除元件的賦值操作，無 Runtime 報錯風險。

### 4. 實作「開啟結果資料夾」後端支援
- 在後端 `server.py` 新增一個 GET 端點 `/api/project/open_output_folder`：
  - 取得目前專案的 `output_path`，並在 Windows 上使用 `os.startfile(output_path)` 或是 `subprocess` 來開啟本機檔案總管。
- 前端 `js/app.js` 的 `btn-open-runs-folder` 點擊事件更新為：
  - 發送請求給 `/api/project/open_output_folder` 以呼叫本機檔案總管開啟資料夾，使「開啟結果資料夾」按鈕真正具備開啟功能。

## 選擇理由與效益
- **低耦合、高內聚**：維持前後端分離的 RESTful API 風格。
- **良好使用者體驗**：Input 選擇自動帶入 Output 可為使用者省去多餘的設定步驟，而 Output 自定義又保留了靈活性。補上本機檔案總管開啟功能能真正幫助使用者在本機上查看訓練出來的權重與模型檔案。

## 潛在風險與防範
- **路徑格式相容性**：Windows 與 Unix 的斜線方向不同。在後端以 Python `Path` 處理，前端傳遞時以 `/` 或統一轉換為 Python 的 `Path` 對象進行 `.resolve()` 確保斜線統一與格式正確。
