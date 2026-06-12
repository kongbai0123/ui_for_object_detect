# 🛠️ YOLO UI - 影像辨識與物件偵測標註/訓練平台

YOLO UI 是一個為 YOLO 及影像分類/物件偵測任務量身打造的**桌面端 Web 標註與訓練管理平台**。本專案結合了輕量高效的 **FastAPI** 後端與直觀易用的前端互動介面，幫助開發者快速完成從「資料匯入」、「資料標註」、「數據切分與增強」、「模型訓練」到「模型優出/推論測試」的完整工作流。

---

## ✨ 核心特色

- 📁 **專案與工作區管理**：
  - 支援多專案建立、切換，並可透過系統資料夾選擇器（GUI）快速定位工作目錄。
  - 工作目錄結構自動化，專案配置（`project_config.json`）一鍵存取。

- 🏷️ **智能標註系統**：
  - 直觀的影像標註介面，支援快捷鍵操作（`A`/`←` 上一張、`D`/`→` 下一張、滾輪縮放、`Space` 拖曳）。
  - 自動偵測並載入 `labels.csv`，支援類別新增、修改與刪除，並可自訂狀態（已標註、待確認、忽略）。
  - 介面提供即時的標記進度統計與類別分佈圖表。

- ⚡ **數據切分與平衡策略**：
  - 視覺化調整 **Train / Val / Test** 切分比例。
  - 支援**隨機切分（Random Split）**與**分層抽樣（Stratified Split）**，確保訓練集與驗證集的類別分佈一致。
  - 內建類別不平衡優化策略（如 Weighted Loss、Oversampling、Undersampling 等）。

- 📈 **訓練監控與可視化**：
  - 提供即時訓練面板，動態監控 Epoch 進度、Loss 曲線下降、Validation Accuracy 增長等重要指標。
  - 支援一鍵開始/停止訓練，自動輸出模型權重（`.pt`）與詳細日誌。

- ⚙️ **模型優化與量化導出**：
  - 支援將訓練完成的 PyTorch 模型轉換為 **TensorRT (.engine)**、**ONNX**、**OpenVINO** 等主流推理引擎格式。
  - 支援 **FP16**（半精度）與 **INT8**（8-bit 量化校準）壓縮，大幅提升邊緣設備推理速度。

- 🔍 **模型推論與預測測試**：
  - 支援直接上傳影像進行模型預測。
  - 系統將即時渲染預測邊界框（Bounding Box）、標籤類別與信賴度（Confidence），並顯示硬體推理耗時（ms）。

- 💻 **環境自我診斷**：
  - 一鍵診斷本機深度學習環境，包含 PyTorch 版本、CUDA 是否啟用、GPU 型號、顯示記憶體（VRAM）使用量與 cuDNN 版本。

---

## 📂 專案目錄結構

```text
yolo/
├── algorithm/
│   └── yolo_ui/
│       ├── css/             # 前端樣式檔案
│       ├── js/              # 前端邏輯控制與 API 對接
│       ├── index.html       # 單頁 Web UI 介面
│       ├── server.py        # FastAPI 後端服務（主邏輯）
│       └── projects.json    # 本地已註冊的專案清單
├── start_yolo_ui.bat        # Windows 批次檔啟動入口
├── start_yolo_ui.vbs        # Windows 後台靜默啟動腳本
├── .gitignore               # Git 忽略配置
└── README.md                # 專案說明文件（本檔案）
```

---

## 🚀 快速開始

### 1. 環境準備

本專案需要 **Python 3.8+** 環境。請先安裝相關依賴套件：

```bash
pip install fastapi uvicorn pillow pydantic python-multipart
```

> 💡 *提示：如果您需要進行實際的模型訓練或環境診斷，請確保已安裝相容於您 GPU 的 **PyTorch** 版本。*

### 2. 啟動 YOLO UI

我們提供了兩種啟動方式（推薦 Windows 用戶直接雙擊運行）：

- **方式 A：使用便捷啟動腳本（推薦）**
  - 雙擊執行 `start_yolo_ui.bat`。它將透過 `start_yolo_ui.vbs` 啟動後端服務，並**自動在您的預設瀏覽器中開啟**平台介面。
  
- **方式 B：手動終端機啟動**
  - 開啟終端機並切換至專案路徑，執行以下指令：
    ```bash
    python algorithm/yolo_ui/server.py
    ```
  - 啟動後，手動在瀏覽器中輸入網址：[http://127.0.0.1:8000](http://127.0.0.1:8000)

### 3. 自動關閉機制
- 本系統內建心跳檢測機制（Heartbeat）。當檢測到所有瀏覽器分頁關閉超過 30 秒後，後端服務會自動安全退出，不佔用系統背景資源。

---

## 🛠️ 開發與貢獻

歡迎提交 Issue 或 Pull Request 來改進 YOLO UI！在提交代碼前，請確認已更新 `.gitignore` 並將不必要的快取與日誌過濾。

祝您訓練愉快！🚀
