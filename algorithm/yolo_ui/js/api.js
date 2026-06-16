// API 通訊封裝與 Base URL 設定
const API_BASE = "http://127.0.0.1:8000";

const API = {
    // 專案管理
    async createProject(name, inputPath, classes, taskType = "Detection", outputPath = null) {
        return this._post("/api/project/create", {
            project_name: name,
            input_path: inputPath,
            classes: classes,
            task_type: taskType,
            output_path: outputPath
        });
    },

    async getActiveProject() {
        return this._get("/api/project/active");
    },

    async chooseDirectory() {
        return this._get("/api/project/choose_directory");
    },

    async chooseFile() {
        return this._get("/api/project/choose_file");
    },

    async listProjects() {
        return this._get("/api/projects/list");
    },

    async switchProject(inputPath) {
        return this._post("/api/projects/switch", {
            input_path: inputPath
        });
    },

    // 系統與環境
    async checkSystem() {
        return this._get("/api/system/check");
    },

    // 資料集分析與切分
    async checkDataset() {
        return this._get("/api/dataset/check");
    },

    async splitDataset(train, val, test) {
        return this._post("/api/dataset/split", {
            train_ratio: train,
            val_ratio: val,
            test_ratio: test
        });
    },

    async exportDataset() {
        return this._post("/api/dataset/export", {});
    },

    async generateReport() {
        return this._post("/api/report/generate", {});
    },

    // 實驗追蹤
    async listExperiments() {
        return this._get("/api/experiments/list");
    },

    // 模型倉庫
    async listModels() {
        return this._get("/api/models/list");
    },

    async getModelRegistry() {
        return this._get("/api/models/registry");
    },

    async tagModel(modelPath, stage) {
        return this._post("/api/models/tag", {
            model_path: modelPath,
            stage: stage
        });
    },

    // 日誌讀取
    async readLogs() {
        return this._get("/api/logs/read");
    },

    // 資料掃描
    async scanData() {
        return this._get("/api/data/scan");
    },

    async importData(files) {
        const formData = new FormData();
        Array.from(files).forEach(file => formData.append("files", file));

        try {
            const res = await fetch(`${API_BASE}/api/data/import`, {
                method: "POST",
                body: formData
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || "資料匯入失敗");
            }
            return await res.json();
        } catch (error) {
            console.error("POST /api/data/import 出錯:", error);
            throw error;
        }
    },

    // 標籤管理
    async saveLabels(payload) {
        return this._post("/api/labels/save", payload);
    },

    async runAutoLabel(payload) {
        return this._post("/api/autolabel/run", payload);
    },

    // 訓練管理
    async startTrain(payload) {
        return this._post("/api/train/start", payload);
    },

    async getTrainStatus() {
        return this._get("/api/train/status");
    },

    async stopTrain() {
        return this._post("/api/train/stop", {});
    },

    async getTrainedModels() {
        return this._get("/api/transform/models");
    },

    async exportModel(modelPath, format, precision) {
        return this._post("/api/transform/export", {
            model_path: modelPath,
            format: format,
            precision: precision
        });
    },

    async getTransformStatus() {
        return this._get("/api/transform/status");
    },

    async runInference(model, conf, file) {
        const formData = new FormData();
        formData.append("model", model);
        formData.append("conf", conf);
        formData.append("file", file);

        try {
            const res = await fetch(`${API_BASE}/api/inference/run`, {
                method: "POST",
                body: formData
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || "伺服器推論錯誤");
            }
            return await res.json();
        } catch (error) {
            console.error(`POST /api/inference/run 出錯:`, error);
            throw error;
        }
    },

    // 輔助 Fetch 封裝
    async _get(endpoint) {
        try {
            const res = await fetch(`${API_BASE}${endpoint}`);
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || "伺服器錯誤");
            }
            return await res.json();
        } catch (error) {
            console.error(`GET ${endpoint} 出錯:`, error);
            throw error;
        }
    },

    async _post(endpoint, body = {}) {
        try {
            const res = await fetch(`${API_BASE}${endpoint}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(body)
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || "伺服器錯誤");
            }
            return await res.json();
        } catch (error) {
            console.error(`POST ${endpoint} 出錯:`, error);
            throw error;
        }
    }
};
// UI Toast 提示訊息工具
function showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;

    // 限制同時最多顯示 3 個 Toast 訊息，若超過則立即移除最舊的
    while (container.children.length >= 3) {
        container.removeChild(container.firstChild);
    }

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    
    let icon = "fa-circle-info";
    if (type === "success") icon = "fa-circle-check";
    if (type === "error") icon = "fa-circle-exclamation";
    if (type === "warn") icon = "fa-triangle-exclamation";

    toast.innerHTML = `
        <i class="fa-solid ${icon}"></i>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    // 4 秒後自動移除
    setTimeout(() => {
        // 檢查元件是否還存在於容器中 (可能已經因為超出限制而被移除)
        if (toast.parentNode === container) {
            toast.style.animation = "slideInLeft 0.3s ease reverse forwards";
            setTimeout(() => {
                if (toast.parentNode === container) toast.remove();
            }, 300);
        }
    }, 4000);
}
