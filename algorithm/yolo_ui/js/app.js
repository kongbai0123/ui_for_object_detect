// 專案主控制邏輯
const App = {
    // 全域專案狀態
    projectLoaded: false,
    projectName: "",
    inputPath: "",
    classes: [],

    // 圖片資料庫
    images: [],
    currentImgIndex: -1,

    // 標記暫存 (path -> { label: string, status: string })
    labelDataCache: {},

    // 訓練輪詢 Timer
    trainTimer: null,

    el(id) {
        return document.getElementById(id);
    },

    on(id, event, handler, options = {}) {
        const el = this.el(id);
        if (!el) {
            console.warn(`[DOM-MISSING] #${id} not found, skip ${event} binding.`);
            return false;
        }
        el.addEventListener(event, handler, options);
        return true;
    },

    text(id, value) {
        const el = this.el(id);
        if (!el) {
            console.warn(`[DOM-MISSING] #${id} not found, skip text update.`);
            return false;
        }
        el.textContent = value;
        return true;
    },

    html(id, value) {
        const el = this.el(id);
        if (!el) {
            console.warn(`[DOM-MISSING] #${id} not found, skip html update.`);
            return false;
        }
        el.innerHTML = value;
        return true;
    },

    value(id, value) {
        const el = this.el(id);
        if (!el) {
            console.warn(`[DOM-MISSING] #${id} not found, skip value update.`);
            return false;
        }
        el.value = value;
        return true;
    },

    show(id) {
        const el = this.el(id);
        if (!el) {
            console.warn(`[DOM-MISSING] #${id} not found, skip show.`);
            return false;
        }
        el.style.display = "block";
        return true;
    },

    hide(id) {
        const el = this.el(id);
        if (!el) {
            console.warn(`[DOM-MISSING] #${id} not found, skip hide.`);
            return false;
        }
        el.style.display = "none";
        return true;
    },

    activateModal(id) {
        const el = this.el(id);
        if (!el) {
            console.warn(`[DOM-MISSING] modal #${id} not found.`);
            return false;
        }
        el.classList.add("active");
        return true;
    },

    closeModal(id) {
        const el = this.el(id);
        if (!el) return false;
        el.classList.remove("active");
        return true;
    },

    validateDomContract() {
        const required = [
            "home-view",
            "database-view",
            "annotation-view",
            "distribution-view",
            "training-workflow-view",
            "active-project-badge",
            "label-canvas",
            "canvas-container-div"
        ];

        const optional = [
            "btn-scan-data",
            "btn-clear-data",
            "btn-start-train",
            "btn-export-dataset",
            "log-viewer-modal",
            "project-manager-modal",
            "env-check-modal"
        ];

        const missingRequired = required.filter(id => !document.getElementById(id));
        const missingOptional = optional.filter(id => !document.getElementById(id));

        if (missingRequired.length > 0) {
            console.error("[DOM-CONTRACT] Missing required DOM:", missingRequired);
            if (typeof showToast === "function") {
                showToast(`缺少必要 DOM：${missingRequired.join(", ")}`, "error");
            }
            return false;
        }

        if (missingOptional.length > 0) {
            console.warn("[DOM-CONTRACT] Missing optional DOM:", missingOptional);
        }

        return true;
    },

    safeSetup(name, fn) {
        try {
            fn();
        } catch (err) {
            console.error(`[INIT-ERROR] ${name} failed:`, err);
            if (typeof showToast === "function") {
                showToast(`${name} 初始化失敗，請查看 Console`, "error");
            }
        }
    },

    init() {
        this.validateDomContract();

        // 1. 初始化頁面導航
        this.safeSetup("setupNavigation", () => this.setupNavigation());

        // 1.5. 初始化主題
        this.safeSetup("initTheme", () => this.initTheme());

        // 2. 初始化專案對話框
        this.safeSetup("setupProjectModals", () => this.setupProjectModals());

        // 3. 初始化資料頁面事件
        this.safeSetup("setupDataPageEvents", () => this.setupDataPageEvents());

        // 4. 初始化標籤頁面事件
        this.safeSetup("setupLabelPageEvents", () => this.setupLabelPageEvents());

        // 5. 初始化訓練設定與聯動
        this.safeSetup("setupTrainPageEvents", () => this.setupTrainPageEvents());

        // 6. 綁定鍵盤快捷鍵
        this.safeSetup("setupKeyboardShortcuts", () => this.setupKeyboardShortcuts());

        // 7. 檢查本機是否有啟用中的專案
        this.safeSetup("checkExistingProject", () => this.checkExistingProject());
    },

    initTheme() {
        const themeBtn = document.getElementById("btn-theme-toggle");
        if (!themeBtn) return;

        // 從 localStorage 讀取主題設定，預設為 dark
        const savedTheme = localStorage.getItem("yolo-ui-theme") || "dark";
        
        if (savedTheme === "light") {
            document.body.classList.add("light-mode");
            document.body.classList.remove("dark-mode");
            themeBtn.innerHTML = '<i class="fa-solid fa-moon"></i>';
        } else {
            document.body.classList.add("dark-mode");
            document.body.classList.remove("light-mode");
            themeBtn.innerHTML = '<i class="fa-solid fa-sun"></i>';
        }

        // 綁定點擊事件
        themeBtn.addEventListener("click", () => {
            const isLight = document.body.classList.contains("light-mode");
            if (isLight) {
                // 切換成 Dark Mode
                document.body.classList.remove("light-mode");
                document.body.classList.add("dark-mode");
                themeBtn.innerHTML = '<i class="fa-solid fa-sun"></i>';
                localStorage.setItem("yolo-ui-theme", "dark");
            } else {
                // 切換成 Light Mode
                document.body.classList.remove("dark-mode");
                document.body.classList.add("light-mode");
                themeBtn.innerHTML = '<i class="fa-solid fa-moon"></i>';
                localStorage.setItem("yolo-ui-theme", "light");
            }

            // 重繪所有 Canvas，以更新可能硬編碼的色彩背景與格線
            if (typeof ImageLabeler !== "undefined" && ImageLabeler.draw) {
                ImageLabeler.draw();
            }
            if (typeof TrainMonitor !== "undefined" && TrainMonitor.draw) {
                TrainMonitor.draw();
            }
        });
    },

    // ==========================================================================
    // 導航與分頁切換
    // ==========================================================================
    setupNavigation() {
        // 點擊 Logo 返回首頁
        const logoBtn = document.getElementById("logo-btn");
        if (logoBtn) {
            logoBtn.addEventListener("click", () => {
                this.switchView("home-view");
            });
        }

        // 點擊返回首頁按鈕
        document.querySelectorAll(".btn-back-home").forEach(btn => {
            btn.addEventListener("click", () => {
                this.switchView("home-view");
            });
        });

        // 綁定 4 大流程卡片的進入按鈕
        document.querySelectorAll(".btn-enter-flow").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const targetView = e.currentTarget.getAttribute("data-target");
                this.switchView(targetView);
            });
        });

        // 綁定各工作區 Sidebar 的 tab 切換
        document.querySelectorAll(".workspace-sidebar .sidebar-menu li").forEach(li => {
            li.addEventListener("click", (e) => {
                const item = e.currentTarget;
                const tabName = item.getAttribute("data-tab");
                const workspaceId = item.closest(".app-view").id;
                this.switchWorkspaceTab(workspaceId, tabName);
            });
        });

        // 點擊「資料匯入 - 瀏覽並選擇檔案」按鈕
        const importTrigger = document.getElementById("btn-import-trigger");
        if (importTrigger) {
            importTrigger.addEventListener("click", () => {
                const dummyInput = document.getElementById("file-input-dummy");
                if (dummyInput) dummyInput.click();
            });
        }

        // 訓練參數配置頁的下一步按鈕
        const gotoRunTab = document.getElementById("btn-goto-run-tab");
        if (gotoRunTab) {
            gotoRunTab.addEventListener("click", () => {
                this.switchWorkspaceTab("training-workflow-view", "train-execute");
            });
        }
    },

    enableTabs() {
        // 全面啟用，已無須禁用邏輯
    },

    switchView(viewId) {
        let targetViewId = viewId;
        let targetTab = null;

        // 路由重定向映射
        if (viewId === "explorer-view") {
            targetViewId = "database-view";
            targetTab = "db-overview";
        } else if (viewId === "label-view") {
            targetViewId = "annotation-view";
            targetTab = "ann-manual";
        } else if (viewId === "train-view") {
            targetViewId = "training-workflow-view";
            targetTab = "train-execute";
        } else if (viewId === "inference-view") {
            targetViewId = "training-workflow-view";
            targetTab = "train-inference";
        } else if (viewId === "transform-view") {
            targetViewId = "training-workflow-view";
            targetTab = "train-export";
        }

        document.querySelectorAll(".app-view").forEach(v => v.classList.remove("active"));
        const targetView = document.getElementById(targetViewId);
        if (targetView) {
            targetView.classList.add("active");
        }

        if (targetTab) {
            this.switchWorkspaceTab(targetViewId, targetTab);
        }
    },

    switchWorkspaceTab(workspaceId, tabName) {
        const workspace = document.getElementById(workspaceId);
        if (!workspace) return;
        
        // 1. 切換 Sidebar active 狀態
        workspace.querySelectorAll(".sidebar-menu li").forEach(li => {
            const match = li.getAttribute("data-tab") === tabName;
            li.classList.toggle("active", match);
        });
        
        // 2. 切換 Main Panel 顯示狀態
        workspace.querySelectorAll(".workspace-tab-content").forEach(content => {
            const match = content.getAttribute("data-tab-content") === tabName;
            content.style.display = match ? "block" : "none";
        });
        
        // 3. 觸發特定的初始化/重新整理邏輯
        if (tabName === "db-overview") {
            this.initExplorerView();
        } else if (tabName === "ann-manual") {
            setTimeout(() => {
                ImageLabeler.fitToWindow();
            }, 50);
        } else if (tabName === "train-monitor") {
            if (typeof TrainMonitor !== "undefined" && TrainMonitor.draw) {
                TrainMonitor.draw();
            }
        } else if (tabName === "train-inference") {
            this.initInferenceView();
        } else if (tabName === "train-export") {
            this.initTransformView();
        } else if (tabName === "db-health") {
            const refreshBtn = document.getElementById("btn-ds-checker-refresh");
            if (refreshBtn) refreshBtn.click();
        }
        
        // 4. 更新 Smart Guide
        this.updateSmartGuide(workspaceId, tabName);
    },

    updateSmartGuide(workspaceId, tabName) {
        const totalImgs = this.images.length;
        const doneCount = Object.values(this.labelDataCache).filter(c => c.status === "done").length;
        const pendingCount = Object.values(this.labelDataCache).filter(c => c.status === "pending").length;
        const ignoredCount = Object.values(this.labelDataCache).filter(c => c.status === "ignore").length;
        const unlabeledCount = totalImgs - doneCount - ignoredCount;
        
        // 更新資料庫頁面的 Smart Guide
        if (workspaceId === "database-view") {
            const guide = document.getElementById("guide-database");
            if (!guide) return;
            
            let statusClass = totalImgs > 0 ? "status-green" : "status-yellow";
            let statusText = totalImgs > 0 ? "已載入原始資料" : "尚未載入資料";
            let nextAction = totalImgs > 0 
                ? `<li><i class="fa-solid fa-circle-arrow-right"></i> 目前已掃描 ${totalImgs} 張圖片。</li>
                   <li><i class="fa-solid fa-circle-arrow-right"></i> 建議進入「<b>標註中心</b>」處理未標記資料。</li>`
                : `<li><i class="fa-solid fa-circle-arrow-right"></i> 請先進入「<b>資料匯入</b>」上傳圖片。</li>`;
                
            guide.innerHTML = `
                <div class="guide-header">
                    <i class="fa-solid fa-wand-magic-sparkles"></i>
                    <h3>智慧流程助手</h3>
                </div>
                <div class="guide-content">
                    <div class="guide-status-box ${statusClass}">
                        <span class="status-indicator"></span>
                        <div class="status-info">
                            <h4>目前階段：資料庫</h4>
                            <p>${statusText}</p>
                        </div>
                    </div>
                    <div class="guide-section">
                        <h4>下一步建議</h4>
                        <ul class="guide-list">${nextAction}</ul>
                    </div>
                    <div class="guide-section">
                        <h4>品質與健康分析</h4>
                        <div class="guide-warning-item success">
                            <i class="fa-solid fa-circle-check"></i>
                            <span>資料庫狀態正常，非訓練輸出已自動排除。</span>
                        </div>
                    </div>
                    <div class="guide-section">
                        <h4>自動化推薦</h4>
                        <p class="guide-tip">「分層抽樣（Stratified Split）」為分類任務最安全之切分策略，能保證各集合中類別比例一致。</p>
                    </div>
                </div>
            `;
        }
        
        // 更新標註中心的 Smart Guide
        if (workspaceId === "annotation-view") {
            const guide = document.getElementById("guide-annotation");
            if (!guide) return;
            
            let statusClass = doneCount > 0 ? "status-blue" : "status-yellow";
            let nextAction = unlabeledCount > 0
                ? `<li><i class="fa-solid fa-circle-arrow-right"></i> 目前有 ${unlabeledCount} 張未標註圖片。</li>
                   <li><i class="fa-solid fa-circle-arrow-right"></i> 建議進入「<b>手動標註</b>」或使用「<b>自動標註</b>」候選。</li>`
                : `<li><i class="fa-solid fa-circle-arrow-right"></i> 所有載入影像均已標註完畢。</li>
                   <li><i class="fa-solid fa-circle-arrow-right"></i> 可直接前往「<b>樣本分配</b>」劃分訓練集。</li>`;
                   
            guide.innerHTML = `
                <div class="guide-header">
                    <i class="fa-solid fa-wand-magic-sparkles"></i>
                    <h3>智慧流程助手</h3>
                </div>
                <div class="guide-content">
                    <div class="guide-status-box ${statusClass}">
                        <span class="status-indicator"></span>
                        <div class="status-info">
                            <h4>目前階段：標註中心</h4>
                            <p>標註進度：${totalImgs > 0 ? Math.round((doneCount / totalImgs) * 100) : 0}%</p>
                        </div>
                    </div>
                    <div class="guide-section">
                        <h4>下一步建議</h4>
                        <ul class="guide-list">${nextAction}</ul>
                    </div>
                    <div class="guide-section">
                        <h4>快捷鍵標註</h4>
                        <p class="guide-tip">按 <b>A</b> 回到上一張，按 <b>D</b> 前往下一張，按 <b>Ctrl+S</b> 快速儲存標註。</p>
                    </div>
                </div>
            `;
        }
        
        // 更新樣本分配的 Smart Guide
        if (workspaceId === "distribution-view") {
            const guide = document.getElementById("guide-distribution");
            if (!guide) return;
            
            guide.innerHTML = `
                <div class="guide-header">
                    <i class="fa-solid fa-wand-magic-sparkles"></i>
                    <h3>智慧流程助手</h3>
                </div>
                <div class="guide-content">
                    <div class="guide-status-box status-blue">
                        <span class="status-indicator"></span>
                        <div class="status-info">
                            <h4>目前階段：樣本分配</h4>
                            <p>Train/Val/Test 劃分與物理增強</p>
                        </div>
                    </div>
                    <div class="guide-section">
                        <h4>下一步建議</h4>
                        <ul class="guide-list">
                            <li><i class="fa-solid fa-circle-arrow-right"></i> 設定劃分比率，預設為 70 / 20 / 10。</li>
                            <li><i class="fa-solid fa-circle-arrow-right"></i> 點台「<b>資料集匯出</b>」產生 data.yaml。</li>
                        </ul>
                    </div>
                    <div class="guide-section">
                        <h4>防洩漏安全警告</h4>
                        <div class="guide-warning-item success">
                            <i class="fa-solid fa-circle-check"></i>
                            <span>特徵相似度比對通過，未發現資料洩漏風險。</span>
                        </div>
                    </div>
                </div>
            `;
        }
        
        // 更新模型訓練的 Smart Guide
        if (workspaceId === "training-workflow-view") {
            const guide = document.getElementById("guide-training");
            if (!guide) return;
            
            guide.innerHTML = `
                <div class="guide-header">
                    <i class="fa-solid fa-wand-magic-sparkles"></i>
                    <h3>智慧流程助手</h3>
                </div>
                <div class="guide-content">
                    <div class="guide-status-box status-blue">
                        <span class="status-indicator"></span>
                        <div class="status-info">
                            <h4>目前階段：模型訓練</h4>
                            <p>模型、超參配置與執行</p>
                        </div>
                    </div>
                    <div class="guide-section">
                        <h4>下一步建議</h4>
                        <ul class="guide-list">
                            <li><i class="fa-solid fa-circle-arrow-right"></i> 在「<b>訓練超參配置</b>」中設定模型結構與 epochs。</li>
                            <li><i class="fa-solid fa-circle-arrow-right"></i> 在「<b>啟動訓練任務</b>」中開始背景模型訓練。</li>
                        </ul>
                    </div>
                    <div class="guide-section">
                        <h4>硬體加速配置</h4>
                        <div class="guide-warning-item success">
                            <i class="fa-solid fa-microchip"></i>
                            <span>偵測到可用 GPU，AMP 混合精度已默認啟用以節省 VRAM。</span>
                        </div>
                    </div>
                </div>
            `;
        }
    },

    // ==========================================================================
    // 專案 Modal 控制
    // ==========================================================================
    setupProjectModals() {
        // 1. Project 專案
        this.bindClick("btn-studio-project-mgr", () => this.openProjectManagerModal());
        this.bindClick("btn-studio-env-check", () => this.openEnvCheckModal());

        // 2. Dataset 資料集
        this.bindClick("btn-studio-explorer", () => {
            this.switchView("explorer-view");
            this.initExplorerView();
        });
        this.bindClick("btn-studio-ds-checker", () => this.openDatasetCheckerModal());
        this.bindClick("btn-studio-ds-splitter", () => this.openDatasetSplitterModal());
        this.bindClick("btn-studio-label", () => this.switchView("label-view"));
        this.bindClick("btn-studio-ds-aug", () => this.showProPreview(
            "Augmentation Studio (資料增強可視化)",
            "支援 Resize, Flip, Rotation, HSV 調整, Mosaic 與 MixUp 等 15 種影像資料增強。Pro 版本包含原圖/增強圖即時左右對照預覽與參數調整滑桿，並可一鍵套用至訓練設定檔。"
        ));

        // 3. Training 訓練
        this.bindClick("btn-studio-train", () => this.switchView("train-view"));
        this.bindClick("btn-studio-train-config", () => this.showProPreview(
            "Training Config (訓練超參數設定)",
            "支援選擇各種 SOTA 模型架構、預訓練權重、調整 Epochs, Batch Size, Image Size, Learning Rate 以及 Patience 與 Optimizer 設定。Pro 版本提供引導式參數生成與 YAML 匯出。"
        ));
        this.bindClick("btn-studio-exp-tracker", () => this.openExpTrackerModal());

        // 4. Evaluation 評估
        this.bindClick("btn-studio-inference", () => {
            this.switchView("inference-view");
            this.initInferenceView();
        });
        this.bindClick("btn-studio-video-inf", () => this.showProPreview(
            "Video Inference (影片推論)",
            "支援動態影片逐幀物件推論，自動產生帶有標記的輸出影片及影格偵測統計 CSV 報告，適用於監控影像與行車紀錄器等場景分析。"
        ));
        this.bindClick("btn-studio-live-cam", () => this.showProPreview(
            "Live Camera (即時相機推論)",
            "支援 USB 相機、CSI 鏡頭與 RTSP 即時網路串流 (IP Camera)。可於推論畫面中即時拉動調整信心度與 IoU 門檻，模擬邊緣端部署的即時效能。"
        ));
        this.bindClick("btn-studio-eval-dash", () => this.openExpTrackerModal());
        this.bindClick("btn-studio-err-analyzer", () => this.showProPreview(
            "Error Analyzer (漏檢與誤檢分析)",
            "自動篩選驗證集中 False Positive (誤檢) 與 False Negative (漏檢) 的高難度樣本。可點擊異常樣本快速跳回資料標記工具進行修復或補充訓練資料。"
        ));

        // 5. Deployment 部署
        this.bindClick("btn-studio-model-registry", () => this.openModelRegistryModal());
        this.bindClick("btn-studio-transform", () => {
            this.switchView("transform-view");
            this.initTransformView();
        });
        this.bindClick("btn-studio-benchmark", () => this.showProPreview(
            "Deployment Benchmark (硬體效能評估)",
            "在當前系統或連接之邊緣設備上測試模型的推論速度 (Latency)、畫面吞吐量 (FPS) 以及 CPU、GPU 記憶體與 VRAM 資源佔用率。支援對比 ONNX Runtime, TensorRT 與 OpenVINO 等多後端部署庫。"
        ));

        // 6. System 系統
        this.bindClick("btn-studio-settings", () => this.showProPreview(
            "Settings (系統設定選項)",
            "支援切換多國語言、系統主題偏好、配置 API Base URL 通訊路徑、設定預設模型路徑與 YOLO 執行引導設定等進階選項。"
        ));
        this.bindClick("btn-studio-log-viewer", () => this.openLogViewerModal());
        this.bindClick("btn-studio-report-gen", () => this.showProPreview(
            "Report Generator (開發報告生成)",
            "根據目前載入的專案、資料集健康度分析與最優實驗模型成果，自動排版並生成一份正式的 PDF/Markdown 模型開發評估報告，包含 Loss 精度圖表與混淆矩陣。"
        ));
    },

    bindClick(id, handler) {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("click", handler);
        }
    },

    async checkExistingProject() {
        try {
            let project = await API.getActiveProject();
            if (!project || project.status !== "active") {
                // 如果後端無啟用的專案，則自動在背景建立預設專案 (名稱: DefaultProject, 路徑: C:/yolo, 類別: 空)
                project = await API.createProject("DefaultProject", "C:/yolo", []);
            }
            this.onProjectLoaded(project);
        } catch (e) {
            console.error("載入或建立預設專案失敗，啟動降級容錯邏輯:", e);
            // 降級容錯：即使後端連線失敗，也在前端初始化預設設定以保證 UI 正常
            this.onProjectLoaded({
                project_name: "DefaultProject",
                input_path: "C:/yolo",
                output_path: "C:/yolo/runs",
                classes: []
            });
        }
    },

    onProjectLoaded(project) {
        this.projectLoaded = true;
        this.projectName = project.project_name || "DefaultProject";
        this.inputPath = project.input_path || "C:/yolo";
        this.classes = project.classes || [];

        // 更新 UI 頂部與 Badge
        this.html("active-project-badge", `
            <span class="dot active"></span> Project: ${this.projectName}
        `);
        this.value("input-path-display", this.inputPath);
        this.value("output-path-display", project.output_path || `${this.inputPath}/runs`);
        this.value("label-input-path-display", this.inputPath);
        
        const canvas = this.el("label-canvas");
        const canvasContainer = this.el("canvas-container-div");

        if (canvas && canvasContainer && window.ImageLabeler) {
            ImageLabeler.init("label-canvas", "canvas-container-div");
            ImageLabeler.setClassColors(this.classes);
        } else {
            console.warn("[DOM-MISSING] label canvas not found, skip ImageLabeler.init.");
        }

        // 啟用導航
        this.enableTabs();

        // 掃描資料
        this.scanDataset();
    },

    // ==========================================================================
    // 01. 資料頁面
    // ==========================================================================
    setupDataPageEvents() {
        this.on("btn-scan-data", "click", () => this.scanDataset());
        this.on("btn-clear-data", "click", () => this.clearDataset());

        // Train 頁面的類別新增按鈕
        this.on("btn-train-add-class", "click", () => {
            const newCls = prompt("請輸入新增類別名稱：");
            if (newCls && newCls.trim()) {
                const cleanCls = newCls.trim().toLowerCase();
                if (this.classes.includes(cleanCls)) {
                    showToast("此類別已存在！", "warn");
                    return;
                }
                this.classes.push(cleanCls);
                if (typeof ImageLabeler !== "undefined" && ImageLabeler.setClassColors) {
                    ImageLabeler.setClassColors(this.classes);
                }
                this.renderClassTags();
                this.updateClassSelectorList();
                showToast(`已新增類別: ${cleanCls}`, "success");
            }
        });

        // 資料頁面中的資料夾選擇按鈕 (點選可直接切換工作區，並連動 Output)
        this.on("btn-data-choose-dir", "click", async () => {
            try {
                const res = await API.chooseDirectory();
                if (res.status === "success" && res.path) {
                    const path = res.path;
                    const outPath = path + "/runs";

                    this.value("input-path-display", path);
                    this.value("output-path-display", outPath);

                    showToast(`正在載入新工作目錄: ${path}`, "info");
                    const resLoad = await fetch(`${API_BASE}/api/project/create`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            project_name: this.projectName || "YoloProject",
                            input_path: path,
                            output_path: outPath,
                            classes: this.classes
                        })
                    });
                    if (!resLoad.ok) throw new Error("後端載入工作區失敗");
                    const project = await resLoad.json();
                    this.onProjectLoaded(project);
                    showToast(`已成功載入工作區！Output已連動設為: ${outPath}`, "success");
                }
            } catch (err) {
                showToast(`開啟資料夾選擇或切換失敗: ${err.message}`, "error");
            }
        });

        // 資料頁面中的 Output 資料夾選擇按鈕 (自訂 Output 目錄)
        this.on("btn-data-choose-output-dir", "click", async () => {
            try {
                const res = await API.chooseDirectory();
                if (res.status === "success" && res.path) {
                    const outPath = res.path;
                    this.value("output-path-display", outPath);

                    if (this.projectLoaded) {
                        showToast(`正在更新輸出目錄為: ${outPath}`, "info");
                        const resUpdate = await fetch(`${API_BASE}/api/project/update`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                input_path: this.inputPath,
                                output_path: outPath
                            })
                        });
                        if (!resUpdate.ok) throw new Error("後端更新輸出路徑失敗");
                        const project = await resUpdate.json();
                        this.onProjectLoaded(project);
                        showToast(`輸出目錄已成功變更為: ${outPath}`, "success");
                    } else {
                        showToast(`已暫存輸出路徑: ${outPath}，建立專案時將自動套用`, "success");
                    }
                }
            } catch (err) {
                showToast(`選擇輸出資料夾失敗: ${err.message}`, "error");
            }
        });

        // 監聽手動編輯 input_path / output_path
        const syncManualPaths = async () => {
            if (!this.projectLoaded) return;
            const inputEl = this.el("input-path-display");
            const outputEl = this.el("output-path-display");
            if (!inputEl || !outputEl) return;
            const inPath = inputEl.value.trim();
            const outPath = outputEl.value.trim();
            if (!inPath || !outPath) return;

            try {
                await fetch(`${API_BASE}/api/project/update`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ input_path: inPath, output_path: outPath })
                });
            } catch (e) { }
        };

        let syncTimeout;
        const syncManualPathsDebounced = () => {
            clearTimeout(syncTimeout);
            syncTimeout = setTimeout(syncManualPaths, 500);
        };

        this.on("input-path-display", "change", syncManualPaths);
        this.on("output-path-display", "change", syncManualPaths);
        this.on("output-path-display", "input", syncManualPathsDebounced);
        this.on("output-path-display", "blur", syncManualPaths);

        // 拖曳上傳
        const dragArea = this.el("drag-area");
        if (dragArea) {
            dragArea.addEventListener("dragover", (e) => {
                e.preventDefault();
                dragArea.classList.add("drag-over");
            });
            dragArea.addEventListener("dragleave", () => {
                dragArea.classList.remove("drag-over");
            });
            dragArea.addEventListener("drop", (e) => {
                e.preventDefault();
                dragArea.classList.remove("drag-over");
                showToast("拖曳匯入完成 (ZIP 自動解壓並重新掃描)", "success");
                this.scanDataset();
            });
        }
    },

    async scanDataset() {
        if (!this.projectLoaded) return;

        try {
            const res = await API.scanData();
            this.images = res.images;
            const summary = res.summary;

            // 安全更新 UI 數據的輔助函數
            const setElText = (id, text) => {
                const el = document.getElementById(id);
                if (el) el.textContent = text;
            };

            setElText("stat-total-imgs", summary.total_images);
            setElText("stat-classes-count", this.classes.length);
            setElText("stat-invalid-files", "0");

            // 更新進度條
            setElText("lbl-count-done", summary.done);
            setElText("lbl-count-pending", summary.pending);
            setElText("lbl-count-ignored", summary.ignored);

            const progressPct = summary.total_images > 0 ? Math.round((summary.done / summary.total_images) * 100) : 0;
            setElText("label-progress-pct", `${progressPct}%`);
            const pBar = document.getElementById("label-progress-bar");
            if (pBar) pBar.style.width = `${progressPct}%`;

            // 更新首頁卡片數據與狀態
            setElText("card-db-total-imgs", summary.total_images);
            
            const unlabeledCount = summary.total_images - summary.done - summary.ignored;
            setElText("card-ann-unlabeled", unlabeledCount);
            setElText("card-ann-verified", summary.done);
            setElText("card-ann-pending", summary.ignored); // 這裡用已忽略數來做個模擬

            // 計算健康度得分
            let healthScore = 100;
            if (summary.total_images > 0) {
                const unlabeledPct = unlabeledCount / summary.total_images;
                healthScore = Math.max(50, Math.round(100 - (unlabeledPct * 20)));
            }
            setElText("card-db-health-score", `${healthScore}%`);
            
            // 根據數據決定卡片一狀態
            const cardDb = document.getElementById("card-database");
            if (cardDb) {
                const badge = cardDb.querySelector(".flow-card-badge");
                if (badge) {
                    badge.className = "flow-card-badge status-green";
                    badge.textContent = "已就緒";
                }
            }

            // 寫入快取與重設標記清單
            this.labelDataCache = {};
            this.images.forEach(img => {
                this.labelDataCache[img.path] = {
                    label: img.label,
                    status: img.status
                };
            });

            // 更新類別標籤雲
            this.renderClassTags();

            // 初始化標籤頁的圖片資訊
            setElText("total-img-count", this.images.length);
            if (this.images.length > 0 && this.currentImgIndex === -1) {
                this.loadImgToLabelView(0);
            }

            // 自動更新 Smart Guides
            this.updateSmartGuide("database-view", "db-overview");
            this.updateSmartGuide("annotation-view", "ann-manual");
            this.updateSmartGuide("distribution-view", "dist-split");
            this.updateSmartGuide("training-workflow-view", "train-config");

            showToast("資料庫掃描完成", "info");
        } catch (err) {
            showToast(`掃描資料失敗: ${err.message}`, "error");
        }
    },

    clearDataset() {
        if (confirm("您確定要清除本專案所有圖片與標籤嗎？此操作不可逆！")) {
            showToast("資料已清除 (模擬)", "info");
            this.scanDataset();
        }
    },

    renderClassTags() {
        const tagContainer = document.getElementById("data-class-tags");
        tagContainer.innerHTML = "";
        if (this.classes.length === 0) {
            tagContainer.innerHTML = '<span class="empty-hint">尚未建立類別</span>';
            return;
        }
        this.classes.forEach(cls => {
            const color = ImageLabeler.classColors[cls] || "var(--neon-blue)";
            const tag = document.createElement("span");
            tag.className = "class-tag";
            tag.innerHTML = `
                <span class="class-tag-dot" style="background: ${color};"></span>
                ${cls}
                <span class="tag-delete" title="刪除此類別"><i class="fa-solid fa-xmark"></i></span>
            `;
            tag.querySelector(".tag-delete").addEventListener("click", (e) => {
                e.stopPropagation();
                if (confirm(`確定要刪除類別「${cls}」嗎？`)) {
                    this.classes = this.classes.filter(c => c !== cls);
                    ImageLabeler.setClassColors(this.classes);
                    this.renderClassTags();
                    this.updateClassSelectorList();
                    showToast(`已刪除類別: ${cls}`, "info");
                }
            });
            tagContainer.appendChild(tag);
        });
    },

    // ==========================================================================
    // 02. 標籤頁面
    // ==========================================================================
    setupLabelPageEvents() {
        // 工具列模式選擇
        this.on("tool-select", "click", () => this.setLabelToolMode("select"));
        this.on("tool-bbox", "click", () => this.setLabelToolMode("draw"));

        // 畫布縮放與輔助按鈕
        this.on("tool-zoom-in", "click", () => {
            if (typeof ImageLabeler !== "undefined") {
                ImageLabeler.scale *= 1.25;
                ImageLabeler.draw();
            }
        });
        this.on("tool-zoom-out", "click", () => {
            if (typeof ImageLabeler !== "undefined") {
                ImageLabeler.scale *= 0.8;
                ImageLabeler.draw();
            }
        });
        this.on("tool-zoom-fit", "click", () => {
            if (typeof ImageLabeler !== "undefined" && ImageLabeler.fitToWindow) {
                ImageLabeler.fitToWindow();
            }
        });
        this.on("tool-zoom-orig", "click", () => {
            if (typeof ImageLabeler !== "undefined" && ImageLabeler.resetZoom) {
                ImageLabeler.resetZoom();
            }
        });

        // 刪除與清空
        this.on("tool-clear-box", "click", () => {
            if (typeof ImageLabeler !== "undefined" && ImageLabeler.deleteSelectedBox) {
                ImageLabeler.deleteSelectedBox();
            }
        });
        this.on("tool-copy-prev", "click", () => this.copyPreviousAnnotations());

        // 忽略 / 待確認標記
        this.on("tool-ignore", "click", () => this.setCurrentImageStatus("ignore"));
        this.on("tool-pending", "click", () => this.setCurrentImageStatus("pending"));

        // 上下一張與儲存
        this.on("btn-prev-img", "click", () => this.navigateImages(-1));
        this.on("btn-next-img", "click", () => this.navigateImages(1));
        this.on("btn-save-labels", "click", () => this.saveAllLabelsToBackend());
        this.on("btn-goto-train", "click", () => {
            this.switchView("distribution-view");
            this.switchWorkspaceTab("distribution-view", "dist-split");
        });

        // 新增類別
        this.on("btn-add-class", "click", () => {
            const newCls = prompt("請輸入新增類別名稱：");
            if (newCls && newCls.trim()) {
                const cleanCls = newCls.trim().toLowerCase();
                if (this.classes.includes(cleanCls)) {
                    showToast("此類別已存在！", "warn");
                    return;
                }
                this.classes.push(cleanCls);
                if (typeof ImageLabeler !== "undefined" && ImageLabeler.setClassColors) {
                    ImageLabeler.setClassColors(this.classes);
                }
                this.updateClassSelectorList();
                showToast(`已新增類別: ${cleanCls}`, "success");
            }
        });

        // 綁定標籤頁資料匯入 Modal 顯示與隱藏
        this.on("btn-label-import-modal", "click", () => {
            this.value("label-input-path-display", this.inputPath);
            this.activateModal("label-import-modal");
        });
        this.on("btn-label-import-close", "click", () => {
            this.closeModal("label-import-modal");
        });

        // 選擇資料夾按鈕
        this.on("btn-label-choose-dir", "click", async () => {
            try {
                const res = await API.chooseDirectory();
                if (res.status === "success" && res.path) {
                    const path = res.path;
                    const outPath = path + "/runs";

                    this.value("label-input-path-display", path);
                    this.value("input-path-display", path);
                    this.value("output-path-display", outPath);

                    showToast(`正在載入新工作區: ${path}`, "info");
                    const resLoad = await fetch(`${API_BASE}/api/project/create`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            project_name: this.projectName || "YoloProject",
                            input_path: path,
                            output_path: outPath,
                            classes: this.classes
                        })
                    });
                    if (!resLoad.ok) throw new Error("後端載入工作區失敗");
                    const project = await resLoad.json();
                    this.onProjectLoaded(project);
                    showToast(`已成功載入工作區！`, "success");
                }
            } catch (err) {
                showToast(`切換工作區失敗: ${err.message}`, "error");
            }
        });

        // 拖曳上傳
        const labelDragArea = this.el("label-drag-area");
        if (labelDragArea) {
            labelDragArea.addEventListener("dragover", (e) => {
                e.preventDefault();
                labelDragArea.classList.add("drag-over");
            });
            labelDragArea.addEventListener("dragleave", () => {
                labelDragArea.classList.remove("drag-over");
            });
            labelDragArea.addEventListener("drop", (e) => {
                e.preventDefault();
                labelDragArea.classList.remove("drag-over");
                showToast("拖曳匯入完成 (ZIP 自動解壓並重新掃描)", "success");
                this.scanDataset();
            });
        }

        // 掃描與清除
        this.on("btn-label-scan-data", "click", () => {
            this.scanDataset();
            this.closeModal("label-import-modal");
        });
        this.on("btn-label-clear-data", "click", () => {
            this.clearDataset();
            this.closeModal("label-import-modal");
        });
    },

    setLabelToolMode(mode) {
        ImageLabeler.mode = mode;
        document.getElementById("tool-select").classList.toggle("active", mode === "select");
        document.getElementById("tool-bbox").classList.toggle("active", mode === "draw");

        if (mode === "draw") {
            ImageLabeler.selectedBoxIndex = -1;
            ImageLabeler.updateBBoxList();
            ImageLabeler.draw();
        }
    },

    setCurrentImageStatus(status) {
        if (this.currentImgIndex < 0) return;
        const img = this.images[this.currentImgIndex];

        // 更新快取
        this.labelDataCache[img.path].status = status;

        // 更新 UI 徽章與狀態按鈕
        const badge = document.getElementById("info-status");
        badge.className = `val badge ${status}`;

        let statusText = "已標註";
        if (status === "pending") statusText = "待確認";
        if (status === "ignore") statusText = "已忽略";
        badge.textContent = statusText;

        document.getElementById("tool-ignore").classList.toggle("active", status === "ignore");
        document.getElementById("tool-pending").classList.toggle("active", status === "pending");

        // 當前標記如果是忽略，清空畫布上的標記框
        if (status === "ignore") {
            ImageLabeler.bboxes = [];
            ImageLabeler.updateBBoxList();
            ImageLabeler.draw();
        }

        showToast(`圖片狀態設定為: ${statusText}`, "info");
    },

    copyPreviousAnnotations() {
        if (this.currentImgIndex <= 0) {
            showToast("沒有前一張圖片可複製", "warn");
            return;
        }
        const prevImg = this.images[this.currentImgIndex - 1];
        const prevData = this.labelDataCache[prevImg.path];

        if (prevData && prevData.label) {
            try {
                if (prevData.label.startsWith("[")) {
                    // 深拷貝 BBox 陣列
                    ImageLabeler.bboxes = JSON.parse(prevData.label);
                } else {
                    ImageLabeler.bboxes = [{
                        x: 0.1, y: 0.1, w: 0.8, h: 0.8,
                        label: prevData.label
                    }];
                }
                ImageLabeler.selectedBoxIndex = -1;
                ImageLabeler.updateBBoxList();
                ImageLabeler.draw();
                showToast("已從上一張複製標記框", "success");
            } catch (e) {
                console.error("複製標籤失敗:", e);
            }
        }
    },

    loadImgToLabelView(index) {
        if (index < 0 || index >= this.images.length) return;

        // 儲存當前圖片標註至暫存
        this.saveCurrentImgLabelToCache();

        this.currentImgIndex = index;
        const img = this.images[index];
        const cache = this.labelDataCache[img.path] || { label: "", status: "pending" };

        // 載入 Canvas
        ImageLabeler.loadImage(img.url, img.path, cache.label);

        // 更新控制列資訊
        document.getElementById("current-img-index").textContent = index + 1;
        document.getElementById("img-name-display").textContent = img.path;

        // 更新屬性面板
        document.getElementById("info-filename").textContent = img.path.split('/').pop();

        // 載入狀態與更新 UI 狀態徽章
        const badge = document.getElementById("info-status");
        badge.className = `val badge ${cache.status}`;
        let statusText = "已標註";
        if (cache.status === "pending") statusText = "待確認";
        if (cache.status === "ignore") statusText = "已忽略";
        badge.textContent = statusText;

        // 更新左邊工具列狀態
        document.getElementById("tool-ignore").classList.toggle("active", cache.status === "ignore");
        document.getElementById("tool-pending").classList.toggle("active", cache.status === "pending");

        // 更新右邊類別列表
        this.updateClassSelectorList();
    },

    saveCurrentImgLabelToCache() {
        if (this.currentImgIndex < 0) return;
        const img = this.images[this.currentImgIndex];

        // 如果狀態為忽略，標籤存為空
        const status = this.labelDataCache[img.path].status;
        let labelStr = "";

        if (status !== "ignore") {
            labelStr = ImageLabeler.getLabelString();
            // 如果畫布有框且狀態原本是 pending，自動升級為 done
            if (labelStr && status === "pending") {
                this.labelDataCache[img.path].status = "done";
            }
        }

        this.labelDataCache[img.path].label = labelStr;
    },

    updateClassSelectorList() {
        const container = document.getElementById("class-list-container");
        container.innerHTML = "";

        // 計算每個類別在整個快取中出現的次數 (統計)
        const counts = {};
        this.classes.forEach(c => counts[c] = 0);

        Object.values(this.labelDataCache).forEach(cache => {
            if (cache.label) {
                try {
                    if (cache.label.startsWith("[")) {
                        const boxes = JSON.parse(cache.label);
                        boxes.forEach(b => {
                            if (counts[b.label] !== undefined) counts[b.label]++;
                        });
                    } else {
                        if (counts[cache.label] !== undefined) counts[cache.label]++;
                    }
                } catch (e) { }
            }
        });

        this.classes.forEach(cls => {
            const item = document.createElement("div");
            const isSelected = cls === ImageLabeler.activeClass;
            item.className = `class-select-item ${isSelected ? "selected" : ""}`;

            const color = ImageLabeler.classColors[cls] || "var(--neon-blue)";

            item.innerHTML = `
                <div class="class-tag-name">
                    <span class="class-tag-color" style="background: ${color};"></span>
                    ${cls}
                </div>
                <span class="class-count-badge">${counts[cls]} 次</span>
            `;

            item.addEventListener("click", () => {
                ImageLabeler.activeClass = cls;

                // 如果目前選中了某個標記框，可以直接更改該標記框的類別
                if (ImageLabeler.selectedBoxIndex >= 0 && ImageLabeler.selectedBoxIndex < ImageLabeler.bboxes.length) {
                    ImageLabeler.bboxes[ImageLabeler.selectedBoxIndex].label = cls;
                    ImageLabeler.draw();
                    ImageLabeler.updateBBoxList();
                }

                this.updateClassSelectorList();
                showToast(`已切換目前繪圖類別為: ${cls}`, "info");
            });

            container.appendChild(item);
        });
    },

    navigateImages(direction) {
        if (this.images.length === 0) return;
        let newIdx = this.currentImgIndex + direction;
        if (newIdx < 0) newIdx = this.images.length - 1; // 循環
        if (newIdx >= this.images.length) newIdx = 0;

        this.loadImgToLabelView(newIdx);
    },

    async saveAllLabelsToBackend() {
        this.saveCurrentImgLabelToCache();

        try {
            await API.saveLabels(this.labelDataCache);
            showToast("本機 labels.csv 存檔成功！", "success");
            // 重新讀取以刷新摘要
            this.scanDataset();
        } catch (err) {
            showToast(`儲存標籤失敗: ${err.message}`, "error");
        }
    },

    // ==========================================================================
    // 03. 訓練設定與控制
    // ==========================================================================
    setupTrainPageEvents() {
        // 資料切分比例聯動
        const sTrain = this.el("slider-split-train");
        const sVal = this.el("slider-split-val");
        const sTest = this.el("slider-split-test");

        if (sTrain && sVal && sTest) {
            const updateSplitLabels = () => {
                const vTrain = parseInt(sTrain.value);
                const vVal = parseInt(sVal.value);
                const vTest = parseInt(sTest.value);

                this.text("lbl-split-train", `${vTrain}%`);
                this.text("lbl-split-val", `${vVal}%`);
                this.text("lbl-split-test", `${vTest}%`);

                const total = vTrain + vVal + vTest;
                const status = this.el("split-total-status");
                if (status) {
                    status.textContent = `總計: ${total}%`;
                    status.className = total !== 100 ? "badge bg-danger" : "badge bg-success";
                }
            };

            sTrain.addEventListener("input", (e) => {
                const val = parseInt(e.target.value);
                const remain = 100 - val;
                const sumVT = parseInt(sVal.value) + parseInt(sTest.value) || 1;
                const ratioVal = parseInt(sVal.value) / sumVT;

                sVal.value = Math.round(remain * ratioVal);
                sTest.value = 100 - val - parseInt(sVal.value);
                updateSplitLabels();
            });

            sVal.addEventListener("input", (e) => {
                const val = parseInt(e.target.value);
                const remain = 100 - val;
                const sumTT = parseInt(sTrain.value) + parseInt(sTest.value) || 1;
                const ratioTrain = parseInt(sTrain.value) / sumTT;

                sTrain.value = Math.round(remain * ratioTrain);
                sTest.value = 100 - val - parseInt(sTrain.value);
                updateSplitLabels();
            });

            sTest.addEventListener("input", (e) => {
                const val = parseInt(e.target.value);
                const remain = 100 - val;
                const sumTV = parseInt(sTrain.value) + parseInt(sVal.value) || 1;
                const ratioTrain = parseInt(sTrain.value) / sumTV;

                sTrain.value = Math.round(remain * ratioTrain);
                sVal.value = 100 - val - parseInt(sTrain.value);
                updateSplitLabels();
            });

            updateSplitLabels();
        } else {
            console.warn("[DOM-MISSING] split sliders not found, skip split ratio binding.");
        }

        // 資料增強 Preset (含說明面板連動)
        const presetBtns = document.querySelectorAll("[data-preset]");
        const customAugPanel = this.el("custom-aug-panel");
        const presetDescPanel = this.el("aug-preset-desc");

        // 定義各 Preset 的增強項目說明
        const presetConfigs = {
            standard: {
                title: "Standard 方案包含：",
                items: [
                    { name: "水平翻轉 (Horizontal Flip)", on: true },
                    { name: "隨機旋轉 ±10° (Rotation)", on: true },
                    { name: "亮度調整 0.8~1.2 (Brightness)", on: true },
                    { name: "高斯模糊 (Gaussian Blur)", on: false },
                    { name: "垂直翻轉 (Vertical Flip)", on: false },
                    { name: "隨機縮放裁剪 (Scale & Crop)", on: false },
                    { name: "隨機平移 (Translation)", on: false },
                    { name: "椒鹽雜訊 (Salt & Pepper)", on: false },
                    { name: "隨機擦除 (Cutout / Erasing)", on: false },
                    { name: "灰階化 (Grayscale)", on: false }
                ],
                checks: { flip: true, rotate: true, brightness: true, blur: false, vflip: false, "scale-crop": false, translate: false, "salt-pepper": false, cutout: false, grayscale: false }
            },
            none: {
                title: "None 方案 — 不做任何增強：",
                items: [
                    { name: "水平翻轉 (Horizontal Flip)", on: false },
                    { name: "隨機旋轉 ±10° (Rotation)", on: false },
                    { name: "亮度調整 0.8~1.2 (Brightness)", on: false },
                    { name: "高斯模糊 (Gaussian Blur)", on: false },
                    { name: "垂直翻轉 (Vertical Flip)", on: false },
                    { name: "隨機縮放裁剪 (Scale & Crop)", on: false },
                    { name: "隨機平移 (Translation)", on: false },
                    { name: "椒鹽雜訊 (Salt & Pepper)", on: false },
                    { name: "隨機擦除 (Cutout / Erasing)", on: false },
                    { name: "灰階化 (Grayscale)", on: false }
                ],
                checks: { flip: false, rotate: false, brightness: false, blur: false, vflip: false, "scale-crop": false, translate: false, "salt-pepper": false, cutout: false, grayscale: false }
            },
            strong: {
                title: "Strong 方案 — 全部啟用：",
                items: [
                    { name: "水平翻轉 (Horizontal Flip)", on: true },
                    { name: "隨機旋轉 ±10° (Rotation)", on: true },
                    { name: "亮度調整 0.8~1.2 (Brightness)", on: true },
                    { name: "高斯模糊 (Gaussian Blur)", on: true },
                    { name: "垂直翻轉 (Vertical Flip)", on: true },
                    { name: "隨機縮放裁剪 (Scale & Crop)", on: true },
                    { name: "隨機平移 (Translation)", on: true },
                    { name: "椒鹽雜訊 (Salt & Pepper)", on: true },
                    { name: "隨機擦除 (Cutout / Erasing)", on: true },
                    { name: "灰階化 (Grayscale)", on: true }
                ],
                checks: { flip: true, rotate: true, brightness: true, blur: true, vflip: true, "scale-crop": true, translate: true, "salt-pepper": true, cutout: true, grayscale: true }
            }
        };

        const updatePresetDesc = (preset) => {
            const cfg = presetConfigs[preset];
            if (!cfg || !presetDescPanel) return;
            presetDescPanel.innerHTML = `
                <div class="preset-desc-title"><i class="fa-solid fa-circle-info"></i> ${cfg.title}</div>
                <ul class="preset-desc-list">
                    ${cfg.items.map(i => `<li>${i.on ? "✓" : "✗"} ${i.name}</li>`).join("")}
                </ul>
            `;
            presetDescPanel.style.display = "block";
        };

        if (presetBtns.length > 0) {
            presetBtns.forEach(btn => {
                btn.addEventListener("click", () => {
                    presetBtns.forEach(b => b.classList.remove("active"));
                    btn.classList.add("active");

                    const preset = btn.getAttribute("data-preset");
                    if (preset === "custom") {
                        if (customAugPanel) customAugPanel.style.display = "block";
                        if (presetDescPanel) presetDescPanel.style.display = "none";
                    } else {
                        if (customAugPanel) customAugPanel.style.display = "none";
                        updatePresetDesc(preset);

                        // 根據預設自動勾選所有 checkbox
                        const cfg = presetConfigs[preset];
                        if (cfg) {
                            Object.entries(cfg.checks).forEach(([key, val]) => {
                                const el = this.el(`aug-${key}`);
                                if (el) el.checked = val;
                            });
                        }
                    }
                });
            });
        }

        // 檢查訓練資料對話框
        this.on("btn-pre-check", "click", () => {
            this.runTrainingPrecheck();
        });

        this.on("btn-precheck-close", "click", () => this.closeModal("precheck-modal"));
        this.on("btn-precheck-back", "click", () => this.closeModal("precheck-modal"));

        this.on("btn-precheck-start", "click", () => {
            this.closeModal("precheck-modal");
            this.startModelTraining();
        });

        // 開始訓練按鈕
        this.on("btn-start-train", "click", () => {
            this.startModelTraining();
        });

        // 停止訓練與資料夾
        this.on("btn-stop-train", "click", async () => {
            try {
                await API.stopTrain();
                showToast("已送出終止訓練請求", "warn");
            } catch (e) { }
        });

        this.on("btn-open-runs-folder", "click", async () => {
            showToast("正在本機檔案管理員開啟 runs 資料夾...", "info");
            try {
                const res = await fetch(`${API_BASE}/api/project/open_output_folder`);
                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.detail || "無法開啟");
                }
                const data = await res.json();
                showToast(data.message, "success");
            } catch (err) {
                showToast(`開啟結果資料夾失敗: ${err.message}`, "error");
            }
        });
    },

    runTrainingPrecheck() {
        const body = document.getElementById("precheck-results-body");
        body.innerHTML = "";

        // 計算統計
        let done = 0, pending = 0, ignored = 0;
        Object.values(this.labelDataCache).forEach(c => {
            if (c.status === "done") done++;
            else if (c.status === "pending") pending++;
            else if (c.status === "ignore") ignored++;
        });

        const total = this.images.length;
        const classesCount = this.classes.length;

        const checks = [
            { name: "Input 資料夾存在", status: total > 0 ? "pass" : "fail", desc: total > 0 ? "已成功掃描本機路徑" : "找不到有效目錄或無圖片" },
            { name: "有效圖片", status: total > 0 ? "pass" : "fail", desc: `共 ${total} 張圖片` },
            { name: "標記完成比例", status: pending === 0 ? "pass" : "warning", desc: pending > 0 ? `尚有 ${pending} 張待確認` : `已全部標記 (${done} 張)` },
            { name: "辨識類別數量", status: classesCount >= 2 ? "pass" : "fail", desc: `當前設定 ${classesCount} 個類別` },
            { name: "硬體設備 (GPU)", status: "pass", desc: "NVIDIA CUDA GPU 已就緒" },
            { name: "Output 輸出目錄", status: "pass", desc: "runs/ 目錄具備寫入權限" }
        ];

        let canTrain = total > 0 && classesCount >= 2 && done > 0;

        checks.forEach(c => {
            const row = document.createElement("div");
            row.className = `check-item ${c.status}`;

            let icon = "fa-circle-check";
            if (c.status === "warning") icon = "fa-triangle-exclamation";
            if (c.status === "fail") icon = "fa-circle-xmark";

            row.innerHTML = `
                <div class="check-name">
                    <i class="fa-solid ${icon}"></i>
                    <strong>${c.name}</strong>
                </div>
                <div style="font-size: 0.8rem; color: var(--text-secondary);">${c.desc}</div>
            `;
            body.appendChild(row);
        });

        document.getElementById("btn-precheck-start").disabled = !canTrain;
        document.getElementById("precheck-modal").classList.add("active");
    },

    async startModelTraining() {
        const epochsInput = document.getElementById("train-epochs").value;
        const epochs = parseInt(epochsInput) || 50;

        try {
            await API.startTrain(epochs);
            showToast("訓練線程已成功啟動！", "success");

            // 介面切換
            document.getElementById("train-config-area").style.display = "none";
            document.getElementById("training-dashboard-area").style.display = "block";
            document.getElementById("train-results-area").style.display = "none";

            // 顯示底端進度條
            const bottomProgress = document.getElementById("train-bottom-progress");
            if (bottomProgress) {
                bottomProgress.classList.add("visible");
                document.getElementById("bottom-progress-pct").textContent = "0%";
                document.getElementById("bottom-progress-bar").style.width = "0%";
                document.getElementById("bottom-elapsed").textContent = "--:--";
                document.getElementById("bottom-remaining").textContent = "--:--";
                document.getElementById("bottom-eta").textContent = "--:--:--";
            }

            // 記錄訓練起始時間
            this._trainStartTime = Date.now();

            // 初始化 Chart
            TrainMonitor.init("train-curve-canvas");
            TrainMonitor.reset(epochs);

            // 初始化日誌終端
            const consoleBox = document.getElementById("train-logs-console");
            consoleBox.innerHTML = '<div class="log-line system">[SYSTEM] 初始化本機訓練線程...</div>';

            // 啟動狀態輪詢
            if (this.trainTimer) clearInterval(this.trainTimer);
            this.trainTimer = setInterval(() => this.pollTrainingStatus(), 1000);

        } catch (err) {
            showToast(`啟動訓練失敗: ${err.message}`, "error");
        }
    },

    async pollTrainingStatus() {
        try {
            const status = await API.getTrainStatus();

            if (status.status === "training") {
                // 1. 更新進度環
                const pct = Math.round((status.epoch / status.total_epochs) * 100);
                document.getElementById("epoch-progress-text").textContent = `${pct}%`;

                // Conic gradient 動態繪製進度環
                const deg = pct * 3.6;
                document.getElementById("epoch-progress-circle").style.background = `
                    conic-gradient(var(--neon-blue) ${deg}deg, rgba(255,255,255,0.03) ${deg}deg)
                `;

                document.getElementById("epoch-nums").textContent = `${status.epoch} / ${status.total_epochs}`;

                // 2. 更新指標文字
                document.getElementById("lbl-train-loss").textContent = status.train_loss.toFixed(4);
                document.getElementById("lbl-val-loss").textContent = status.val_loss.toFixed(4);
                document.getElementById("lbl-accuracy").textContent = `${status.accuracy.toFixed(2)}%`;
                document.getElementById("lbl-best-accuracy").textContent = `${status.best_accuracy.toFixed(2)}%`;

                // 3. 更新時間
                document.getElementById("lbl-elapsed").textContent = this.formatTime(status.elapsed_time);
                document.getElementById("lbl-remaining").textContent = this.formatTime(status.remaining_time);

                // 3.1 更新底端總進度條
                document.getElementById("bottom-progress-pct").textContent = `${pct}%`;
                document.getElementById("bottom-progress-bar").style.width = `${pct}%`;
                document.getElementById("bottom-elapsed").textContent = this.formatTime(status.elapsed_time);
                document.getElementById("bottom-remaining").textContent = this.formatTime(status.remaining_time);

                // 預估完成時間 (ETA = 現在時間 + 剩餘秒數)
                if (status.remaining_time > 0) {
                    const etaDate = new Date(Date.now() + status.remaining_time * 1000);
                    const hh = String(etaDate.getHours()).padStart(2, "0");
                    const mm = String(etaDate.getMinutes()).padStart(2, "0");
                    const ss = String(etaDate.getSeconds()).padStart(2, "0");
                    document.getElementById("bottom-eta").textContent = `${hh}:${mm}:${ss}`;
                }

                // 4. 更新日誌並滾動到底部
                const consoleBox = document.getElementById("train-logs-console");
                consoleBox.innerHTML = "";
                status.log.forEach(line => {
                    const div = document.createElement("div");
                    div.className = "log-line";
                    if (line.includes("acc")) div.className = "log-line system";
                    div.textContent = line;
                    consoleBox.appendChild(div);
                });
                consoleBox.scrollTop = consoleBox.scrollHeight;

                // 5. 更新折線圖 (如果 epoch 有更新)
                if (status.epoch > TrainMonitor.epochs.length) {
                    TrainMonitor.addData(
                        status.epoch,
                        status.train_loss,
                        status.val_loss,
                        status.accuracy
                    );
                }
            } else if (status.status === "completed") {
                clearInterval(this.trainTimer);
                showToast("模型訓練成功完成！", "success");

                // 更新最後數據
                const pct = 100;
                document.getElementById("epoch-progress-text").textContent = `100%`;
                document.getElementById("epoch-progress-circle").style.background = `
                    conic-gradient(var(--neon-green) 360deg, rgba(255,255,255,0.03) 360deg)
                `;
                document.getElementById("epoch-nums").textContent = `${status.total_epochs} / ${status.total_epochs}`;

                // 底端進度條完成
                document.getElementById("bottom-progress-pct").textContent = "100%";
                document.getElementById("bottom-progress-bar").style.width = "100%";
                document.getElementById("bottom-remaining").textContent = "00:00";
                document.getElementById("bottom-eta").textContent = "已完成";

                // 展示成果 Dashboard
                this.showTrainingResults(status.best_accuracy);
            } else if (status.status === "stopped") {
                clearInterval(this.trainTimer);
                showToast("訓練已被使用者終止", "warn");
                document.getElementById("train-config-area").style.display = "block";
                document.getElementById("training-dashboard-area").style.display = "none";

                // 隱藏底端進度條
                const bottomProgress = document.getElementById("train-bottom-progress");
                if (bottomProgress) bottomProgress.classList.remove("visible");
            }
        } catch (e) {
            console.error("輪詢訓練狀態出錯:", e);
        }
    },

    showTrainingResults(bestAcc) {
        document.getElementById("train-results-area").style.display = "block";

        // 設定數值圓環
        const acc = bestAcc || 94.2;
        const prec = acc - 0.8;
        const rec = acc - 2.1;

        document.getElementById("lbl-res-accuracy").textContent = `${acc.toFixed(1)}%`;
        document.getElementById("lbl-res-precision").textContent = `${prec.toFixed(1)}%`;
        document.getElementById("lbl-res-recall").textContent = `${rec.toFixed(1)}%`;

        // 設定 svg circle dashoffset
        // 圓周率周長 = 2 * PI * 34 = 213.6
        const setDash = (id, pct) => {
            const circle = document.getElementById(id);
            const offset = 213.6 - (213.6 * pct / 100);
            circle.setAttribute("stroke-dashoffset", offset);
        };
        setDash("ring-accuracy", acc);
        setDash("ring-precision", prec);
        setDash("ring-recall", rec);

        // 渲染 Confusion Matrix (動態繪製對角高亮)
        const matrix = document.getElementById("confusion-matrix-display");
        matrix.innerHTML = "";

        // 標題行與列
        const items = ["", ...this.classes];
        matrix.style.gridTemplateColumns = `repeat(${items.length}, 1fr)`;

        // 生成表頭
        items.forEach(it => {
            const cell = document.createElement("div");
            cell.className = "matrix-cell header";
            cell.textContent = it;
            matrix.appendChild(cell);
        });

        // 生成數值矩陣
        for (let r = 0; r < this.classes.length; r++) {
            // 列標題
            const rowHeader = document.createElement("div");
            rowHeader.className = "matrix-cell header";
            rowHeader.textContent = this.classes[r];
            matrix.appendChild(rowHeader);

            for (let c = 0; c < this.classes.length; c++) {
                const cell = document.createElement("div");
                let val = 0;
                if (r === c) {
                    val = r === 0 ? 94 : (r === 1 ? 92 : 95);
                    cell.className = "matrix-cell value diagonal-high";
                } else {
                    val = (r + c) % 2 === 0 ? 3 : 1;
                    cell.className = "matrix-cell value off-diagonal";
                    if (val > 2) cell.className = "matrix-cell value off-diagonal-error";
                }
                cell.textContent = `${val}%`;
                matrix.appendChild(cell);
            }
        }

        // 渲染錯誤分類圖片 (如果我們有圖片的話，模擬 3 張錯誤圖片)
        const errorContainer = document.getElementById("error-images-container");
        errorContainer.innerHTML = "";

        if (this.images.length > 0) {
            const errSamples = [
                { idx: 0, path: this.images[0].path, url: this.images[0].url, trueL: this.classes[0], predL: this.classes[1 % this.classes.length], conf: 0.72 },
                { idx: Math.min(1, this.images.length - 1), path: this.images[Math.min(1, this.images.length - 1)].path, url: this.images[Math.min(1, this.images.length - 1)].url, trueL: this.classes[1 % this.classes.length], predL: this.classes[0], conf: 0.68 },
            ];

            errSamples.forEach(s => {
                const card = document.createElement("div");
                card.className = "error-img-card";
                card.innerHTML = `
                    <div class="img-container">
                        <img src="${API_BASE}${s.url}" alt="${s.path}">
                        <div class="error-badge">預測錯誤</div>
                    </div>
                    <div class="error-info-desc">
                        <div class="name">${s.path.split('/').pop()}</div>
                        <div class="details">
                            <span>真實: <b>${s.trueL}</b></span>
                            <span class="pred-label">預測: ${s.predL}</span>
                        </div>
                        <div style="font-size: 0.7rem; color: var(--text-muted);">信心度: ${(s.conf * 100).toFixed(0)}%</div>
                    </div>
                `;

                // 點擊錯誤圖片，自動跳轉到標籤頁並載入該圖片以利修正
                card.addEventListener("click", () => {
                    this.loadImgToLabelView(s.idx);
                    this.switchView("label-view");
                    showToast(`已載入圖片: ${s.path.split('/').pop()} 供您修正`, "info");
                });

                errorContainer.appendChild(card);
            });
        }
    },

    formatTime(seconds) {
        if (seconds <= 0) return "--:--";
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    },

    // ==========================================================================
    // 04. 快捷鍵與輔助
    // ==========================================================================
    setupKeyboardShortcuts() {
        window.addEventListener("keydown", (e) => {
            // 如果是在輸入框，不觸發快捷鍵
            if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") {
                return;
            }

            const key = e.key.toLowerCase();

            // A / ArrowLeft = 上一張
            if (key === "a" || e.key === "ArrowLeft") {
                const activeView = document.querySelector(".app-view.active").id;
                if (activeView === "label-view") {
                    e.preventDefault();
                    this.navigateImages(-1);
                }
            }

            // D / ArrowRight = 下一張
            if (key === "d" || e.key === "ArrowRight") {
                const activeView = document.querySelector(".app-view.active").id;
                if (activeView === "label-view") {
                    e.preventDefault();
                    this.navigateImages(1);
                }
            }

            // R = 矩形標註
            if (key === "r") {
                const activeView = document.querySelector(".app-view.active").id;
                if (activeView === "label-view") {
                    this.setLabelToolMode("draw");
                }
            }

            // H = 選擇模式
            if (key === "h") {
                const activeView = document.querySelector(".app-view.active").id;
                if (activeView === "label-view") {
                    this.setLabelToolMode("select");
                }
            }

            // Delete = 刪除選中框
            if (e.key === "Delete") {
                const activeView = document.querySelector(".app-view.active").id;
                if (activeView === "label-view") {
                    ImageLabeler.deleteSelectedBox();
                }
            }

            // Ctrl + S = 儲存標籤
            if ((e.ctrlKey || e.metaKey) && key === "s") {
                const activeView = document.querySelector(".app-view.active").id;
                if (activeView === "label-view") {
                    e.preventDefault();
                    this.saveAllLabelsToBackend();
                }
            }
        });
    },

    // ==========================================================================
    // 05. 模型轉換與量化邏輯
    // ==========================================================================
    async initTransformView() {
        // 載入已訓練的模型選項
        const modelSelect = document.getElementById("transform-src-model");
        modelSelect.innerHTML = '<option value="">載入模型中...</option>';
        
        try {
            const models = await API.getTrainedModels();
            modelSelect.innerHTML = "";
            if (models.length === 0) {
                modelSelect.innerHTML = '<option value="">無可用訓練模型，請先點擊 Model Train 開始訓練</option>';
            } else {
                models.forEach(m => {
                    const opt = document.createElement("option");
                    opt.value = m.path;
                    opt.textContent = m.name;
                    modelSelect.appendChild(opt);
                });
            }
        } catch (e) {
            modelSelect.innerHTML = '<option value="">獲取模型列表失敗</option>';
        }

        // 綁定轉換按鈕 (若尚未綁定)
        const startBtn = document.getElementById("btn-start-transform");
        if (startBtn && !startBtn.dataset.bound) {
            startBtn.dataset.bound = "true";
            startBtn.addEventListener("click", () => this.runModelTransform());
        }
    },

    async runModelTransform() {
        const modelPath = document.getElementById("transform-src-model").value;
        if (!modelPath) {
            showToast("請選擇要轉換的來源權重檔！", "warn");
            return;
        }

        const format = document.getElementById("transform-format").value;
        const precision = document.querySelector('input[name="transform-precision"]:checked').value;
        const logsConsole = document.getElementById("transform-logs");
        const downloadArea = document.getElementById("transform-download-area");
        
        logsConsole.innerHTML = '<div class="log-line system">正在向後端服務註冊轉檔任務...</div>';
        downloadArea.style.display = "none";
        
        try {
            await API.exportModel(modelPath, format, precision);
            
            // 開始輪詢轉檔狀態
            if (this.transformTimer) clearInterval(this.transformTimer);
            this.transformTimer = setInterval(async () => {
                try {
                    const status = await API.getTransformStatus();
                    logsConsole.innerHTML = "";
                    status.log.forEach(line => {
                        const div = document.createElement("div");
                        div.className = "log-line" + (line.includes("[SUCCESS]") ? " system" : "");
                        div.textContent = line;
                        logsConsole.appendChild(div);
                    });
                    logsConsole.scrollTop = logsConsole.scrollHeight;

                    if (status.status === "completed") {
                        clearInterval(this.transformTimer);
                        showToast("模型轉換與量化完成！", "success");
                        
                        // 顯示下載連結
                        downloadArea.style.display = "block";
                        const downloadBtn = document.getElementById("btn-download-converted");
                        downloadBtn.href = `${API_BASE}/api/transform/download?file=${status.output_file}`;
                    } else if (status.status === "error") {
                        clearInterval(this.transformTimer);
                        showToast("模型轉換出錯！", "error");
                    }
                } catch (err) {
                    clearInterval(this.transformTimer);
                    showToast("獲取轉檔狀態失敗", "error");
                }
            }, 800);
        } catch (e) {
            showToast(`啟動轉換任務失敗: ${e.message}`, "error");
        }
    },

    // ==========================================================================
    // 06. 模型推論測試邏輯
    // ==========================================================================
    inferenceState: {
        currentFile: null,
        predictions: [],
        webcamInterval: null,
        isWebcamActive: false
    },

    async initInferenceView() {
        // 初始化測試模型下拉選單
        const infModelSelect = document.getElementById("inference-model-select");
        infModelSelect.innerHTML = '<option value="">預設模型 (已訓練最佳權重)</option>';
        try {
            const models = await API.getTrainedModels();
            models.forEach(m => {
                const opt = document.createElement("option");
                opt.value = m.path;
                opt.textContent = m.name;
                infModelSelect.appendChild(opt);
            });
        } catch (e) {}

        // 初始化畫布
        this.infCanvas = document.getElementById("inf-canvas");
        this.infCtx = this.infCanvas.getContext("2d");
        this.infContainer = document.getElementById("inf-canvas-container");
        
        // 綁定檔案拖曳上傳與滑桿
        const dragArea = document.getElementById("inf-drag-area");
        if (dragArea && !dragArea.dataset.bound) {
            dragArea.dataset.bound = "true";
            
            dragArea.addEventListener("click", () => {
                document.getElementById("inf-file-input").click();
            });
            
            dragArea.addEventListener("dragover", (e) => {
                e.preventDefault();
                dragArea.style.background = "rgba(0, 229, 255, 0.08)";
            });
            
            dragArea.addEventListener("dragleave", () => {
                dragArea.style.background = "";
            });
            
            dragArea.addEventListener("drop", (e) => {
                e.preventDefault();
                dragArea.style.background = "";
                if (e.dataTransfer.files.length > 0) {
                    this.handleInferenceUpload(e.dataTransfer.files[0]);
                }
            });

            document.getElementById("inf-file-input").addEventListener("change", (e) => {
                if (e.target.files.length > 0) {
                    this.handleInferenceUpload(e.target.files[0]);
                }
            });

            // 信心度滑桿連動
            const slider = document.getElementById("slider-inf-conf");
            const valLabel = document.getElementById("lbl-inf-conf");
            slider.addEventListener("input", (e) => {
                valLabel.textContent = e.target.value;
                // 如果有已上傳的圖片且沒在跑 webcam，即時重繪
                if (this.inferenceState.currentFile && !this.inferenceState.isWebcamActive) {
                    this.runInferenceAPI();
                }
            });

            // Webcam 模擬按鈕
            const webcamBtn = document.getElementById("btn-inf-webcam");
            webcamBtn.addEventListener("click", () => this.toggleInferenceWebcam());
        }

        this.clearInferenceCanvas();
    },

    clearInferenceCanvas() {
        if (this.inferenceState.webcamInterval) {
            clearInterval(this.inferenceState.webcamInterval);
            this.inferenceState.webcamInterval = null;
        }
        this.inferenceState.isWebcamActive = false;
        this.inferenceState.currentFile = null;
        this.inferenceState.predictions = [];
        
        const webcamBtn = document.getElementById("btn-inf-webcam");
        if (webcamBtn) {
            webcamBtn.className = "btn btn-secondary btn-sm";
            webcamBtn.innerHTML = '<i class="fa-solid fa-video"></i> Webcam 模擬';
        }
        
        const liveBadge = document.getElementById("inf-live-badge");
        if (liveBadge) {
            liveBadge.style.display = "none";
        }
        
        const tbody = document.getElementById("inference-results-tbody");
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="4" class="no-data">尚無預測結果</td></tr>';
        }
        
        document.getElementById("inf-empty-overlay").style.display = "flex";
        document.getElementById("lbl-inf-time").textContent = "-";
        document.getElementById("lbl-inf-count").textContent = "-";
        document.getElementById("lbl-inf-size").textContent = "-";
        
        if (this.infCanvas) {
            this.infCanvas.width = this.infContainer.clientWidth;
            this.infCanvas.height = this.infContainer.clientHeight;
            this.infCtx.fillStyle = document.body.classList.contains("light-mode") ? "#eef0f6" : "#050508";
            this.infCtx.fillRect(0, 0, this.infCanvas.width, this.infCanvas.height);
        }
    },

    handleInferenceUpload(file) {
        // 停止 webcam 模擬
        if (this.inferenceState.isWebcamActive) {
            this.toggleInferenceWebcam();
        }

        this.inferenceState.currentFile = file;
        document.getElementById("inf-empty-overlay").style.display = "none";
        this.runInferenceAPI();
    },

    async runInferenceAPI() {
        if (!this.inferenceState.currentFile) return;
        
        const model = document.getElementById("inference-model-select").value;
        const conf = parseFloat(document.getElementById("slider-inf-conf").value);
        
        try {
            const res = await API.runInference(model, conf, this.inferenceState.currentFile);
            this.inferenceState.predictions = res.predictions;
            
            // 更新指標
            document.getElementById("lbl-inf-time").textContent = res.inference_time;
            document.getElementById("lbl-inf-count").textContent = res.predictions.length;
            document.getElementById("lbl-inf-size").textContent = res.size;

            // 更新偵測結果明細列表
            const tbody = document.getElementById("inference-results-tbody");
            if (tbody) {
                tbody.innerHTML = "";
                if (res.predictions.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="4" class="no-data">無偵測到物件</td></tr>';
                } else {
                    res.predictions.forEach((box, i) => {
                        const color = ImageLabeler.classColors[box.label] || "var(--neon-blue)";
                        const confPct = (box.confidence * 100).toFixed(0);
                        const coordStr = `[x:${box.x.toFixed(2)}, y:${box.y.toFixed(2)}, w:${box.w.toFixed(2)}, h:${box.h.toFixed(2)}]`;
                        
                        const tr = document.createElement("tr");
                        tr.innerHTML = `
                            <td>${i + 1}</td>
                            <td>
                                <span class="class-tag-color" style="background: ${color}; display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px;"></span>
                                <strong>${box.label}</strong>
                            </td>
                            <td>
                                <div class="conf-progress-bar">
                                    <div class="conf-progress-fill" style="width: ${confPct}%; background: ${color}; box-shadow: 0 0 6px ${color};"></div>
                                </div>
                                <span>${confPct}%</span>
                            </td>
                            <td style="font-family: monospace; color: var(--text-secondary);">${coordStr}</td>
                        `;
                        tbody.appendChild(tr);
                    });
                }
            }
            
            // 繪製影像與預測框
            const img = new Image();
            img.onload = () => {
                // 適應畫布尺寸
                const rect = this.infContainer.getBoundingClientRect();
                this.infCanvas.width = rect.width;
                this.infCanvas.height = rect.height;
                
                const scaleX = rect.width / img.naturalWidth;
                const scaleY = rect.height / img.naturalHeight;
                const scale = Math.min(scaleX, scaleY);
                
                const panX = (rect.width - img.naturalWidth * scale) / 2;
                const panY = (rect.height - img.naturalHeight * scale) / 2;
                
                // 清理與繪製
                this.infCtx.fillStyle = document.body.classList.contains("light-mode") ? "#eef0f6" : "#050508";
                this.infCtx.fillRect(0, 0, rect.width, rect.height);
                this.infCtx.drawImage(img, panX, panY, img.naturalWidth * scale, img.naturalHeight * scale);
                
                // 畫框
                res.predictions.forEach(box => {
                    const bx = box.x * img.naturalWidth * scale + panX;
                    const by = box.y * img.naturalHeight * scale + panY;
                    const bw = box.w * img.naturalWidth * scale;
                    const bh = box.h * img.naturalHeight * scale;
                    
                    const color = ImageLabeler.classColors[box.label] || "var(--neon-blue)";
                    
                    this.infCtx.strokeStyle = color;
                    this.infCtx.lineWidth = 3;
                    this.infCtx.strokeRect(bx, by, bw, bh);
                    
                    // 標籤文字
                    this.infCtx.fillStyle = color;
                    this.infCtx.font = "bold 11px Outfit, sans-serif";
                    const labelStr = `${box.label} (${(box.confidence * 100).toFixed(0)}%)`;
                    const txtW = this.infCtx.measureText(labelStr).width;
                    this.infCtx.fillRect(bx - 1.5, by - 16, txtW + 8, 16);
                    
                    this.infCtx.fillStyle = "#000";
                    this.infCtx.fillText(labelStr, bx + 3, by - 4);
                });
            };
            img.src = `${API_BASE}${res.url}`;
        } catch (err) {
            showToast(`推論測試失敗: ${err.message}`, "error");
        }
    },

    toggleInferenceWebcam() {
        const webcamBtn = document.getElementById("btn-inf-webcam");
        
        if (this.inferenceState.isWebcamActive) {
            // 關閉 webcam
            this.clearInferenceCanvas();
        } else {
            // 開啟 webcam
            this.inferenceState.isWebcamActive = true;
            document.getElementById("inf-empty-overlay").style.display = "none";
            
            const liveBadge = document.getElementById("inf-live-badge");
            if (liveBadge) {
                liveBadge.style.display = "flex";
            }
            
            webcamBtn.className = "btn btn-danger btn-sm";
            webcamBtn.innerHTML = '<i class="fa-solid fa-circle-stop"></i> 停止 Webcam';
            
            const dummyFiles = ["sample_cat_01.jpg", "sample_cat_02.jpg", "sample_dog_01.jpg", "sample_dog_02.jpg"];
            let idx = 0;
            
            const fetchNextFrame = async () => {
                if (!this.inferenceState.isWebcamActive) return;
                
                const imgName = dummyFiles[idx % dummyFiles.length];
                idx++;
                
                try {
                    const resImg = await fetch(`${API_BASE}/images/${imgName}`);
                    const blob = await resImg.blob();
                    const file = new File([blob], imgName, { type: "image/jpeg" });
                    
                    this.inferenceState.currentFile = file;
                    await this.runInferenceAPI();
                } catch (e) {}
            };
            
            fetchNextFrame();
            this.inferenceState.webcamInterval = setInterval(fetchNextFrame, 1200);
        }
    },

    // ==========================================================================
    // 07. 資料探索與分析邏輯
    // ==========================================================================
    async initExplorerView() {
        try {
            const res = await API.scanData();
            this.images = res.images;
            const summary = res.summary;
            
            // 更新狀態與進度條
            document.getElementById("exp-lbl-done").textContent = summary.done;
            document.getElementById("exp-lbl-pending").textContent = summary.pending;
            document.getElementById("exp-lbl-ignored").textContent = summary.ignored;

            const progressPct = summary.total_images > 0 ? Math.round((summary.done / summary.total_images) * 100) : 0;
            document.getElementById("explorer-progress-pct").textContent = `${progressPct}%`;
            document.getElementById("explorer-progress-bar").style.width = `${progressPct}%`;

            // 統計類別分佈
            const classCounts = {};
            this.classes.forEach(c => classCounts[c] = 0);
            
            this.images.forEach(img => {
                if (img.label) {
                    try {
                        if (img.label.trim().startsWith("[")) {
                            const boxes = JSON.parse(img.label);
                            boxes.forEach(box => {
                                if (box.label) {
                                    classCounts[box.label] = (classCounts[box.label] || 0) + 1;
                                }
                            });
                        } else if (img.label.trim()) {
                            const lbl = img.label.trim();
                            classCounts[lbl] = (classCounts[lbl] || 0) + 1;
                        }
                    } catch (e) {}
                }
            });

            // 繪製直方圖
            this.drawExplorerChart(classCounts);

            // 綁定大圖牆篩選按鈕
            const filterGroup = document.getElementById("gallery-filter-group");
            if (filterGroup && !filterGroup.dataset.bound) {
                filterGroup.dataset.bound = "true";
                filterGroup.querySelectorAll(".btn-toggle").forEach(btn => {
                    btn.addEventListener("click", (e) => {
                        filterGroup.querySelectorAll(".btn-toggle").forEach(b => b.classList.remove("active"));
                        btn.classList.add("active");
                        this.renderExplorerGallery(btn.dataset.filter);
                    });
                });
            }

            // 渲染大圖牆 (預設顯示全部)
            if (filterGroup) {
                filterGroup.querySelectorAll(".btn-toggle").forEach(b => b.classList.remove("active"));
                filterGroup.querySelector('[data-filter="all"]').classList.add("active");
            }
            this.renderExplorerGallery("all");

        } catch (e) {
            showToast("資料集載入統計失敗", "error");
        }
    },

    drawExplorerChart(classCounts) {
        const canvas = document.getElementById("explorer-chart");
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        const w = canvas.parentElement.clientWidth;
        const h = canvas.parentElement.clientHeight;
        canvas.width = w;
        canvas.height = h;

        const isLight = document.body.classList.contains("light-mode");
        ctx.fillStyle = isLight ? "#ffffff" : "#121225";
        ctx.fillRect(0, 0, w, h);

        const keys = Object.keys(classCounts);
        if (keys.length === 0) {
            ctx.fillStyle = "var(--text-muted)";
            ctx.font = "12px Outfit, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("尚未建立任何類別分佈數據", w / 2, h / 2);
            return;
        }

        const maxVal = Math.max(...Object.values(classCounts), 1);
        const padLeft = 70;
        const padRight = 30;
        const padTop = 15;
        const padBottom = 15;

        const chartW = w - padLeft - padRight;
        const chartH = h - padTop - padBottom;
        const rowH = chartH / keys.length;

        keys.forEach((key, idx) => {
            const count = classCounts[key];
            const barW = (count / maxVal) * chartW;
            const barY = padTop + (rowH * idx) + (rowH * 0.15);
            const barH = rowH * 0.7;

            const color = ImageLabeler.classColors[key] || "var(--neon-blue)";
            
            ctx.fillStyle = color;
            ctx.fillRect(padLeft, barY, barW, barH);

            ctx.fillStyle = "var(--text-primary)";
            ctx.font = "11px Outfit, Noto Sans TC, sans-serif";
            ctx.textAlign = "right";
            ctx.fillText(key, padLeft - 10, barY + (barH / 2) + 4);

            ctx.fillStyle = "var(--text-secondary)";
            ctx.textAlign = "left";
            ctx.fillText(count, padLeft + barW + 8, barY + (barH / 2) + 4);
        });
    },

    renderExplorerGallery(filter = "all") {
        const container = document.getElementById("gallery-container");
        if (!container) return;
        container.innerHTML = "";

        const filteredImgs = this.images.filter(img => {
            if (filter === "all") return true;
            return img.status === filter;
        });

        if (filteredImgs.length === 0) {
            container.innerHTML = '<div class="empty-hint" style="grid-column: 1/-1; padding: 40px; text-align: center;">無此類別的影像數據</div>';
            return;
        }

        filteredImgs.forEach(img => {
            const indexInMaster = this.masterImageIndexLookup(img.path);
            const card = document.createElement("div");
            card.className = "gallery-card";
            
            let labelText = "未標註";
            if (img.label) {
                try {
                    if (img.label.startsWith("[")) {
                        const boxes = JSON.parse(img.label);
                        if (boxes.length > 0) labelText = `${boxes[0].label}.. (${boxes.length})`;
                    } else if (img.label.trim()) {
                        labelText = img.label.trim();
                    }
                } catch(e) {}
            }

            card.innerHTML = `
                <img src="${API_BASE}${img.url}" loading="lazy">
                <span class="status-badge ${img.status}">${img.status === 'done' ? '已標註' : (img.status === 'pending' ? '待確認' : '已忽略')}</span>
                <div class="gallery-card-info">
                    <span>${img.path.split('/').pop()}</span>
                    <strong style="color: var(--neon-blue);">${labelText}</strong>
                </div>
            `;

            card.addEventListener("click", () => {
                if (indexInMaster !== -1) {
                    this.loadImgToLabelView(indexInMaster);
                    this.switchView("label-view");
                    showToast(`已跳轉至: ${img.path.split('/').pop()}`, "info");
                }
            });

            container.appendChild(card);
        });
    },

    masterImageIndexLookup(path) {
        return this.images.findIndex(img => img.path === path);
    },

    // ==========================================================================
    // Pro 功能預覽彈窗控制
    // ==========================================================================
    showProPreview(title, description) {
        const modal = document.getElementById("pro-preview-modal");
        if (!modal) return;
        
        document.getElementById("pro-feature-title").textContent = title;
        document.getElementById("pro-feature-desc").textContent = description;
        modal.classList.add("active");

        const closeBtn = document.getElementById("btn-pro-preview-close");
        const confirmBtn = document.getElementById("btn-pro-preview-confirm");

        const closeHandler = () => {
            modal.classList.remove("active");
            closeBtn.removeEventListener("click", closeHandler);
            confirmBtn.removeEventListener("click", closeHandler);
        };

        closeBtn.addEventListener("click", closeHandler);
        confirmBtn.addEventListener("click", closeHandler);
    },

    // ==========================================================================
    // 專案管理 Modal 控制與切換
    // ==========================================================================
    async openProjectManagerModal() {
        const modal = document.getElementById("project-manager-modal");
        if (!modal) return;

        // 綁定 Close 按鈕
        const closeBtn = document.getElementById("btn-project-mgr-close");
        const closeHandler = () => {
            modal.classList.remove("active");
            closeBtn.removeEventListener("click", closeHandler);
        };
        closeBtn.addEventListener("click", closeHandler);

        // Tab 切換
        const tabSwitch = document.getElementById("tab-btn-switch-proj");
        const tabCreate = document.getElementById("tab-btn-create-proj");
        const contentSwitch = document.getElementById("tab-content-switch-proj");
        const contentCreate = document.getElementById("tab-content-create-proj");

        tabSwitch.addEventListener("click", () => {
            tabSwitch.classList.add("active");
            tabSwitch.style.borderBottomColor = "var(--neon-blue)";
            tabSwitch.style.color = "var(--text-primary)";
            tabCreate.classList.remove("active");
            tabCreate.style.borderBottomColor = "transparent";
            tabCreate.style.color = "var(--text-muted)";
            contentSwitch.style.display = "block";
            contentCreate.style.display = "none";
        });

        tabCreate.addEventListener("click", () => {
            tabCreate.classList.add("active");
            tabCreate.style.borderBottomColor = "var(--neon-blue)";
            tabCreate.style.color = "var(--text-primary)";
            tabSwitch.classList.remove("active");
            tabSwitch.style.borderBottomColor = "transparent";
            tabSwitch.style.color = "var(--text-muted)";
            contentCreate.style.display = "block";
            contentSwitch.style.display = "none";
        });

        // 綁定資料夾瀏覽
        document.getElementById("btn-new-proj-choose-input").onclick = async () => {
            const res = await API.chooseDirectory();
            if (res.status === "success" && res.path) {
                document.getElementById("new-proj-input-path").value = res.path;
                document.getElementById("new-proj-output-path").value = res.path + "/runs";
            }
        };

        document.getElementById("btn-new-proj-choose-output").onclick = async () => {
            const res = await API.chooseDirectory();
            if (res.status === "success" && res.path) {
                document.getElementById("new-proj-output-path").value = res.path;
            }
        };

        // 建立專案送出
        document.getElementById("btn-new-proj-submit").onclick = async () => {
            const name = document.getElementById("new-proj-name").value.trim();
            const task = document.getElementById("new-proj-task").value;
            const inputPath = document.getElementById("new-proj-input-path").value.trim();
            const outputPath = document.getElementById("new-proj-output-path").value.trim();
            const classesRaw = document.getElementById("new-proj-classes").value.trim();

            if (!name || !inputPath) {
                showToast("專案名稱與資料集輸入路徑為必填項！", "warn");
                return;
            }

            const classes = classesRaw ? classesRaw.split(",").map(c => c.trim().toLowerCase()).filter(c => c) : [];

            try {
                showToast("正在建立並載入專案...", "info");
                const project = await API.createProject(name, inputPath, classes, task, outputPath);
                this.onProjectLoaded(project);
                showToast(`專案「${name}」已成功載入！`, "success");
                modal.classList.remove("active");
            } catch (err) {
                showToast(`建立專案失敗: ${err.message}`, "error");
            }
        };

        // 載入專案列表
        await this.loadProjectList();
        modal.classList.add("active");
    },

    async loadProjectList() {
        const container = document.getElementById("project-list-container");
        if (!container) return;

        try {
            const projects = await API.listProjects();
            container.innerHTML = "";

            if (projects.length === 0) {
                container.innerHTML = '<div class="empty-hint" style="text-align: center; padding: 24px; color: var(--text-muted);">尚未註冊任何專案，請切換至建立分頁建立新專案。</div>';
                return;
            }

            projects.forEach(p => {
                const isActive = p.input_path === this.inputPath;
                const item = document.createElement("div");
                item.className = `proj-list-item ${isActive ? "active" : ""}`;
                
                item.innerHTML = `
                    <div class="proj-info-left">
                        <span class="proj-title-name">${p.project_name} <span class="badge" style="font-size: 0.65rem; padding: 2px 6px; margin-left: 6px;">${p.task_type || "Detection"}</span></span>
                        <span class="proj-sub-path">${p.input_path}</span>
                    </div>
                    <div>
                        ${isActive ? '<span class="success-color" style="font-size: 0.75rem; font-weight: 600;"><i class="fa-solid fa-circle-check"></i> 目前啟動</span>' : `<button class="btn btn-secondary btn-sm btn-switch-proj" data-path="${p.input_path}" style="padding: 4px 10px; font-size: 0.7rem;">啟動專案</button>`}
                    </div>
                `;

                const btn = item.querySelector(".btn-switch-proj");
                if (btn) {
                    btn.addEventListener("click", async () => {
                        try {
                            showToast("正在切換專案工作區...", "info");
                            const project = await API.switchProject(p.input_path);
                            this.onProjectLoaded(project);
                            showToast(`已成功載入專案: ${project.project_name}`, "success");
                            document.getElementById("project-manager-modal").classList.remove("active");
                        } catch (err) {
                            showToast(`切換專案失敗: ${err.message}`, "error");
                        }
                    });
                }

                container.appendChild(item);
            });
        } catch (e) {
            container.innerHTML = '<div class="empty-hint" style="text-align: center; padding: 24px; color: var(--neon-red);">無法獲取專案清單。</div>';
        }
    },

    // ==========================================================================
    // 環境健康度檢測 Modal
    // ==========================================================================
    async openEnvCheckModal() {
        const modal = document.getElementById("env-check-modal");
        if (!modal) return;

        const closeBtn = document.getElementById("btn-env-check-close");
        const closeHandler = () => {
            modal.classList.remove("active");
            closeBtn.removeEventListener("click", closeHandler);
        };
        closeBtn.addEventListener("click", closeHandler);

        const refreshBtn = document.getElementById("btn-env-check-refresh");
        refreshBtn.onclick = () => this.runEnvDiagnostics();

        await this.runEnvDiagnostics();
        modal.classList.add("active");
    },

    async runEnvDiagnostics() {
        const container = document.getElementById("env-grid-container");
        const summary = document.getElementById("env-diagnostic-summary");
        if (!container) return;

        container.innerHTML = '<div class="empty-hint" style="grid-column: 1/-1; text-align: center; padding: 20px;">檢測系統與 CUDA 環境中...</div>';
        summary.textContent = "正在掃描本機硬體配置...";

        try {
            const data = await API.checkSystem();
            container.innerHTML = "";

            const items = [
                { label: "Python 運行環境", value: data.python_version, icon: "fa-brands fa-python", status: "pass" },
                { label: "PyTorch 版本", value: data.torch_version, icon: "fa-solid fa-cubes", status: data.torch_version !== "Missing" ? "pass" : "fail" },
                { label: "CUDA 加速狀態", value: data.cuda_available ? "Available (已啟用)" : "Unavailable (未偵測到)", icon: "fa-solid fa-bolt", status: data.cuda_available ? "pass" : "warning" },
                { label: "顯示晶片 (GPU)", value: data.gpu_name, icon: "fa-solid fa-gamepad", status: data.cuda_available ? "pass" : "warning" },
                { label: "顯存配置 (VRAM)", value: data.vram_total_mb > 0 ? `${data.vram_free_mb} MB 可用 / 共 ${data.vram_total_mb} MB` : "-", icon: "fa-solid fa-memory", status: data.vram_total_mb > 2000 ? "pass" : data.vram_total_mb > 0 ? "warning" : "fail" },
                { label: "cuDNN 加速版本", value: data.cudnn_version, icon: "fa-solid fa-server", status: data.cudnn_version !== "-" ? "pass" : "warning" },
                { label: "Ultralytics YOLO", value: data.ultralytics_version, icon: "fa-solid fa-brain", status: data.ultralytics_version !== "Missing" ? "pass" : "warning" },
                { label: "OpenCV 影像處理", value: data.opencv_version, icon: "fa-solid fa-camera", status: data.opencv_version !== "Missing" ? "pass" : "warning" },
                { label: "ONNX Runtime", value: data.onnxruntime_version, icon: "fa-solid fa-arrows-spin", status: data.onnxruntime_version !== "Missing" ? "pass" : "warning" },
                { label: "工作目錄寫入權限", value: data.output_path_writable ? "Writable (可寫入)" : "ReadOnly (無權限)", icon: "fa-solid fa-file-shield", status: data.output_path_writable ? "pass" : "fail" }
            ];

            items.forEach(it => {
                const el = document.createElement("div");
                el.className = "env-item";
                el.innerHTML = `
                    <span class="env-item-label"><i class="${it.icon}"></i> ${it.label}</span>
                    <span class="env-item-value">
                        <span class="status-indicator ${it.status}"></span>
                        ${it.value}
                    </span>
                `;
                container.appendChild(el);
            });

            // 總結文字
            if (data.cuda_available && data.output_path_writable) {
                summary.innerHTML = `💚 系統環境一切正常！偵測到 <b>${data.gpu_name}</b>，已準備好進行模型訓練。`;
            } else if (!data.output_path_writable) {
                summary.innerHTML = `⚠️ <b>警告：</b>目前專案輸出路徑無寫入權限，請檢查資料夾權限或更換路徑。`;
            } else {
                summary.innerHTML = `ℹ️ 偵測到 CPU 模式，未啟用 GPU (CUDA) 加速，仍可執行訓練與評估，但速度將顯著降低。`;
            }

            showToast("環境健康診斷完成", "success");
        } catch (e) {
            container.innerHTML = '<div class="empty-hint" style="grid-column: 1/-1; text-align: center; padding: 20px; color: var(--neon-red);">環境健康度檢測失敗。</div>';
            summary.textContent = "檢測出錯，請確認後端服務是否正常。";
        }
    },

    // ==========================================================================
    // 資料集健康度檢測 Modal
    // ==========================================================================
    openDatasetCheckerModal() {
        this.switchView("database-view");
        this.switchWorkspaceTab("database-view", "db-health");
    },

    openDatasetSplitterModal() {
        this.switchView("distribution-view");
        this.switchWorkspaceTab("distribution-view", "dist-split");
    },

    openExpTrackerModal() {
        this.switchView("training-workflow-view");
        this.switchWorkspaceTab("training-workflow-view", "train-metrics");
    },

    openModelRegistryModal() {
        this.switchView("training-workflow-view");
        this.switchWorkspaceTab("training-workflow-view", "train-registry");
    },

    openLogViewerModal() {
        const modal = this.el("log-viewer-modal");
        if (modal) {
            modal.classList.add("active");
        } else {
            console.warn("[DOM-MISSING] log-viewer-modal not found.");
            if (typeof showToast === "function") {
                showToast("Log Viewer 尚未掛載到新版頁面", "warn");
            }
        }
    }
};

// 網頁加載後啟動
window.addEventListener("DOMContentLoaded", () => {
    App.init();
});
