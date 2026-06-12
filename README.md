# 🛠️ Vision Training Studio - 智慧化影像模型開發工作台

Vision Training Studio 是一個專為電腦視覺（CV）開發者設計的**智慧化模型開發工作台**。平台圍繞模型訓練生命週期，精煉出 4 大核心流程工作區，幫助您從原始圖片開始，高效完成資料庫建立、影像標記、數據集分配與模型訓練評估。

---

## 🧭 4 大生命週期流程

平台核心不再是功能卡片的堆砌，而是依據模型訓練的最佳實踐排布的 4 大工作流：

### 1. 🗄️ 資料庫 (Dataset Database)
* **定位**：負責原始資料的匯入、索引建立、品質清洗、健康檢查與資料版本管理。
* **智慧化特色**：
  - 自動掃描資料目錄，自動過濾 `runs/`、快取與暫存檔案。
  - 自動診斷破損毀損圖片及重複影像，並產出解析度分布統計。
  - 即時計算資料庫健康分數，給出下一步行動建議（例如：未標註比例過高時提示前往標註中心）。

### 2. 🏷️ 標註中心 (Annotation Center)
* **定位**：負責手動標註、自動標註候選審核、標註修正與品質檢測。
* **智慧化特色**：
  - 直觀的影像邊界框 (Bounding Box) 畫布工具，支援流暢的快捷鍵操作。
  - 支援智慧型自動標註候選，低信心度樣本自動排入審核佇列，高信心度樣本可批次接受。
  - 自動進行標註品質掃描（如框選過小、超出邊界警告、IoU 重疊衝突提醒）。

### 3. ✂️ 樣本分配 (Sample Distribution)
* **定位**：將已確認標註的資料進行 Train/Val/Test 切分、類別/場景平衡與資料增強，最終匯出標準 YOLO/COCO 資料集。
* **智慧化特色**：
  - 預設採用 **Group Stratified Split** 演算法，避免同影片相似幀同時出現在訓練集與驗證集而造成資料洩漏。
  - 自動分析類別不平衡，智慧化推薦**過抽樣（Oversampling 3x）**或損失函數權重校正。
  - 內建 10 種物理資料增強可視化選項（如隨機翻轉、旋轉、噪訊、Gaussian Blur 等）。
  - 一鍵匯出資料集並自動產生 `data.yaml` 配置。

### 4. 🏋️ 模型訓練 (Model Training)
* **定位**：設定模型與超參、啟動訓練、實時監控、評估、推論測試與加速優化導出。
* **智慧化特色**：
  - 依據資料規模與本機顯卡顯存（VRAM），智慧化推薦最佳的模型大小與 Batch Size。
  - 實時折線監控 Loss 曲線與 Accuracy 收斂，內建 AMP 混合精度與 Early Stopping。
  - 訓練完成自動產出 Confusion Matrix、PR 曲線，並支援上傳圖片進行實時推論渲染與轉檔導出（ONNX、TensorRT、OpenVINO）。
  - 一鍵生成包含完整評估指標與圖表的 PDF/Markdown 格式模型開發評估報告。

---

## 🧠 全域 Smart Guide 智慧流程助手

平台右側常駐 **Smart Guide 智慧面板**，它會根據您當前所處的 Tab 與專案資料狀態：
1. 提示當前階段是否已完成，是否具備進入下一步的 Precheck 條件。
2. 顯示針對資料品質或訓練配置的警告（如類別比例低於下限、過擬合風險等）。
3. 自動推薦最佳化參數（如 Optimizer 選擇、資料增強強度等）。

---

## 📂 專案目錄結構

```text
vision_training_studio/
├── algorithm/
│   └── yolo_ui/
│       ├── css/             # 前端 CSS 樣式
│       ├── js/              # 前端邏輯（api.js, canvas.js, app.js, train.js）
│       ├── index.html       # 單頁 Web UI 工作台
│       ├── server.py        # FastAPI 後端 API
│       └── projects.json    # 本地已註冊的專案清單
├── start_yolo_ui.bat        # Windows 啟動批次檔
├── start_yolo_ui.vbs        # Windows 靜默啟動腳本
├── .gitignore               # Git 忽略配置
└── README.md                # 本說明文件
```

---

## 🚀 快速啟動

### 1. 安裝環境依賴

平台基於 **Python 3.8+**。請確保已安裝以下套件：

```bash
pip install fastapi uvicorn pillow pydantic python-multipart
```

> 💡 *提示：如需使用 CUDA/GPU 加速診斷或本地訓練，請確保依您的顯卡驅動安裝對應版本的 **PyTorch**。*

### 2. 啟動平台

- **Windows 用戶**：雙擊根目錄的 `start_yolo_ui.bat`，系統會自動在背景啟動服務，並拉起預設瀏覽器開啟平台：[http://127.0.0.1:8000](http://127.0.0.1:8000)。
- **手動命令啟動**：
  ```bash
  python algorithm/yolo_ui/server.py
  ```
  啟動後，手動在瀏覽器中輸入 `http://127.0.0.1:8000`。
