# 決策紀錄: 隱藏啟動與關閉網頁自動結束後端服務 (VBScript 版)

- **時間**: 2026-06-08 15:15
- **需求來源**: 使用者要求隱藏啟動後的 CMD 視窗，並於關閉瀏覽器網頁時，同時關閉後端服務。

---

## 預計變更的具體內容與範圍

### 1. 啟動機制 (`start_yolo_ui.bat` & `start_yolo_ui.vbs`)
- **修改前**:
  - 舊版嘗試使用 PowerShell 的 `Start-Process -WindowStyle Hidden` 啟動，但在某些環境下會因 ExecutionPolicy (執行原則) 被阻擋而失敗，且會繼承 stdout 導致 CMD 視窗卡在啟動步驟而無法繼續開啟瀏覽器。
- **修改後**:
  - 建立輔助腳本 `start_yolo_ui.vbs`，利用 Windows 內建的 VBScript 執行。VBScript 的 `WshShell.Run` 支援以 `0` 參數執行隱藏視窗、且非同步（不卡住）。
  - 將 Python 的錯誤重導向至 `backend_err.log`，以便在啟動失敗時能透過日誌除錯。
  - `start_yolo_ui.bat` 檔案簡化為僅一行 `wscript "%~dp0start_yolo_ui.vbs"`，並立即 `exit`。
  - 確保所有批次檔與 VBS 檔案皆使用 Windows 原生的 **CRLF (\r\n)** 換行格式寫入，避免 CMD 在讀取 UTF-8 檔案時因換行符解析錯誤而把代碼當作指令執行。

### 2. 後端服務 (`server.py`)
- **修改後**:
  - 新增 `/api/heartbeat` (GET) 與 `/api/shutdown` (POST) 接口。
  - 移除 FastAPI 依賴的 `@app.on_event("startup")`，改為在 Python 模組載入時，直接於最外層透過背景執行緒啟動 `monitor_heartbeat`。這能 100% 確保監控執行緒運作，並解決 FastAPI 警告問題。
  - 若 30 秒內未偵測到心跳，伺服器會主動呼叫 `os._exit(0)` 自行結束。

### 3. 前端網頁 (`index.html`)
- **修改後**:
  - 頁面載入後，每 10 秒發送一次 `/api/heartbeat`。
  - 當使用者關閉分頁或瀏覽器時，透過 `beforeunload` 與 `pagehide` 事件呼叫 `navigator.sendBeacon('/api/shutdown')`，非同步且可靠地立即通知後端關閉。

---

## 預期結果與效益

1. **極致隱形啟動**: 使用者雙擊 `start_yolo_ui.bat` 後，CMD 視窗會瞬間關閉，沒有任何多餘的視窗或工作列圖示殘留。隨後瀏覽器會自動彈出並開啟操作網頁。
2. **生命週期同步**: 關閉網頁後，後端進程立馬退場。若因意外中斷（如當機、斷電），後端亦會在 30 秒內自動超時回收，保證 Port 8000 不會被鎖死。
