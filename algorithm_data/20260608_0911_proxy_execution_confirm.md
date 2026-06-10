# 決策記錄：代理操作一鍵啟動測試
**時間**：2026-06-08 09:11:00

---

## 1. 背景與需求說明
使用者要求 AI 代理操作，直接於本機端執行一鍵啟動批次檔 `start_yolo_ui.bat`，以確認批次檔修復後能百分之百在 Windows 環境下跑通，並開啟瀏覽器操作介面。

---

## 2. 執行方案與決策
為了模擬使用者真實雙擊執行的行為，且避免 CLI 終端機因批次檔中的 `pause` 命令而卡死，我們採取以下步驟：
1.  **清理舊服務進程**：使用 `manage_task` 的 `kill` 操作，安全地終止先前手動啟動的舊 FastAPI 背景伺服器 (埠 8000)，釋放連接埠資源。
2.  **模擬雙擊啟動**：透過 Windows PowerShell 的 `Start-Process` 指令：
    ```powershell
    Start-Process cmd.exe -ArgumentList '/c start_yolo_ui.bat' -WorkingDirectory 'd:\software\yolo'
    ```
    此命令會派生一個獨立的 Windows `cmd.exe` 視窗來執行批次檔，這與使用者在檔案總管中雙擊執行的效果完全一致。
3.  **非阻塞執行**：此方式執行後，PowerShell 進程會立即結束，而背景的 FastAPI 後端與瀏覽器介面將繼續維持運行，供使用者立即體驗。
