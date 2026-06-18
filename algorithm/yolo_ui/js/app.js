// 專案主控制邏輯
const App = {
    initialized: false,
    // 全域專案狀態
    projectLoaded: false,
    projectName: "",
    inputPath: "",
    classes: [],

    // 圖片資料庫
    images: [],
    currentImgIndex: -1,
    galleryLimit: 120,

    // 標記暫存 (path -> { label: string, status: string })
    labelDataCache: {},

    // 訓練輪詢 Timer
    trainTimer: null,
    backendHeartbeatTimer: null,
    lastExplorerStatsError: "",
    
    // 候選審核佇列
    reviewQueue: [],
    currentReviewIndex: -1,
    reviewMode: false,

    // 自動標註背景任務狀態
    currentAutoLabelTaskId: null,
    autoLabelTimer: null,
    autoLabelStartTime: null,
    autoLabelElapsedTimer: null,

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

    makeLabelCacheEntry(img, overrides = {}) {
        return {
            label: img?.label || "",
            status: img?.status || "pending",
            source: img?.source || "",
            review_state: img?.review_state || "",
            model_id: img?.model_id || "",
            confidence: img?.confidence || "",
            updated_at: img?.updated_at || "",
            ...overrides
        };
    },

    isAiPendingLabel(item) {
        return item?.status === "ai_pending" || (item?.status === "pending" && item?.source === "auto");
    },

    getStatusText(item) {
        if (item?.status === "done") return "已標註";
        if (this.isAiPendingLabel(item)) return "AI 待審核";
        if (item?.status === "pending") return "待確認";
        if (item?.status === "ignore") return "已忽略";
        return item?.status || "-";
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
        if (this.initialized) {
            console.warn("[APP] App.init() already executed, skip duplicate binding.");
            return;
        }
        this.initialized = true;

        this.validateDomContract();

        // 1. 初始化頁面導航
        this.safeSetup("setupNavigation", () => this.setupNavigation());

        // 1.2. 維持本機後端服務存活
        this.safeSetup("setupBackendHeartbeat", () => this.setupBackendHeartbeat());

        // 1.5. 初始化主題
        this.safeSetup("initTheme", () => this.initTheme());

        // 2. 初始化專案對話框
        this.safeSetup("setupProjectModals", () => this.setupProjectModals());
        
        // 2.5. 初始化 Session 事件
        this.safeSetup("setupSessionEvents", () => this.setupSessionEvents());

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

        // 8. 綁定標註模式相關事件與初始化 UI
        this.safeSetup("setupAnnotationModeEvents", () => this.setupAnnotationModeEvents());

        window.addEventListener("resize", () => {
            this.syncAutoLabelPreviewOverlay();
        });
    },

    setupBackendHeartbeat() {
        const sendHeartbeat = async () => {
            try {
                await fetch(`${API_BASE}/api/heartbeat`, { cache: "no-store" });
            } catch (err) {
                console.warn("[HEARTBEAT] Backend heartbeat failed:", err);
            }
        };

        sendHeartbeat();
        if (this.backendHeartbeatTimer) {
            clearInterval(this.backendHeartbeatTimer);
        }
        this.backendHeartbeatTimer = setInterval(sendHeartbeat, 10000);
    },

    initTheme() {
        const themeBtn = document.getElementById("btn-theme-toggle");
        if (!themeBtn) return;

        // 從 localStorage 讀取主題設定，預設為 dark
        const savedTheme = localStorage.getItem("yolo-ui-theme") || "light";
        
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
            btn.addEventListener("click", async (e) => {
                const targetView = e.currentTarget.getAttribute("data-target");
                const targetTab = e.currentTarget.getAttribute("data-tab");
                if (targetView === "annotation-view" && (!targetTab || targetTab === "ann-manual")) {
                    await this.openAnnotationEditor();
                    return;
                }
                this.switchView(targetView, targetTab);
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
                this.switchWorkspaceTab("training-workflow-view", "train-config");
            });
        }

        // 標籤版本備份建立
        const createVersionBtn = document.getElementById("btn-create-label-version");
        if (createVersionBtn) {
            createVersionBtn.addEventListener("click", async () => {
                const inputEl = document.getElementById("input-new-version-name");
                if (!inputEl) return;
                const versionName = inputEl.value.trim();
                if (!versionName) {
                    showToast("請輸入備份版本名稱或備註", "warn");
                    return;
                }

                try {
                    const res = await API.createLabelVersion(versionName);
                    showToast(res.message || "版本備份成功", "success");
                    inputEl.value = "";
                    this.renderLabelVersions();
                } catch (err) {
                    showToast(`建立備份失敗: ${err.message}`, "error");
                }
            });
        }

        // 重新執行品質檢測
        const runQaBtn = document.getElementById("btn-run-qa-scan");
        if (runQaBtn) {
            runQaBtn.addEventListener("click", async () => {
                showToast("開始標註品質檢查...", "info");
                await this.scanDataset();
                this.runAnnotationQualityCheck();
                showToast("標註品質檢查完成", "success");
            });
        }

        // 開始逐張審核
        const startReviewBtn = document.getElementById("btn-start-review-editor");
        if (startReviewBtn) {
            startReviewBtn.addEventListener("click", () => {
                this.enterCandidateReviewMode();
            });
        }

        // 接受此標註
        const reviewAcceptBtn = document.getElementById("btn-review-accept");
        if (reviewAcceptBtn) {
            reviewAcceptBtn.addEventListener("click", () => {
                this.acceptCurrentReviewLabel();
            });
        }

        // 儲存並下一張
        const reviewSaveNextBtn = document.getElementById("btn-review-save-next");
        if (reviewSaveNextBtn) {
            reviewSaveNextBtn.addEventListener("click", () => {
                this.saveReviewAndNext();
            });
        }

        // 忽略此圖
        const reviewIgnoreBtn = document.getElementById("btn-review-ignore");
        if (reviewIgnoreBtn) {
            reviewIgnoreBtn.addEventListener("click", () => {
                this.ignoreCurrentReviewImage();
            });
        }

        // 離開審核
        const reviewExitBtn = document.getElementById("btn-review-exit");
        if (reviewExitBtn) {
            reviewExitBtn.addEventListener("click", () => {
                this.exitReviewMode();
            });
        }
    },

    enableTabs() {
        // 全面啟用，已無須禁用邏輯
    },

    switchView(viewId, requestedTab = null) {
        let targetViewId = viewId;
        let targetTab = null;

        // 路由重定向映射
        if (viewId === "explorer-view") {
            targetViewId = "database-view";
            targetTab = "db-manage";
        } else if (viewId === "label-view") {
            targetViewId = "annotation-view";
            targetTab = "ann-manual";
        } else if (viewId === "train-view") {
            targetViewId = "training-workflow-view";
            targetTab = "train-config";
        } else if (viewId === "inference-view") {
            targetViewId = "training-workflow-view";
            targetTab = "train-inference";
        } else if (viewId === "transform-view") {
            targetViewId = "training-workflow-view";
            targetTab = "train-export";
        }



        // 如果進入資料庫管理，預設跳轉到合併的資料管理與總覽頁面
        if (targetViewId === "database-view" && !targetTab) {
            targetTab = "db-manage";
        }

        // 標註中心模式檢查與引導，不拒絕使用者，預設使用 manual
        if (targetViewId === "annotation-view") {
            const mode = localStorage.getItem("yolo-ann-mode");
            targetTab = (mode === "auto") ? "ann-auto" : "ann-manual";
        }

        if (requestedTab) {
            targetTab = requestedTab;
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
        if (tabName === "db-manage" || tabName === "db-overview") {
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
            if (this.projectLoaded) {
                const refreshBtn = document.getElementById("btn-ds-checker-refresh");
                if (refreshBtn) refreshBtn.click();
            } else {
                this.resetDbHealthUi();
            }
        } else if (tabName === "ann-review") {
            this.renderReviewGallery();
        } else if (tabName === "ann-unlabeled") {
            this.renderUnlabeledGallery();
        } else if (tabName === "ann-quality") {
            this.runAnnotationQualityCheck();
        } else if (tabName === "ann-version") {
            this.renderLabelVersions();
        }
        
        // 4. 更新 Smart Guide
        this.updateSmartGuide(workspaceId, tabName);
    },

    updateSmartGuide(workspaceId, tabName) {
        const totalImgs = this.images.length;
        const doneCount = Object.values(this.labelDataCache).filter(c => c.status === "done").length;
        const pendingCount = Object.values(this.labelDataCache).filter(c => c.status === "pending" || this.isAiPendingLabel(c)).length;
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
        this.bindClick("btn-studio-label", () => this.openAnnotationEditor());
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
        // 要求 0: 每次進入系統預設為空狀態，不自動加載任何專案或快取
        this.projectLoaded = false;
        this.projectName = "";
        this.inputPath = "";
        this.classes = [];
        this.images = [];
        this.currentImgIndex = -1;

        // 清空與重設 UI metrics 為空
        this.resetUiToEmptyState();

        // 載入並渲染專案歷史紀錄
        this.renderProjectHistory();

        try {
            const activeProject = await API.getActiveProject();
            if (activeProject && activeProject.status === "active" && activeProject.input_path) {
                this.onProjectLoaded(activeProject);
            }
        } catch (err) {
            console.info("[PROJECT] No active backend project to restore.");
        }
    },

    onProjectLoaded(project) {
        this.projectLoaded = true;
        this.projectName = project.project_name || "DefaultProject";
        this.inputPath = project.input_path || "C:/yolo";
        this.classes = project.classes || [];
        this.taskType = project.task_type || "Detection";

        // 更新 UI 頂部與 Badge
        this.html("active-project-badge", `
            <span class="dot active"></span> Project: ${this.projectName}
        `);
        this.value("input-path-display", this.inputPath);
        this.value("output-path-display", project.output_path || `${this.inputPath}/runs`);
        this.value("label-input-path-display", this.inputPath);
        // 自動標註頁同步顯示目前專案的資料目錄（唯讀，來源唯一）
        this.value("auto-label-path-display", this.inputPath);
        
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

    async addClassByPrompt() {
        const newCls = prompt("請輸入新增類別名稱：");
        if (!newCls || !newCls.trim()) return;

        const cleanCls = newCls.trim().toLowerCase();

        // 規則檢測 (僅允許英文、數字、底線與連字號)
        if (!/^[a-z0-9_-]+$/.test(cleanCls)) {
            showToast("類別名稱只能使用英文、數字、底線或連字號", "warn");
            return;
        }

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
        await this.persistProjectClasses();

        showToast(`已新增類別: ${cleanCls}`, "success");
    },

    async persistProjectClasses() {
        if (!this.projectLoaded || !this.inputPath) return;

        const outputPath = this.el("output-path-display")?.value || `${this.inputPath}/runs`;

        try {
            const res = await fetch(`${API_BASE}/api/project/update`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    input_path: this.inputPath,
                    output_path: outputPath,
                    classes: this.classes
                })
            });
            if (!res.ok) throw new Error("後端保存類別更新失敗");
            const project = await res.json();
            this.onProjectLoaded(project);
        } catch (err) {
            console.warn("[CLASS-SAVE] Failed to persist classes:", err);
            showToast("類別已更新於前端，但保存到專案設定失敗", "warn");
        }
    },

    /**
     * chooseFolderOnce()
     * 防重複呼叫的目錄選擇方法。
     * 若上一次 chooseDirectory 尚未結束，直接返回 null 避免重複彈出系統 dialog。
     */
    _choosingFolder: false,
    async chooseFolderOnce() {
        if (this._choosingFolder) {
            console.warn("[FOLDER] chooseFolderOnce already in progress, ignoring duplicate call.");
            return null;
        }
        this._choosingFolder = true;
        try {
            const res = await API.chooseDirectory();
            return res;
        } catch (err) {
            console.warn("[FOLDER] chooseDirectory failed:", err);
            return null;
        } finally {
            this._choosingFolder = false;
        }
    },

    // ==========================================================================
    // 01. 資料頁面
    // ==========================================================================
    setupDataPageEvents() {
        this.on("btn-scan-data", "click", () => this.scanDataset());
        this.on("btn-clear-data", "click", () => this.clearDataset());
        this.on("btn-save-project-state", "click", () => this.saveProjectState());
        this.on("btn-ds-checker-refresh", "click", () => this.runDatasetChecker());

        // Train 頁面的類別新增按鈕 (統一使用 addClassByPrompt，防止重複 prompt)
        this.on("btn-train-add-class", "click", () => this.addClassByPrompt());

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
                this.importDatasetFiles(e.dataTransfer.files);
            });
        }

        this.on("file-input-dummy", "change", (e) => {
            this.importDatasetFiles(e.target.files);
            e.target.value = "";
        });
    },

    async importDatasetFiles(files) {
        if (!files || files.length === 0) return;
        if (!this.projectLoaded) {
            showToast("請先建立或載入專案，再匯入資料集", "warn");
            return;
        }

        try {
            showToast("正在匯入資料集...", "info");
            const result = await API.importData(files);
            showToast(`${result.message}，正在重新掃描`, "success");
            await this.scanDataset();
            if (document.getElementById("database-view")?.classList.contains("active")) {
                await this.initExplorerView();
            }
        } catch (err) {
            showToast(`資料匯入失敗: ${err.message}`, "error");
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
            setElText("guide-ann-progress-pct", `${progressPct}%`);
            const annProgressBar = document.getElementById("guide-ann-progress-bar");
            if (annProgressBar) annProgressBar.style.width = `${progressPct}%`;

            // 更新首頁卡片數據與狀態
            setElText("card-db-total-imgs", summary.total_images);
            
            const aiPendingCount = summary.ai_pending || 0;
            const unlabeledCount = summary.total_images - summary.done - summary.ignored - aiPendingCount;
            setElText("card-ann-unlabeled", unlabeledCount);
            setElText("card-ann-verified", summary.done);
            setElText("card-ann-pending", aiPendingCount);

            // 計算並更新待審核佇列狀態
            const pendingReviewItems = this.getPendingReviewItems();
            let totalReviewBoxes = 0;
            pendingReviewItems.forEach(img => {
                try {
                    const boxes = JSON.parse(img.label);
                    if (Array.isArray(boxes)) {
                        totalReviewBoxes += boxes.length;
                    }
                } catch(e) {}
            });
            setElText("review-pending-count", pendingReviewItems.length);
            setElText("review-box-count", totalReviewBoxes);

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

            // 同步自動標註版本的指標值與狀態
            document.querySelectorAll(".card-auto-total-imgs").forEach(el => el.textContent = summary.total_images);
            setElText("card-auto-health-score", `${healthScore}%`);
            
            const autoProcessedCount = this.images.filter(img => img.label && img.label !== "[]" && img.label !== "").length;
            const processedEl = document.getElementById("card-auto-processed");
            if (processedEl) {
                processedEl.textContent = `${autoProcessedCount} / ${summary.total_images}`;
            }
            
            document.querySelectorAll(".card-auto-pending-count").forEach(el => el.textContent = unlabeledCount);
            document.querySelectorAll(".card-auto-verified-count").forEach(el => el.textContent = summary.done);
            setElText("card-auto-analysis-health", `${healthScore}%`);

            // 同步模型訓練卡片指標至自動標註卡片四
            const mapVal = document.getElementById("card-train-map")?.textContent || "-";
            const runVal = document.getElementById("card-train-run")?.textContent || "-";
            setElText("card-auto-train-map", mapVal);
            setElText("card-auto-train-run", runVal);

            // 更新自動標註卡片 1、2、3、4 的狀態 Badge
            const cardAutoDb = document.getElementById("card-auto-db");
            if (cardAutoDb) {
                const badge = cardAutoDb.querySelector(".flow-card-badge");
                if (badge) {
                    badge.className = summary.total_images > 0 ? "flow-card-badge status-green" : "flow-card-badge status-gray";
                    badge.textContent = summary.total_images > 0 ? "已就緒" : "未開始";
                }
            }
            const cardAutoRun = document.getElementById("card-auto-run");
            if (cardAutoRun) {
                const badge = cardAutoRun.querySelector(".flow-card-badge");
                if (badge) {
                    if (summary.total_images > 0) {
                        badge.className = summary.done === summary.total_images ? "flow-card-badge status-green" : "flow-card-badge status-blue";
                        badge.textContent = summary.done === summary.total_images ? "已完成" : "進行中";
                    } else {
                        badge.className = "flow-card-badge status-gray";
                        badge.textContent = "未開始";
                    }
                }
            }
            const cardAutoAnalysis = document.getElementById("card-auto-analysis");
            if (cardAutoAnalysis) {
                const badge = cardAutoAnalysis.querySelector(".flow-card-badge");
                if (badge) {
                    if (summary.total_images > 0) {
                        badge.className = unlabeledCount === 0 ? "flow-card-badge status-green" : "flow-card-badge status-blue";
                        badge.textContent = unlabeledCount === 0 ? "已完成" : "待分析";
                    } else {
                        badge.className = "flow-card-badge status-gray";
                        badge.textContent = "未開始";
                    }
                }
            }
            const cardAutoTrain = document.getElementById("card-auto-train");
            if (cardAutoTrain) {
                const badge = cardAutoTrain.querySelector(".flow-card-badge");
                const manualTrainBadge = document.getElementById("card-training")?.querySelector(".flow-card-badge");
                if (badge && manualTrainBadge) {
                    badge.className = "flow-card-badge " + (manualTrainBadge.className.replace("flow-card-badge", "").trim() || "status-gray");
                    badge.textContent = manualTrainBadge.textContent;
                }
            }

            // 寫入快取與重設標記清單
            this.labelDataCache = {};
            this.images.forEach(img => {
                this.labelDataCache[img.path] = this.makeLabelCacheEntry(img);
            });

            // 更新類別標籤雲
            this.renderClassTags();

            // 初始化標籤頁的圖片資訊
            setElText("total-img-count", this.images.length);
            if (this.images.length > 0) {
                if (this.currentImgIndex < 0 || this.currentImgIndex >= this.images.length) {
                    this.currentImgIndex = 0;
                }
                this.loadImgToLabelView(this.currentImgIndex);
            } else {
                this.currentImgIndex = -1;
                setElText("current-img-index", "0");
                setElText("img-name-display", "無圖片");
                setElText("info-filename", "-");
                const badge = document.getElementById("info-status");
                if (badge) {
                    badge.className = "val badge pending";
                    badge.textContent = "-";
                }
            }

            // 自動更新 Smart Guides
            this.updateSmartGuide("database-view", "db-manage");
            this.updateSmartGuide("annotation-view", "ann-manual");
            this.updateSmartGuide("distribution-view", "dist-split");
            this.updateSmartGuide("training-workflow-view", "train-config");

            // 若目前正處於這些 Tab，自動同步更新內容
            const activeAnnTab = document.querySelector("#annotation-view .sidebar-menu li.active")?.getAttribute("data-tab");
            if (activeAnnTab === "ann-review") {
                this.renderReviewGallery();
            } else if (activeAnnTab === "ann-unlabeled") {
                this.renderUnlabeledGallery();
            } else if (activeAnnTab === "ann-quality") {
                this.runAnnotationQualityCheck();
            } else if (activeAnnTab === "ann-version") {
                this.renderLabelVersions();
            }

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
        this.on("tool-polygon", "click", () => this.setLabelToolMode("polygon"));

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

        // 新增類別 (統一使用 addClassByPrompt，防止重複 prompt)
        this.on("btn-add-class", "click", () => this.addClassByPrompt());

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
                this.importDatasetFiles(e.dataTransfer.files);
            });
        }

        this.on("label-file-input-dummy", "change", (e) => {
            this.importDatasetFiles(e.target.files);
            e.target.value = "";
        });

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
        const toolSelect = document.getElementById("tool-select");
        const toolBbox = document.getElementById("tool-bbox");
        const toolPolygon = document.getElementById("tool-polygon");
        
        if (toolSelect) toolSelect.classList.toggle("active", mode === "select");
        if (toolBbox) toolBbox.classList.toggle("active", mode === "draw");
        if (toolPolygon) toolPolygon.classList.toggle("active", mode === "polygon");

        if (mode === "draw" || mode === "polygon") {
            ImageLabeler.selectedBoxIndex = -1;
            ImageLabeler.updateBBoxList();
            ImageLabeler.draw();
        }
    },

    setCurrentImageStatus(status) {
        if (this.currentImgIndex < 0) return;
        const img = this.images[this.currentImgIndex];

        // 更新快取。手動畫布產生 manual 狀態；AI 候選改走 Auto Review。
        const current = this.labelDataCache[img.path] || this.makeLabelCacheEntry(img);
        this.labelDataCache[img.path] = {
            ...current,
            status,
            source: current.source || "manual",
            review_state: status === "ignore" ? "rejected" : current.review_state
        };

        // 更新 UI 徽章與狀態按鈕
        const badge = document.getElementById("info-status");
        badge.className = `val badge ${status}`;
        badge.textContent = this.getStatusText(this.labelDataCache[img.path]);

        document.getElementById("tool-ignore").classList.toggle("active", status === "ignore");
        document.getElementById("tool-pending").classList.toggle("active", status === "pending");

        // 當前標記如果是忽略，清空畫布上的標記框
        if (status === "ignore") {
            ImageLabeler.bboxes = [];
            ImageLabeler.updateBBoxList();
            ImageLabeler.draw();
        }

        showToast(`圖片狀態設定為: ${badge.textContent}`, "info");
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

    ensureImageLabelerReady() {
        const canvas = document.getElementById("label-canvas");
        const canvasContainer = document.getElementById("canvas-container-div");
        if (!canvas || !canvasContainer || typeof ImageLabeler === "undefined") {
            return false;
        }

        if (!ImageLabeler.canvas || !ImageLabeler.ctx || ImageLabeler.canvas !== canvas) {
            ImageLabeler.init("label-canvas", "canvas-container-div");
        }

        if (ImageLabeler.setClassColors) {
            ImageLabeler.setClassColors(this.classes || []);
        }

        return true;
    },

    loadImgToLabelView(index) {
        if (index < 0 || index >= this.images.length) return;
        if (!this.ensureImageLabelerReady()) {
            showToast("標註畫布尚未就緒，請稍後再試。", "warn");
            return;
        }

        // 切換圖片時才保存上一張；載入同一張候選圖時不可用尚未載入的空畫布覆蓋 AI 標註。
        if (this.currentImgIndex !== index) {
            this.saveCurrentImgLabelToCache();
        }

        this.currentImgIndex = index;
        const img = this.images[index];
        const cache = this.labelDataCache[img.path] || this.makeLabelCacheEntry(img);

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
        badge.textContent = this.getStatusText(cache);

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
        const current = this.labelDataCache[img.path] || this.makeLabelCacheEntry(img);
        const status = current.status;
        let labelStr = "";

        if (status !== "ignore") {
            labelStr = ImageLabeler.getLabelString();
            // 手動畫布只把一般 pending 升級為正式 manual；AI 候選必須走 Auto Review。
            if (labelStr && status === "pending" && !this.isAiPendingLabel(current)) {
                this.labelDataCache[img.path] = {
                    ...current,
                    status: "done",
                    source: "manual",
                    review_state: ""
                };
            }
        }

        this.labelDataCache[img.path] = {
            ...(this.labelDataCache[img.path] || current),
            label: labelStr
        };
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

    applyModelPreset(modelId) {
        if (!this.modelRegistry) return;
        
        let foundModel = null;
        const tasks = this.modelRegistry.tasks || {};
        for (const taskName in tasks) {
            const models = tasks[taskName].models || [];
            foundModel = models.find(m => m.id === modelId);
            if (foundModel) break;
        }
        
        if (!foundModel) return;
        
        // 1. 套用解析度
        const imgSize = foundModel.default_img_size;
        if (imgSize) {
            const sizeSelect = document.getElementById("train-img-size");
            if (sizeSelect) {
                let hasOpt = Array.from(sizeSelect.options).some(opt => opt.value == imgSize);
                if (!hasOpt) {
                    const opt = document.createElement("option");
                    opt.value = imgSize;
                    opt.textContent = `${imgSize} x ${imgSize}`;
                    sizeSelect.appendChild(opt);
                }
                sizeSelect.value = imgSize.toString();
            }
        }
        
        // 2. 套用批次大小
        const batchSize = foundModel.default_batch_size;
        if (batchSize) {
            const batchSelect = document.getElementById("train-batch");
            if (batchSelect) {
                let hasOpt = Array.from(batchSelect.options).some(opt => opt.value == batchSize);
                if (!hasOpt) {
                    const opt = document.createElement("option");
                    opt.value = batchSize;
                    opt.textContent = batchSize.toString();
                    batchSelect.appendChild(opt);
                }
                batchSelect.value = batchSize.toString();
            }
        }
        
        // 3. 套用優化器
        const optimizer = foundModel.default_optimizer;
        if (optimizer) {
            const optSelect = document.getElementById("train-optimizer");
            if (optSelect) {
                let hasOpt = Array.from(optSelect.options).some(opt => opt.value == optimizer);
                if (!hasOpt) {
                    const opt = document.createElement("option");
                    opt.value = optimizer;
                    opt.textContent = optimizer;
                    optSelect.appendChild(opt);
                }
                optSelect.value = optimizer;
            }
        }
        
        // 4. 套用學習率
        const lr = foundModel.default_lr;
        if (lr !== undefined && lr !== null) {
            const lrSelect = document.getElementById("train-lr");
            if (lrSelect) {
                let hasOpt = Array.from(lrSelect.options).some(opt => opt.value == lr);
                if (!hasOpt) {
                    const opt = document.createElement("option");
                    opt.value = lr;
                    opt.textContent = lr.toString();
                    lrSelect.appendChild(opt);
                }
                lrSelect.value = lr.toString();
            }
        }
    },

    // ==========================================================================
    // 03. 訓練設定與控制
    // ==========================================================================
    setupTrainPageEvents() {
        // 異步加載模型註冊表與套用 Preset
        (async () => {
            try {
                this.modelRegistry = await API.getModelRegistry();
                const modelSelect = document.getElementById("train-model");
                if (modelSelect) {
                    this.applyModelPreset(modelSelect.value);
                }
            } catch (err) {
                console.error("[PRESET] 載入模型註冊表失敗:", err);
            }
        })();

        // 綁定模型選擇改變事件
        const modelSelect = document.getElementById("train-model");
        if (modelSelect) {
            modelSelect.addEventListener("change", (e) => {
                this.applyModelPreset(e.target.value);
            });
        }

        // 資料切分比例聯動
        const sTrain = this.el("slider-train");
        const sVal = this.el("slider-val");
        const sTest = this.el("slider-test");

        if (sTrain && sVal && sTest) {
            const updateSplitLabels = () => {
                const vTrain = parseInt(sTrain.value);
                const vVal = parseInt(sVal.value);
                const vTest = parseInt(sTest.value);

                this.text("lbl-train", `${vTrain}%`);
                this.text("lbl-val", `${vVal}%`);
                this.text("lbl-test", `${vTest}%`);

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

        this.on("btn-apply-split", "click", async () => {
            if (!this.projectLoaded) {
                showToast("請先建立或載入專案，再進行資料切分", "warn");
                return;
            }
            try {
                const train = parseInt(sTrain?.value || "70") / 100;
                const val = parseInt(sVal?.value || "20") / 100;
                const test = parseInt(sTest?.value || "10") / 100;
                const res = await API.splitDataset(train, val, test);
                if (res.status === "success") {
                    showToast(res.message, "success");
                } else {
                    showToast(res.message || "資料切分未完成", "warn");
                }
            } catch (err) {
                showToast(`資料切分失敗: ${err.message}`, "error");
            }
        });

        this.on("btn-export-dataset", "click", async () => {
            try {
                const res = await API.exportDataset();
                showToast(`資料集已匯出：${res.export_path}`, "success");
            } catch (err) {
                showToast(`資料集匯出失敗: ${err.message}`, "error");
            }
        });

        // 資料集格式結構預覽樹狀圖交互邏輯
        const yoloViewerTitle = document.getElementById("yolo-viewer-title");
        const yoloViewerBody = document.getElementById("yolo-viewer-body");
        const selectExportFormat = document.getElementById("select-export-format");
        const exportStructTitle = document.getElementById("export-struct-title");

        const exportFileContents = {
            // YOLO 格式
            "yolo-yaml": {
                title: "📄 data.yaml",
                content: `# YOLOv8 資料集配置設定
path: ../exports/yolo_dataset_v001  # 資料集根目錄
train: train/images  # 訓練集圖片相對路徑
val: val/images      # 驗證集圖片相對路徑
test: test/images    # 測試集圖片相對路徑 (可選)

# 類別對照表 (Class Names)
names:
  0: open
  1: close`
            },
            "yolo-img1": {
                title: "🖼️ train/images/000001.jpg",
                content: `[影像二進位資料 - Binary Image Data]
說明：
- 這是訓練集 (train) 中實際送入模型訓練的圖片檔案。
- YOLO 模型直接讀取此影像，並與 labels/000001.txt 進行配對。
- 圖片檔名與對應的標註檔檔名必須完全一致。`
            },
            "yolo-txt1": {
                title: "📄 train/labels/000001.txt",
                content: `# 歸一化 YOLO 標註檔案 (Normalized Bounding Box Labels)
# 格式: [class_id] [x_center] [y_center] [width] [height]
# 數值皆為 0 ~ 1 之間的比例值 (以圖片寬高為基準歸一化)

0 0.4872 0.6125 0.2340 0.3880  # 代表第 0 類 (open)，中心坐標 (0.4872, 0.6125)
1 0.7410 0.5200 0.1200 0.2000  # 代表第 1 類 (close)，中心坐標 (0.7410, 0.5200)`
            },
            "yolo-img2": {
                title: "🖼️ val/images/000002.jpg",
                content: `[影像二進位資料 - Binary Image Data]
說明：
- 這是驗證集 (val) 中的影像檔案。
- 驗證集用於在訓練過程中評估模型泛化能力、計算 mAP。
- 驗證集圖片不會直接參與梯度更新。`
            },
            "yolo-txt2": {
                title: "📄 val/labels/000002.txt",
                content: `# 歸一化 YOLO 標註檔案
0 0.3520 0.4810 0.1500 0.2600  # 代表第 0 類 (open)`
            },
            // COCO 格式
            "coco-json": {
                title: "📄 annotations/instances_train.json",
                content: `{
  "info": {
    "description": "Vision Training Studio Exported COCO Dataset",
    "date_created": "2026/06/16"
  },
  "images": [
    {
      "id": 1,
      "width": 640,
      "height": 480,
      "file_name": "000001.jpg"
    }
  ],
  "annotations": [
    {
      "id": 1001,
      "image_id": 1,
      "category_id": 0,
      "bbox": [150, 200, 120, 80], // 格式為: [x_min, y_min, width, height] (絕對像素值)
      "area": 9600,
      "iscrowd": 0
    }
  ],
  "categories": [
    { "id": 0, "name": "open", "supercategory": "object" },
    { "id": 1, "name": "close", "supercategory": "object" }
  ]
}`
            },
            "coco-img1": {
                title: "🖼️ train/000001.jpg",
                content: `[影像二進位資料 - Binary Image Data]
說明：
- COCO 格式將所有圖片放在統一的資料夾中（例如 train/ 或 val/）。
- 影像的配對與標籤不依賴檔名，而是由 annotations/instances_train.json 中的 "file_name" 進行對照連結。`
            },
            "coco-img2": {
                title: "🖼️ val/000002.jpg",
                content: `[影像二進位資料 - Binary Image Data]
說明：
- COCO 格式的驗證集影像檔案，與 instances_val.json 中定義的圖片資訊相對應。`
            },
            // PASCAL VOC 格式
            "voc-xml1": {
                title: "📄 Annotations/000001.xml",
                content: `<annotation>
    <folder>JPEGImages</folder>
    <filename>000001.jpg</filename>
    <path>./voc_dataset/JPEGImages/000001.jpg</path>
    <source>
        <database>Unknown</database>
    </source>
    <size>
        <width>640</width>
        <height>480</height>
        <depth>3</depth>
    </size>
    <segmented>0</segmented>
    <object>
        <name>open</name>
        <pose>Unspecified</pose>
        <truncated>0</truncated>
        <difficult>0</difficult>
        <bndbox>
            <xmin>150</xmin> <!-- 左上角 X (絕對像素坐標) -->
            <ymin>200</ymin> <!-- 左上角 Y -->
            <xmax>270</xmax> <!-- 右下角 X -->
            <ymax>280</ymax> <!-- 右下角 Y -->
        </bndbox>
    </object>
</annotation>`
            },
            "voc-xml2": {
                title: "📄 Annotations/000002.xml",
                content: `<annotation>
    <folder>JPEGImages</folder>
    <filename>000002.jpg</filename>
    <size>
        <width>640</width>
        <height>480</height>
        <depth>3</depth>
    </size>
    <object>
        <name>close</name>
        <bndbox>
            <xmin>180</xmin>
            <ymin>150</ymin>
            <xmax>300</xmax>
            <ymax>290</ymax>
        </bndbox>
    </object>
</annotation>`
            },
            "voc-img1": {
                title: "🖼️ JPEGImages/000001.jpg",
                content: `[影像二進位資料 - Binary Image Data]
說明：
- PASCAL VOC 格式將所有圖片檔存放於 JPEGImages/ 目錄下。
- 與之相對應的 XML 標註檔存放在 Annotations/ 中，主幹名稱完全相同。`
            },
            "voc-img2": {
                title: "🖼️ JPEGImages/000002.jpg",
                content: `[影像二極體資料 - Binary Image Data]
說明：
- 對應於 Annotations/000002.xml 的影像檔。`
            },
            "voc-txt": {
                title: "📄 ImageSets/Main/train.txt",
                content: `000001
000002
# 說明：
# 此文字檔儲存了所有用於訓練的影像主檔名（不含副檔名）。
# 系統透過此清單尋找 Annotations/ 下對應的 xml 檔案來加載訓練集。`
            }
        };

        const updateExportViewer = (fileKey) => {
            const data = exportFileContents[fileKey];
            if (!data || !yoloViewerTitle || !yoloViewerBody) return;
            yoloViewerTitle.innerText = data.title;
            yoloViewerBody.textContent = data.content;
        };

        const handleTreeClicks = () => {
            const fileNodes = document.querySelectorAll(".yolo-tree-column .file-node");
            fileNodes.forEach(node => {
                node.replaceWith(node.cloneNode(true));
            });

            const newFileNodes = document.querySelectorAll(".yolo-tree-column .file-node");
            newFileNodes.forEach(node => {
                const fType = node.getAttribute("data-file");
                if (node.classList.contains("active")) {
                    node.style.background = "rgba(52, 152, 219, 0.15)";
                    node.style.color = "#3498db";
                } else {
                    node.style.background = "none";
                    if (fType.includes("yaml") || fType.includes("json") || fType.includes("xml")) {
                        node.style.color = "#3498db";
                    } else if (fType.includes("img")) {
                        node.style.color = "#9b59b6";
                    } else if (fType.includes("txt")) {
                        node.style.color = "#2ecc71";
                    }
                }

                node.addEventListener("click", () => {
                    newFileNodes.forEach(n => {
                        n.classList.remove("active");
                        n.style.background = "none";
                        const fKey = n.getAttribute("data-file");
                        if (fKey.includes("yaml") || fKey.includes("json") || fKey.includes("xml")) {
                            n.style.color = "#3498db";
                        } else if (fKey.includes("img")) {
                            n.style.color = "#9b59b6";
                        } else if (fKey.includes("txt")) {
                            n.style.color = "#2ecc71";
                        }
                    });

                    node.classList.add("active");
                    node.style.background = "rgba(52, 152, 219, 0.15)";
                    node.style.color = "#3498db";

                    const fileKey = node.getAttribute("data-file");
                    updateExportViewer(fileKey);
                });
            });
        };

        if (selectExportFormat) {
            selectExportFormat.addEventListener("change", () => {
                const format = selectExportFormat.value;
                const treeYolo = document.getElementById("tree-yolo");
                const treeCoco = document.getElementById("tree-coco");
                const treeVoc = document.getElementById("tree-voc");

                if (treeYolo) treeYolo.style.display = "none";
                if (treeCoco) treeCoco.style.display = "none";
                if (treeVoc) treeVoc.style.display = "none";

                let defaultKey = "yolo-yaml";
                if (format === "yolo") {
                    if (treeYolo) treeYolo.style.display = "block";
                    if (exportStructTitle) exportStructTitle.innerHTML = `<i class="fa-solid fa-folder-tree"></i> YOLO 資料集結構預覽 (Standard Folder Structure)`;
                    defaultKey = "yolo-yaml";
                } else if (format === "coco") {
                    if (treeCoco) treeCoco.style.display = "block";
                    if (exportStructTitle) exportStructTitle.innerHTML = `<i class="fa-solid fa-folder-tree"></i> COCO 資料集結構預覽 (Standard Folder Structure)`;
                    defaultKey = "coco-json";
                } else if (format === "voc") {
                    if (treeVoc) treeVoc.style.display = "block";
                    if (exportStructTitle) exportStructTitle.innerHTML = `<i class="fa-solid fa-folder-tree"></i> PASCAL VOC 資料集結構預覽 (Standard Folder Structure)`;
                    defaultKey = "voc-xml1";
                }

                const allNodes = document.querySelectorAll(".yolo-tree-column .file-node");
                allNodes.forEach(n => {
                    n.classList.remove("active");
                    n.style.background = "none";
                });

                const activeNode = document.querySelector(`.yolo-tree-column .file-node[data-file="${defaultKey}"]`);
                if (activeNode) {
                    activeNode.classList.add("active");
                }

                handleTreeClicks();
                updateExportViewer(defaultKey);
            });
        }

        // 首次加載時初始化
        handleTreeClicks();
        updateExportViewer("yolo-yaml");

        this.on("btn-run-report-gen", "click", async () => {
            try {
                const res = await API.generateReport();
                showToast(`報告已產生：${res.report_path}`, "success");
            } catch (err) {
                showToast(`報告產生失敗: ${err.message}`, "error");
            }
        });

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
                    { name: "垂直翻轉 (Vertical Flip)", on: false },
                    { name: "隨機旋轉 ±10° (Rotation)", on: true },
                    { name: "隨機剪切 (Shear)", on: false },
                    { name: "隨機縮放裁剪 (Scale & Crop)", on: true },
                    { name: "隨機平移 (Translation)", on: false },
                    { name: "亮度調整 (Brightness)", on: true },
                    { name: "對比度調整 (Contrast)", on: false },
                    { name: "色彩對比度 HSV (Color Jitter)", on: false },
                    { name: "高斯模糊 (Gaussian Blur)", on: false },
                    { name: "椒鹽雜訊 (Salt & Pepper)", on: false },
                    { name: "隨機擦除 (Cutout / Erasing)", on: false }
                ],
                checks: { flip: true, vflip: false, rotate: true, shear: false, "scale-crop": true, translate: false, brightness: true, contrast: false, "color-jitter": false, blur: false, "salt-pepper": false, cutout: false }
            },
            none: {
                title: "None 方案 — 不做任何增強：",
                items: [
                    { name: "水平翻轉 (Horizontal Flip)", on: false },
                    { name: "垂直翻轉 (Vertical Flip)", on: false },
                    { name: "隨機旋轉 ±10° (Rotation)", on: false },
                    { name: "隨機剪切 (Shear)", on: false },
                    { name: "隨機縮放裁剪 (Scale & Crop)", on: false },
                    { name: "隨機平移 (Translation)", on: false },
                    { name: "亮度調整 (Brightness)", on: false },
                    { name: "對比度調整 (Contrast)", on: false },
                    { name: "色彩對比度 HSV (Color Jitter)", on: false },
                    { name: "高斯模糊 (Gaussian Blur)", on: false },
                    { name: "椒鹽雜訊 (Salt & Pepper)", on: false },
                    { name: "隨機擦除 (Cutout / Erasing)", on: false }
                ],
                checks: { flip: false, vflip: false, rotate: false, shear: false, "scale-crop": false, translate: false, brightness: false, contrast: false, "color-jitter": false, blur: false, "salt-pepper": false, cutout: false }
            },
            strong: {
                title: "Strong 方案 — 全部啟用：",
                items: [
                    { name: "水平翻轉 (Horizontal Flip)", on: true },
                    { name: "垂直翻轉 (Vertical Flip)", on: true },
                    { name: "隨機旋轉 ±10° (Rotation)", on: true },
                    { name: "隨機剪切 (Shear)", on: true },
                    { name: "隨機縮放裁剪 (Scale & Crop)", on: true },
                    { name: "隨機平移 (Translation)", on: true },
                    { name: "亮度調整 (Brightness)", on: true },
                    { name: "對比度調整 (Contrast)", on: true },
                    { name: "色彩對比度 HSV (Color Jitter)", on: true },
                    { name: "高斯模糊 (Gaussian Blur)", on: true },
                    { name: "椒鹽雜訊 (Salt & Pepper)", on: true },
                    { name: "隨機擦除 (Cutout / Erasing)", on: true }
                ],
                checks: { flip: true, vflip: true, rotate: true, shear: true, "scale-crop": true, translate: true, brightness: true, contrast: true, "color-jitter": true, blur: true, "salt-pepper": true, cutout: true }
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
                        if (customAugPanel) customAugPanel.style.display = "flex";
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
            // 初始渲染標準方案的說明
            updatePresetDesc("standard");
        }

        // 自定義增強管道載入範例邏輯
        const pipelineExampleBtn = this.el("btn-load-pipeline-example");
        const pipelineTextarea = this.el("txt-custom-pipeline");
        if (pipelineExampleBtn && pipelineTextarea) {
            pipelineExampleBtn.addEventListener("click", () => {
                const exampleJson = [
                    {
                        "__class_fullname__": "HorizontalFlip",
                        "p": 0.5
                    },
                    {
                        "__class_fullname__": "RandomBrightnessContrast",
                        "brightness_limit": 0.2,
                        "contrast_limit": 0.2,
                        "p": 0.5
                    },
                    {
                        "__class_fullname__": "ShiftScaleRotate",
                        "shift_limit": 0.06,
                        "scale_limit": 0.1,
                        "rotate_limit": 15,
                        "p": 0.5
                    },
                    {
                        "__class_fullname__": "HueSaturationValue",
                        "hue_shift_limit": 20,
                        "sat_shift_limit": 30,
                        "val_shift_limit": 20,
                        "p": 0.5
                    }
                ];
                pipelineTextarea.value = JSON.stringify(exampleJson, null, 4);
                showToast("已載入 Albumentations 範例管道", "info");
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
        let done = 0, pending = 0, ignored = 0, trainableLabels = 0;
        Object.values(this.labelDataCache).forEach(c => {
            if (c.status === "done") done++;
            else if (c.status === "pending" || this.isAiPendingLabel(c)) pending++;
            else if (c.status === "ignore") ignored++;

            if (this.hasValidBoxes(c.label)) {
                trainableLabels++;
            }
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

        checks.splice(3, 0, {
            name: "訓練可用標註",
            status: trainableLabels > 0 ? "pass" : "fail",
            desc: trainableLabels > 0
                ? `可用標註影像 ${trainableLabels} 張，包含已確認與候選標註。`
                : "目前沒有任何可用標註，請先完成手動或自動標註。"
        });

        let canTrain = total > 0 && classesCount >= 2 && trainableLabels > 0;

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
        const modelId = document.getElementById("train-model")?.value || "yolov8n";
        
        // 根據 modelId 推斷 task_type 與 weights
        let taskType = "detection";
        const classificationModels = ["resnet18", "mobilenetv3", "efficientnet-b0", "convnext-tiny"];
        const segmentationModels = ["segformer-b0", "deeplabv3plus", "mobilenetv3-deeplab"];
        if (classificationModels.includes(modelId)) {
            taskType = "classification";
        } else if (segmentationModels.includes(modelId)) {
            taskType = "segmentation";
        }
        
        const weights = modelId.includes("yolo") ? `${modelId}.pt` : modelId;
        const imgSize = parseInt(document.getElementById("train-img-size")?.value) || 640;
        const epochs = parseInt(document.getElementById("train-epochs")?.value) || 50;
        
        const batchVal = document.getElementById("train-batch")?.value || "-1";
        const batchSize = (batchVal === "-1" || batchVal === "auto") ? -1 : parseInt(batchVal);
        
        const device = document.getElementById("train-device")?.value || "auto";
        const optimizer = document.getElementById("train-optimizer")?.value || "AdamW";
        
        const lrVal = document.getElementById("train-lr")?.value || "0.001";
        const lr = (lrVal === "-1" || lrVal === "auto") ? 0.001 : parseFloat(lrVal);
        
        const weightDecay = parseFloat(document.getElementById("adv-weight-decay")?.value) || 0.0005;
        const amp = document.getElementById("adv-amp") ? document.getElementById("adv-amp").checked : true;
        const earlyStop = document.getElementById("adv-early-stop") ? document.getElementById("adv-early-stop").checked : true;
        const patience = parseInt(document.getElementById("adv-patience")?.value) || 20;

        const config = {
            model_id: modelId,
            task_type: taskType,
            weights: weights,
            img_size: imgSize,
            epochs: epochs,
            batch_size: batchSize,
            device: device,
            optimizer: optimizer,
            lr: lr,
            weight_decay: weightDecay,
            amp: amp,
            early_stop: earlyStop,
            patience: patience
        };

        try {
            await API.startTrain(config);
            showToast("訓練線程已成功啟動！", "success");

            // 介面切換
            this.switchWorkspaceTab("training-workflow-view", "train-config");
            const startPanel = document.getElementById("train-start-panel");
            const dashboardArea = document.getElementById("training-dashboard-area");
            const resultsArea = document.getElementById("train-results-area");
            if (startPanel) startPanel.style.display = "none";
            if (dashboardArea) dashboardArea.style.display = "block";
            if (resultsArea) resultsArea.style.display = "none";

            // 顯示參數配置下方的進度條，隱藏閒置提示，並切換啟動/停止按鈕
            const trainProgressSection = document.getElementById("train-progress-section");
            const trainIdleHint = document.getElementById("train-idle-hint");
            const btnStartTrain = document.getElementById("btn-start-train");
            const btnStopTrain = document.getElementById("btn-stop-train");

            if (trainProgressSection) trainProgressSection.style.display = "block";
            if (trainIdleHint) trainIdleHint.style.display = "none";
            if (btnStartTrain) btnStartTrain.style.display = "none";
            if (btnStopTrain) btnStopTrain.style.display = "block";

            // 顯示底端進度條 (防禦性檢查與更新)
            const bottomProgress = document.getElementById("train-bottom-progress");
            if (bottomProgress) {
                bottomProgress.classList.add("visible");
            }
            const bottomPct = document.getElementById("bottom-progress-pct");
            if (bottomPct) bottomPct.textContent = "0%";
            const bottomBar = document.getElementById("bottom-progress-bar");
            if (bottomBar) bottomBar.style.width = "0%";
            const bottomElapsed = document.getElementById("bottom-elapsed");
            if (bottomElapsed) bottomElapsed.textContent = "--:--";
            const bottomRemaining = document.getElementById("bottom-remaining");
            if (bottomRemaining) bottomRemaining.textContent = "--:--";
            const bottomEta = document.getElementById("bottom-eta");
            if (bottomEta) bottomEta.textContent = "--:--:--";

            // 記錄訓練起始時間
            this._trainStartTime = Date.now();

            // 初始化 Chart
            TrainMonitor.init("train-curve-canvas");
            TrainMonitor.reset(epochs);
            this._mockTrainingNoticeShown = false;

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
            if (status.mock_mode && !this._mockTrainingNoticeShown) {
                this._mockTrainingNoticeShown = true;
                showToast("目前訓練流程為模擬模式，指標與產物不是實際模型訓練結果。", "warn");
            }

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

                // 3.1 更新底端總進度條 (防禦性檢查與更新)
                const bottomPct = document.getElementById("bottom-progress-pct");
                if (bottomPct) bottomPct.textContent = `${pct}%`;
                const bottomBar = document.getElementById("bottom-progress-bar");
                if (bottomBar) bottomBar.style.width = `${pct}%`;
                const bottomElapsed = document.getElementById("bottom-elapsed");
                if (bottomElapsed) bottomElapsed.textContent = this.formatTime(status.elapsed_time);
                const bottomRemaining = document.getElementById("bottom-remaining");
                if (bottomRemaining) bottomRemaining.textContent = this.formatTime(status.remaining_time);

                // 預估完成時間 (ETA = 現在時間 + 剩餘秒數)
                if (status.remaining_time > 0) {
                    const etaDate = new Date(Date.now() + status.remaining_time * 1000);
                    const hh = String(etaDate.getHours()).padStart(2, "0");
                    const mm = String(etaDate.getMinutes()).padStart(2, "0");
                    const ss = String(etaDate.getSeconds()).padStart(2, "0");
                    const bottomEta = document.getElementById("bottom-eta");
                    if (bottomEta) bottomEta.textContent = `${hh}:${mm}:${ss}`;
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

                // 還原按鈕與進度條/提示
                const trainProgressSection = document.getElementById("train-progress-section");
                const trainIdleHint = document.getElementById("train-idle-hint");
                const btnStartTrain = document.getElementById("btn-start-train");
                const btnStopTrain = document.getElementById("btn-stop-train");

                if (trainProgressSection) trainProgressSection.style.display = "none";
                if (trainIdleHint) trainIdleHint.style.display = "block";
                if (btnStartTrain) btnStartTrain.style.display = "block";
                if (btnStopTrain) btnStopTrain.style.display = "none";

                // 底端進度條完成
                const bottomPct = document.getElementById("bottom-progress-pct");
                if (bottomPct) bottomPct.textContent = "100%";
                const bottomBar = document.getElementById("bottom-progress-bar");
                if (bottomBar) bottomBar.style.width = "100%";
                const bottomRemaining = document.getElementById("bottom-remaining");
                if (bottomRemaining) bottomRemaining.textContent = "00:00";
                const bottomEta = document.getElementById("bottom-eta");
                if (bottomEta) bottomEta.textContent = "已完成";

                // 展示成果 Dashboard
                this.showTrainingResults(status.best_accuracy);
            } else if (status.status === "stopped") {
                clearInterval(this.trainTimer);
                showToast("訓練已被使用者終止", "warn");

                // 還原按鈕與進度條/提示
                const trainProgressSection = document.getElementById("train-progress-section");
                const trainIdleHint = document.getElementById("train-idle-hint");
                const btnStartTrain = document.getElementById("btn-start-train");
                const btnStopTrain = document.getElementById("btn-stop-train");

                if (trainProgressSection) trainProgressSection.style.display = "none";
                if (trainIdleHint) trainIdleHint.style.display = "block";
                if (btnStartTrain) btnStartTrain.style.display = "block";
                if (btnStopTrain) btnStopTrain.style.display = "none";

                const startPanel = document.getElementById("train-start-panel");
                const dashboardArea = document.getElementById("training-dashboard-area");
                if (startPanel) startPanel.style.display = "block";
                if (dashboardArea) dashboardArea.style.display = "none";

                // 隱藏底端進度條
                const bottomProgress = document.getElementById("train-bottom-progress");
                if (bottomProgress) bottomProgress.classList.remove("visible");
            }
        } catch (e) {
            console.error("輪詢訓練狀態出錯:", e);
        }
    },

    showTrainingResults(bestAcc) {
        this.switchWorkspaceTab("training-workflow-view", "train-metrics");
        const resultsArea = document.getElementById("train-results-area");
        if (resultsArea) resultsArea.style.display = "block";

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
                    this.openAnnotationEditor(s.idx);
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

    isLabelEditorActive() {
        const activeView = document.querySelector(".app-view.active")?.id;
        if (activeView === "label-view") return true;
        if (activeView !== "annotation-view") return false;

        const manualTab = document.querySelector('#annotation-view .workspace-tab-content[data-tab-content="ann-manual"]');
        return !!manualTab && manualTab.style.display !== "none";
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
            const isLabelEditorActive = this.isLabelEditorActive();

            if (isLabelEditorActive && this.reviewMode) {
                if (e.key === "Enter") {
                    e.preventDefault();
                    this.acceptCurrentReviewLabel();
                    return;
                }
                if (key === "x") {
                    e.preventDefault();
                    this.ignoreCurrentReviewImage();
                    return;
                }
                if (key === "a" || e.key === "ArrowLeft") {
                    e.preventDefault();
                    this.navigateReviewCandidate(-1);
                    return;
                }
                if (key === "d" || e.key === "ArrowRight") {
                    e.preventDefault();
                    this.navigateReviewCandidate(1);
                    return;
                }
                if ((e.ctrlKey || e.metaKey) && key === "s") {
                    e.preventDefault();
                    this.saveReviewAndNext();
                    return;
                }
            }

            // A / ArrowLeft = 上一張
            if (key === "a" || e.key === "ArrowLeft") {
                if (isLabelEditorActive) {
                    e.preventDefault();
                    this.navigateImages(-1);
                }
            }

            // D / ArrowRight = 下一張
            if (key === "d" || e.key === "ArrowRight") {
                if (isLabelEditorActive) {
                    e.preventDefault();
                    this.navigateImages(1);
                }
            }

            // R = 矩形標註
            if (key === "r") {
                if (isLabelEditorActive) {
                    this.setLabelToolMode("draw");
                }
            }

            // P = 多邊形標註
            if (key === "p") {
                if (isLabelEditorActive) {
                    this.setLabelToolMode("polygon");
                }
            }

            // H = 選擇模式
            if (key === "h") {
                if (isLabelEditorActive) {
                    this.setLabelToolMode("select");
                }
            }

            // Delete = 刪除選中框
            if (e.key === "Delete") {
                if (isLabelEditorActive) {
                    ImageLabeler.deleteSelectedBox();
                }
            }

            // Ctrl + S = 儲存標籤
            if ((e.ctrlKey || e.metaKey) && key === "s") {
                if (isLabelEditorActive) {
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
            if (res.mock_mode) {
                showToast("目前推論結果為 mock 模式，框位與信心值為模擬資料。", "warn");
            }
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
        if (!this.projectLoaded) {
            const setElText = (id, text) => {
                const el = document.getElementById(id);
                if (el) el.textContent = text;
            };
            setElText("exp-lbl-done", "0");
            setElText("exp-lbl-pending", "0");
            setElText("exp-lbl-ignored", "0");
            setElText("explorer-progress-pct", "0%");
            const bar = document.getElementById("explorer-progress-bar");
            if (bar) bar.style.width = "0%";

            const gallery = document.getElementById("gallery-container");
            if (gallery) {
                gallery.innerHTML = '<div class="empty-hint">請先載入專案以查看大圖牆。</div>';
            }
            this.drawExplorerChart({});
            return;
        }

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
            console.error("[EXPLORER] Dataset stats load failed:", e);
            const reason = e && e.message ? e.message : "請確認後端服務是否仍在執行";
            const message = `資料集載入統計失敗：${reason}`;
            if (this.lastExplorerStatsError !== message) {
                showToast(message, "error");
                this.lastExplorerStatsError = message;
                setTimeout(() => {
                    if (this.lastExplorerStatsError === message) {
                        this.lastExplorerStatsError = "";
                    }
                }, 5000);
            }
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

    async runDatasetChecker() {
        if (!this.projectLoaded) {
            showToast("請先載入或設定工作區專案", "warn");
            this.resetDbHealthUi();
            return;
        }
        
        try {
            showToast("正在分析資料集健康度...", "info");
            const res = await API.checkDataset();
            
            const score = res.health_score ?? 100;
            const total = res.total_images ?? 0;
            const labeled = res.labeled_images ?? 0;
            const empty = res.empty_images ?? 0;
            const broken = res.broken_images ? res.broken_images.length : 0;
            
            const scoreValEl = document.getElementById("ds-health-score-val");
            if (scoreValEl) scoreValEl.textContent = score;
            
            const ring = document.getElementById("ds-health-ring");
            if (ring) {
                const offset = 263.89 - (score / 100) * 263.89;
                ring.style.strokeDashoffset = offset;
            }
            
            const totalValEl = document.getElementById("ds-total-val");
            if (totalValEl) totalValEl.textContent = total;
            
            const labeledValEl = document.getElementById("ds-labeled-val");
            if (labeledValEl) labeledValEl.textContent = labeled;
            
            const emptyValEl = document.getElementById("ds-empty-val");
            if (emptyValEl) emptyValEl.textContent = empty;
            
            const brokenValEl = document.getElementById("ds-broken-val");
            if (brokenValEl) brokenValEl.textContent = broken;
            
            const sizesList = document.getElementById("ds-sizes-list");
            if (sizesList) {
                if (res.image_sizes && Object.keys(res.image_sizes).length > 0) {
                    let html = '<ul style="list-style: none; padding: 0; margin: 0;">';
                    Object.entries(res.image_sizes).forEach(([size, count]) => {
                        html += `<li><i class="fa-solid fa-circle" style="font-size:0.5rem; color:var(--neon-blue); margin-right:6px; vertical-align:middle;"></i> 解析度 <b>${size}</b>: ${count} 張</li>`;
                    });
                    html += '</ul>';
                    sizesList.innerHTML = html;
                } else {
                    sizesList.innerHTML = '<div style="color:var(--text-muted);">無解析度資訊</div>';
                }
            }
            
            const brokenList = document.getElementById("ds-broken-list");
            if (brokenList) {
                if (res.broken_images && res.broken_images.length > 0) {
                    let html = '<ul style="list-style: none; padding: 0; margin: 0; color:var(--neon-red);">';
                    res.broken_images.forEach(path => {
                        html += `<li style="margin-bottom:4px;"><i class="fa-solid fa-triangle-exclamation" style="margin-right:6px;"></i> ${path}</li>`;
                    });
                    html += '</ul>';
                    brokenList.innerHTML = html;
                } else {
                    brokenList.innerHTML = '<div style="color:var(--text-muted);"><i class="fa-solid fa-circle-check" style="color:var(--neon-green); margin-right:6px;"></i>無毀損異常檔案</div>';
                }
            }
            
            this.drawDbHealthChart(res.class_distribution || {});
            
            showToast("資料集健康檢查分析完成！", "success");
            
            const homeScore = document.getElementById("card-db-health-score");
            if (homeScore) homeScore.textContent = `${score}%`;
            
        } catch (err) {
            showToast(`資料集健康檢查失敗: ${err.message}`, "error");
        }
    },

    resetDbHealthUi() {
        const setElText = (id, text) => {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        };
        setElText("ds-health-score-val", "-");
        setElText("ds-total-val", "-");
        setElText("ds-labeled-val", "-");
        setElText("ds-empty-val", "-");
        setElText("ds-broken-val", "-");
        
        const ring = document.getElementById("ds-health-ring");
        if (ring) {
            ring.style.strokeDashoffset = "263.89";
        }
        
        const sizesList = document.getElementById("ds-sizes-list");
        if (sizesList) {
            sizesList.innerHTML = '<div class="empty-hint" style="font-size:0.8rem; color:var(--text-muted);">請先載入專案</div>';
        }
        
        const brokenList = document.getElementById("ds-broken-list");
        if (brokenList) {
            brokenList.innerHTML = '<div class="empty-hint" style="font-size:0.8rem; color:var(--text-muted);">請先載入專案</div>';
        }
        
        this.drawDbHealthChart({});
    },

    drawDbHealthChart(classCounts) {
        const canvas = document.getElementById("ds-class-chart");
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

        ctx.strokeStyle = isLight ? "#e0e0e0" : "rgba(255,255,255,0.1)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padLeft, padTop);
        ctx.lineTo(padLeft, h - padBottom);
        ctx.lineTo(w - padRight, h - padBottom);
        ctx.stroke();

        const barGap = 8;
        const barH = Math.min(30, (chartH - (keys.length - 1) * barGap) / keys.length);
        
        keys.forEach((key, idx) => {
            const val = classCounts[key];
            const barW = (val / maxVal) * chartW;
            const y = padTop + idx * (barH + barGap);

            const grad = ctx.createLinearGradient(padLeft, 0, padLeft + barW, 0);
            grad.addColorStop(0, "var(--neon-blue)");
            grad.addColorStop(1, "var(--neon-green)");
            ctx.fillStyle = grad;
            ctx.fillRect(padLeft, y, barW, barH);

            ctx.fillStyle = isLight ? "#333333" : "#ffffff";
            ctx.font = "11px Outfit, sans-serif";
            ctx.textAlign = "right";
            ctx.fillText(key, padLeft - 8, y + barH / 2 + 4);

            ctx.fillStyle = "var(--text-secondary)";
            ctx.font = "10px monospace";
            ctx.textAlign = "left";
            ctx.fillText(val, padLeft + barW + 6, y + barH / 2 + 3);
        });
    },

    renderExplorerGallery(filter = "all", appendMore = false) {
        const container = document.getElementById("gallery-container");
        if (!container) return;
        
        if (!appendMore) {
            this.galleryLimit = 120;
        }

        container.innerHTML = "";

        const filteredImgs = this.images.filter(img => {
            if (filter === "all") return true;
            return img.status === filter;
        });

        if (filteredImgs.length === 0) {
            container.innerHTML = '<div class="empty-hint" style="grid-column: 1/-1; padding: 40px; text-align: center;">無此類別的影像數據</div>';
            return;
        }

        const imgsToRender = filteredImgs.slice(0, this.galleryLimit);

        imgsToRender.forEach(img => {
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
                <img src="${API_BASE}${img.thumb_url || img.url}" loading="lazy">
                <span class="status-badge ${img.status}">${this.getStatusText(img)}</span>
                <div class="gallery-card-info">
                    <span>${img.path.split('/').pop()}</span>
                    <strong style="color: var(--neon-blue);">${labelText}</strong>
                </div>
            `;

            card.addEventListener("click", () => {
                if (indexInMaster !== -1) {
                    this.openAnnotationEditor(indexInMaster);
                    showToast(`已跳轉至: ${img.path.split('/').pop()}`, "info");
                }
            });

            container.appendChild(card);
        });

        if (filteredImgs.length > this.galleryLimit) {
            const loadMoreContainer = document.createElement("div");
            loadMoreContainer.style.gridColumn = "1 / -1";
            loadMoreContainer.style.textAlign = "center";
            loadMoreContainer.style.padding = "20px 0";

            const loadMoreBtn = document.createElement("button");
            loadMoreBtn.className = "btn btn-secondary";
            loadMoreBtn.innerHTML = `<i class="fa-solid fa-arrow-down-long"></i> 載入更多影像 (目前已載入 ${imgsToRender.length} / ${filteredImgs.length})`;
            loadMoreBtn.onclick = () => {
                this.galleryLimit += 120;
                this.renderExplorerGallery(filter, true);
            };
            loadMoreContainer.appendChild(loadMoreBtn);
            container.appendChild(loadMoreContainer);
        }
    },

    masterImageIndexLookup(path) {
        return this.images.findIndex(img => img.path === path);
    },

    async openAnnotationEditor(index = null) {
        this.switchView("annotation-view");
        this.switchWorkspaceTab("annotation-view", "ann-manual");

        if (this.projectLoaded && (!this.images || this.images.length === 0)) {
            await this.scanDataset();
        }

        if (typeof index === "number" && index >= 0) {
            this.loadImgToLabelView(index);
        } else if (this.currentImgIndex >= 0) {
            this.loadImgToLabelView(this.currentImgIndex);
        } else if (this.images && this.images.length > 0) {
            this.currentImgIndex = 0;
            this.loadImgToLabelView(0);
        } else {
            const placeholder = document.getElementById("canvas-empty-overlay");
            if (placeholder) placeholder.style.display = "flex";
        }
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
        this.switchWorkspaceTab("training-workflow-view", "train-inference");
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
    },

    // ==========================================================================
    // 新增: 系統優化與聯動功能
    // ==========================================================================
    resetUiToEmptyState() {
        this.html("active-project-badge", `<span class="dot pulse"></span> 未載入專案`);
        this.value("input-path-display", "");
        this.value("output-path-display", "");
        this.value("label-input-path-display", "");
        
        const setElText = (id, text) => {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        };
        
        setElText("card-db-total-imgs", "0");
        setElText("card-db-health-score", "-");
        setElText("card-db-version", "-");
        setElText("card-ann-unlabeled", "0");
        setElText("card-ann-pending", "0");
        setElText("card-ann-verified", "0");
        setElText("card-train-map", "-");
        setElText("card-train-run", "-");

        // 重置自動標註指標
        document.querySelectorAll(".card-auto-total-imgs").forEach(el => el.textContent = "0");
        document.querySelectorAll(".card-auto-pending-count").forEach(el => el.textContent = "0");
        document.querySelectorAll(".card-auto-verified-count").forEach(el => el.textContent = "0");
        const processedEl = document.getElementById("card-auto-processed");
        if (processedEl) processedEl.textContent = "0 / 0";
        
        setElText("card-auto-health-score", "-");
        setElText("card-auto-analysis-health", "-");
        setElText("card-auto-train-map", "-");
        setElText("card-auto-train-run", "-");
        
        // 重置所有首頁卡片的狀態 badge 為 未開始
        document.querySelectorAll(".flow-card").forEach(card => {
            card.classList.remove("current-stage");
            const badge = card.querySelector(".flow-card-badge");
            if (badge) {
                badge.className = "flow-card-badge status-gray";
                badge.textContent = "未開始";
            }
        });
        
        // 清空 class tags
        const tagContainer = document.getElementById("data-class-tags");
        if (tagContainer) {
            tagContainer.innerHTML = '<span class="empty-hint">尚未載入專案</span>';
        }
        
        // 標記畫布 placeholder 顯示
        const placeholder = document.getElementById("canvas-empty-overlay");
        if (placeholder) placeholder.style.display = "flex";

        // 清空大圖牆並顯示提示
        const gallery = document.getElementById("gallery-container");
        if (gallery) gallery.innerHTML = '<div class="empty-hint">請先載入專案以查看大圖牆。</div>';
        
        // 重繪直方圖空狀態
        this.drawExplorerChart({});
        this.resetDbHealthUi();

        // 智慧指南預設為空白/引導提示
        const guideDb = document.getElementById("guide-database");
        if (guideDb) {
            guideDb.innerHTML = `
                <div class="guide-header">
                    <i class="fa-solid fa-wand-magic-sparkles"></i>
                    <h3>智慧流程助手</h3>
                </div>
                <div class="guide-content">
                    <div class="guide-status-box status-yellow">
                        <span class="status-indicator"></span>
                        <div class="status-info">
                            <h4>目前階段：資料庫</h4>
                            <p>請先載入或掃描工作目錄。</p>
                        </div>
                    </div>
                    <div class="guide-section">
                        <h4>下一步建議</h4>
                        <ul class="guide-list">
                            <li><i class="fa-solid fa-circle-arrow-right"></i> 在左側設定您的工作目錄路徑。</li>
                            <li><i class="fa-solid fa-circle-arrow-right"></i> 點選「掃描目錄」載入影像與標籤。</li>
                        </ul>
                    </div>
                </div>
            `;
        }

        const guideAnn = document.getElementById("guide-annotation");
        if (guideAnn) {
            guideAnn.innerHTML = `
                <div class="guide-header">
                    <i class="fa-solid fa-wand-magic-sparkles"></i>
                    <h3>智慧流程助手</h3>
                </div>
                <div class="guide-content">
                    <div class="guide-status-box status-yellow">
                        <span class="status-indicator"></span>
                        <div class="status-info">
                            <h4>目前階段：標註中心</h4>
                            <p>請先載入或掃描工作目錄。</p>
                        </div>
                    </div>
                    <div class="guide-section">
                        <h4>下一步建議</h4>
                        <ul class="guide-list">
                            <li><i class="fa-solid fa-circle-arrow-right"></i> 請先在第一步「資料庫」載入並掃描資料。</li>
                        </ul>
                    </div>
                </div>
            `;
        }

        // 標註模式重設
        localStorage.removeItem("yolo-ann-mode");
        this.annotationMode = null;
        this.updateAnnotationModeUi();
    },

    saveProjectState() {
        if (!this.projectLoaded) {
            showToast("目前沒有載入任何專案，無法保存", "warn");
            return;
        }

        const historyStr = localStorage.getItem("yolo-projects-history");
        let history = [];
        if (historyStr) {
            try {
                history = JSON.parse(historyStr);
            } catch (e) {
                history = [];
            }
        }

        // 過濾掉路徑重複的舊記錄
        history = history.filter(item => item.inputPath !== this.inputPath);

        const state = {
            id: Date.now(),
            name: this.projectName || "未命名專案",
            inputPath: this.inputPath,
            outputPath: this.el("output-path-display") ? this.el("output-path-display").value : "",
            classes: this.classes,
            totalImgs: this.images.length,
            healthScore: document.getElementById("card-db-health-score") ? document.getElementById("card-db-health-score").textContent : "-",
            version: document.getElementById("card-db-version") ? document.getElementById("card-db-version").textContent : "-",
            savedAt: new Date().toLocaleString()
        };

        history.push(state);
        localStorage.setItem("yolo-projects-history", JSON.stringify(history));
        showToast("專案狀態已成功保存！", "success");
        this.renderProjectHistory();
    },

    renderProjectHistory() {
        const list = document.getElementById("project-history-list");
        if (!list) return;

        const historyStr = localStorage.getItem("yolo-projects-history");
        let history = [];
        if (historyStr) {
            try {
                history = JSON.parse(historyStr);
            } catch (e) {
                history = [];
            }
        }

        if (history.length === 0) {
            list.innerHTML = `<div class="empty-hint" style="text-align: center; padding: 20px; color: var(--text-muted);">尚無保存的專案紀錄，請在資料庫「資料掃描」保存。</div>`;
            return;
        }

        list.innerHTML = "";
        history.forEach(item => {
            const div = document.createElement("div");
            div.className = "glass-panel";
            div.style = "display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border: 1px solid var(--border-glass); border-radius: 8px;";
            div.innerHTML = `
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <div style="font-weight: 700; color: #fff; font-size: 0.95rem;">
                        <i class="fa-solid fa-folder-open" style="color: var(--neon-blue); margin-right: 6px;"></i> ${item.name}
                    </div>
                    <div style="font-size: 0.78rem; color: var(--text-secondary);">
                        路徑: <span style="font-family: monospace; color: var(--text-muted);">${item.inputPath}</span>
                    </div>
                    <div style="font-size: 0.72rem; color: var(--text-muted); display: flex; gap: 12px; margin-top: 4px; flex-wrap: wrap;">
                        <span>圖片數: <b>${item.totalImgs}</b></span>
                        <span>健康分數: <b>${item.healthScore}</b></span>
                        <span>類別數: <b>${item.classes.length}</b></span>
                        <span>保存時間: <b>${item.savedAt}</b></span>
                    </div>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button class="btn btn-primary btn-sm btn-load-hist" data-id="${item.id}" style="padding: 4px 12px; font-size: 0.8rem; border-radius: 4px;"><i class="fa-solid fa-folder-open"></i> 載入專案</button>
                    <button class="btn btn-danger btn-sm btn-delete-hist" data-id="${item.id}" style="padding: 4px 12px; font-size: 0.8rem; border-radius: 4px;"><i class="fa-solid fa-trash-can"></i> 刪除</button>
                </div>
            `;

            // 綁定載入歷史專案點擊事件
            div.querySelector(".btn-load-hist").addEventListener("click", async () => {
                try {
                    showToast(`正在載入專案「${item.name}」...`, "info");
                    const resLoad = await fetch(`${API_BASE}/api/project/create`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            project_name: item.name,
                            input_path: item.inputPath,
                            output_path: item.outputPath || (item.inputPath + "/runs"),
                            classes: item.classes
                        })
                    });
                    if (!resLoad.ok) throw new Error("後端載入工作區失敗");
                    const project = await resLoad.json();
                    this.onProjectLoaded(project);
                    
                    // 自動切換到資料庫管理工作區且跳轉到 Data Management tab
                    this.switchView("database-view");
                    this.switchWorkspaceTab("database-view", "db-manage");
                    
                    showToast(`專案「${item.name}」已成功載入！`, "success");
                } catch (err) {
                    showToast(`載入專案失敗: ${err.message}`, "error");
                }
            });

            // 綁定刪除歷史專案點擊事件
            div.querySelector(".btn-delete-hist").addEventListener("click", () => {
                if (confirm(`確定要刪除專案「${item.name}」的保存紀錄嗎？`)) {
                    let updated = history.filter(h => h.id !== item.id);
                    localStorage.setItem("yolo-projects-history", JSON.stringify(updated));
                    this.renderProjectHistory();
                    showToast("歷史紀錄已刪除", "info");
                }
            });

            list.appendChild(div);
        });
    },

    setupAnnotationModeEvents() {
        // 點擊 Modal 中的手動標註卡片
        this.on("mode-select-manual", "click", () => {
            this.setAnnotationMode("manual");
        });
        
        // 點擊 Modal 中的自動標註卡片
        this.on("mode-select-auto", "click", () => {
            this.setAnnotationMode("auto");
        });
        
        // 點擊 Modal 的取消按鈕
        this.on("btn-close-mode-modal", "click", () => {
            this.closeModal("annotation-mode-modal");
        });

        // 首頁卡片上的手動與自動標註按鈕
        this.on("btn-home-mode-manual", "click", (e) => {
            e.stopPropagation(); // 防止觸發卡片進入
            this.setAnnotationMode("manual");
        });
        
        this.on("btn-home-mode-auto", "click", (e) => {
            e.stopPropagation(); // 防止觸發卡片進入
            this.setAnnotationMode("auto");
        });


        // 智慧自動標註：基底模型來源 change 事件監聽
        this.on("auto-label-model-source", "change", (e) => {
            const modelGroup = document.getElementById("auto-label-custom-model-group");
            if (modelGroup) {
                modelGroup.style.display = e.target.value === "custom_path" ? "block" : "none";
            }
        });

        // 智慧自動標註：選擇自訂模型路徑按鈕
        this.on("btn-auto-label-choose-model", "click", async () => {
            try {
                const res = await API.chooseFile();
                if (res && res.status === "success" && res.path) {
                    this.value("auto-label-model-path", res.path);
                    showToast(`已選擇自訂模型: ${res.path}`, "success");
                }
            } catch (err) {
                showToast(`選擇檔案失敗: ${err.message}`, "error");
            }
        });

        // 智慧自動標註：信心度 slider 拖曳值即時更新
        this.on("auto-label-confidence", "input", (e) => {
            const valEl = document.getElementById("auto-label-confidence-val");
            if (valEl) {
                valEl.textContent = parseFloat(e.target.value).toFixed(2);
            }
        });

        // 智慧自動標註：NMS IoU slider 拖曳值即時更新
        this.on("auto-label-iou", "input", (e) => {
            const valEl = document.getElementById("auto-label-iou-val");
            if (valEl) {
                valEl.textContent = parseFloat(e.target.value).toFixed(2);
            }
        });

        // 執行自動標註任務按鈕 (啟動背景 YOLO 推理)
        this.on("btn-run-autolabel", "click", async () => {
            if (!this.projectLoaded) {
                showToast("請先在資料庫管理載入或建立專案！", "warn");
                return;
            }

            const dirPath = this.inputPath;
            if (!dirPath) {
                showToast("專案資料目錄不存在，請先在資料庫設定 Input 資料夾路徑。", "warn");
                return;
            }

            const modelSource = document.getElementById("auto-label-model-source")?.value || "project_best";
            const modelPath = document.getElementById("auto-label-model-path")?.value.trim() || "";
            const confidence = parseFloat(document.getElementById("auto-label-confidence")?.value || "0.75");
            const iou = parseFloat(document.getElementById("auto-label-iou")?.value || "0.50");

            if (modelSource === "custom_path" && !modelPath) {
                showToast("請選擇自訂模型權重路徑！", "warn");
                return;
            }

            const runBtn = document.getElementById("btn-run-autolabel");
            const stopBtn = document.getElementById("btn-stop-autolabel");
            const monitorPanel = document.getElementById("autolabel-monitor");

            if (runBtn) {
                runBtn.disabled = true;
                runBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在啟動...';
            }

            try {
                const payload = {
                    model_source: modelSource,
                    model_path: modelPath,
                    confidence: confidence,
                    iou: iou
                };

                const res = await API.startAutoLabel(payload);
                if (res && res.status === "started" && res.task_id) {
                    this.currentAutoLabelTaskId = res.task_id;
                    this.autoLabelStartTime = Date.now();

                    // 切換按鈕狀態
                    if (runBtn) runBtn.style.display = "none";
                    if (stopBtn) {
                        stopBtn.style.display = "inline-flex";
                        stopBtn.disabled = false;
                        stopBtn.innerHTML = '<i class="fa-solid fa-stop"></i> 停止任務';
                    }

                    // 重置並顯示監控面版
                    if (monitorPanel) monitorPanel.style.display = "block";
                    
                    const progressText = document.getElementById("autolabel-progress-text");
                    if (progressText) progressText.textContent = "0 / 0 張";
                    
                    const progressBar = document.getElementById("autolabel-progress-bar");
                    if (progressBar) progressBar.style.width = "0%";
                    
                    const logEl = document.getElementById("autolabel-log");
                    if (logEl) logEl.innerHTML = "<div>正在連接背景標註服務...</div>";

                    const elapsedEl = document.getElementById("autolabel-elapsed");
                    if (elapsedEl) elapsedEl.textContent = "0s";

                    showToast("背景自動標註任務已成功啟動！", "success");
                    this.startAutoLabelPolling(res.task_id);
                } else {
                    throw new Error("伺服器未回傳有效任務識別碼");
                }
            } catch (err) {
                showToast(`啟動自動標註失敗: ${err.message}`, "error");
                if (runBtn) {
                    runBtn.disabled = false;
                    runBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> 執行自動標註任務';
                }
            }
        });

        // 停止自動標註按鈕
        this.on("btn-stop-autolabel", "click", async () => {
            if (!this.currentAutoLabelTaskId) return;
            
            const stopBtn = document.getElementById("btn-stop-autolabel");
            if (stopBtn) {
                stopBtn.disabled = true;
                stopBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在停止...';
            }

            try {
                await API.stopAutoLabel(this.currentAutoLabelTaskId);
                showToast("已發送停止指令，正在寫入已完成的標註，請稍候...", "info");
            } catch (err) {
                showToast(`停止自動標註失敗: ${err.message}`, "error");
                if (stopBtn) {
                    stopBtn.disabled = false;
                    stopBtn.innerHTML = '<i class="fa-solid fa-stop"></i> 停止任務';
                }
            }
        });

        // 初始化渲染
        this.updateAnnotationModeUi();
    },

    // ---------------------------------------------------------------------------
    // 自動標註背景任務：輪詢、渲染、bbox 繪制
    // ---------------------------------------------------------------------------

    startAutoLabelPolling(taskId) {
        // 清除舊 timer
        if (this.autoLabelTimer) clearInterval(this.autoLabelTimer);
        if (this.autoLabelElapsedTimer) clearInterval(this.autoLabelElapsedTimer);

        // 展示已用時間計數
        this.autoLabelElapsedTimer = setInterval(() => {
            const el = document.getElementById("autolabel-elapsed");
            if (el && this.autoLabelStartTime) {
                const sec = Math.floor((Date.now() - this.autoLabelStartTime) / 1000);
                el.textContent = sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`;
            }
        }, 1000);

        // 輪詢任務狀態
        this.autoLabelTimer = setInterval(async () => {
            try {
                const status = await API.getAutoLabelStatus(taskId);
                this.renderAutoLabelStatus(status);

                if (["completed", "error", "stopped"].includes(status.status)) {
                    clearInterval(this.autoLabelTimer);
                    clearInterval(this.autoLabelElapsedTimer);
                    this.autoLabelTimer = null;
                    this.autoLabelElapsedTimer = null;

                    // 恢復按鈕
                    const runBtn = document.getElementById("btn-run-autolabel");
                    const stopBtn = document.getElementById("btn-stop-autolabel");
                    if (runBtn) { runBtn.style.display = "inline-flex"; runBtn.disabled = false; runBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> 執行自動標註任務'; }
                    if (stopBtn) { stopBtn.style.display = "none"; stopBtn.disabled = false; stopBtn.innerHTML = '<i class="fa-solid fa-stop"></i> 停止任務'; }

                    if (status.status === "completed") {
                        await this.scanDataset();
                        this.renderAutoLabelResultReport(status);

                        const totalBoxes = status.total_annotations || status.total_boxes || 0;
                        const detectedImages = status.detected_images || 0;

                        if (totalBoxes > 0) {
                            showToast(`自動標註完成：${detectedImages} 張圖片產生 ${totalBoxes} 個候選框。`, "success");
                            this.enterCandidateReviewMode();
                        } else {
                            showToast("自動標註完成，但沒有產生任何候選框。請降低 confidence 或檢查模型。", "warn");
                        }
                    } else if (status.status === "stopped") {
                        showToast(`任務已停止，已完成 ${status.processed} / ${status.total} 張圖片。`, "info");
                        await this.scanDataset();
                    } else if (status.status === "error") {
                        showToast(`自動標註發生錯誤: ${status.error}`, "error");
                    }
                }
            } catch (err) {
                console.error("[AUTOLABEL] 輪詢失敗:", err);
            }
        }, 1000);
    },

    renderAutoLabelStatus(status) {
        const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        const setHtml = (id, val) => { const el = document.getElementById(id); if (el) el.innerHTML = val; };

        // 狀態 Badge
        const badge = document.getElementById("autolabel-status-badge");
        if (badge) {
            const MAP = { running: ["running", "推理中"], stopping: ["warn", "停止中"], completed: ["success", "完成"], stopped: ["warn", "已停止"], error: ["error", "錯誤"] };
            const [cls, label] = MAP[status.status] || ["info", status.status];
            badge.className = `status-badge ${cls}`;
            badge.textContent = label;
        }

        // 模型名稱
        const modelName = status.model ? status.model.split(/[\/\\]/).pop() : "載入中...";
        setText("autolabel-model-name", modelName);

        // 進度
        const total = status.total || 0;
        const processed = status.processed || 0;
        const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
        const bar = document.getElementById("autolabel-progress-bar");
        if (bar) bar.style.width = `${pct}%`;
        setText("autolabel-progress-text", `${processed} / ${total} 張`);
        setText("autolabel-processed-count", status.processed || 0);
        setText("autolabel-detected-count", status.detected_images || 0);
        setText("autolabel-empty-count", status.empty_images || 0);
        setText("autolabel-failed-count", status.failed || 0);
        setText("autolabel-total-boxes", status.total_annotations || status.total_boxes || 0);

        // 目前檔名
        const fileName = status.current_image ? status.current_image.split("/").pop() : (
            status.status === "completed" ? "已完成" : "等待中..."
        );
        setText("autolabel-current-file", fileName);

        // 即時圖片預覽
        const img = document.getElementById("autolabel-preview-img");
        const placeholder = document.getElementById("autolabel-preview-placeholder");
        if (img && status.current_image_url) {
            if (!img.dataset.autolabelBound) {
                img.addEventListener("load", () => {
                    this.syncAutoLabelPreviewOverlay();
                    const overlayOnLoad = document.getElementById("autolabel-preview-overlay");
                    if (overlayOnLoad) {
                        overlayOnLoad.innerHTML = "";
                        if (this.autolabelLastPredictions && this.autolabelLastPredictions.length > 0) {
                            this.renderAutoLabelBboxes(this.autolabelLastPredictions, overlayOnLoad);
                        }
                    }
                });
                img.dataset.autolabelBound = "1";
            }
            img.src = status.current_image_url + "?t=" + Date.now();
            img.style.display = "block";
            if (placeholder) placeholder.style.display = "none";
        } else if (img && !status.current_image_url) {
            img.style.display = "none";
            if (placeholder) placeholder.style.display = "block";
        }

        // Bbox 繪製
        const overlay = document.getElementById("autolabel-preview-overlay");
        if (overlay) {
            this.autolabelLastPredictions = status.current_predictions || [];
            this.syncAutoLabelPreviewOverlay();
            overlay.innerHTML = "";
            if (status.current_predictions && status.current_predictions.length > 0) {
                this.renderAutoLabelBboxes(status.current_predictions, overlay);
            }
        }

        // Log
        const logEl = document.getElementById("autolabel-log");
        if (logEl && status.log) {
            const lines = status.log.slice(-20);
            logEl.innerHTML = lines.map(l => `<div>${l}</div>`).join("");
            logEl.scrollTop = logEl.scrollHeight;
        }
    },

    syncAutoLabelPreviewOverlay() {
        const container = document.getElementById("autolabel-preview-container");
        const img = document.getElementById("autolabel-preview-img");
        const overlay = document.getElementById("autolabel-preview-overlay");
        if (!container || !img || !overlay || img.style.display === "none") return;

        const containerRect = container.getBoundingClientRect();
        const imgRect = img.getBoundingClientRect();
        const width = Math.max(0, Math.round(imgRect.width));
        const height = Math.max(0, Math.round(imgRect.height));

        overlay.style.width = `${width}px`;
        overlay.style.height = `${height}px`;
        overlay.style.left = `${Math.max(0, Math.round(imgRect.left - containerRect.left))}px`;
        overlay.style.top = `${Math.max(0, Math.round(imgRect.top - containerRect.top))}px`;
    },

    renderAutoLabelBboxes(predictions, containerEl) {
        // 使用百分比絕對定位畫出 bbox 或 SVG 畫出 polygon
        const COLORS = ["#f97316", "#3b82f6", "#10b981", "#ef4444", "#a855f7", "#eab308", "#06b6d4"];
        
        let svgEl = null;
        const hasPolygon = predictions.some(pred => pred.type === "polygon" || !!pred.points);
        if (hasPolygon) {
            svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svgEl.setAttribute("viewBox", "0 0 1 1");
            svgEl.setAttribute("preserveAspectRatio", "none");
            svgEl.setAttribute("style", "position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; overflow: hidden;");
            containerEl.appendChild(svgEl);
        }

        predictions.forEach((pred, i) => {
            const color = COLORS[i % COLORS.length];
            const isPolygon = pred.type === "polygon" || !!pred.points;

            if (isPolygon && pred.points && pred.points.length > 0) {
                // 利用 SVG polygon 繪製多邊形
                const ptsStr = pred.points.map(pt => `${pt[0]},${pt[1]}`).join(" ");
                const outline = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
                outline.setAttribute("points", ptsStr);
                outline.setAttribute("style", "fill: none; stroke: rgba(0, 0, 0, 0.82); stroke-width: 5; vector-effect: non-scaling-stroke;");
                svgEl.appendChild(outline);

                const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
                poly.setAttribute("points", ptsStr);
                poly.setAttribute("style", `fill: ${color}66; stroke: ${color}; stroke-width: 3; vector-effect: non-scaling-stroke;`);
                svgEl.appendChild(poly);

                // 標籤文字 (使用 HTML 絕對定位在第一個點上)
                const firstPt = pred.points[0];
                const chip = document.createElement("span");
                chip.style.cssText = [
                    "position: absolute",
                    `left: ${firstPt[0] * 100}%`,
                    `top: ${firstPt[1] * 100}%`,
                    `background: ${color}`,
                    "color: #fff",
                    "font-size: 11px",
                    "font-weight: 800",
                    "padding: 2px 6px",
                    "border-radius: 4px",
                    "box-shadow: 0 0 0 2px rgba(0,0,0,0.72)",
                    "white-space: nowrap",
                    "transform: translate(-50%, -100%)",
                    "pointer-events: none",
                    "z-index: 10"
                ].join(";");
                chip.textContent = `${pred.label} ${(pred.confidence * 100).toFixed(0)}%`;
                containerEl.appendChild(chip);
            } else {
                const x = pred.x !== undefined ? pred.x : (pred.bbox ? pred.bbox.x : 0);
                const y = pred.y !== undefined ? pred.y : (pred.bbox ? pred.bbox.y : 0);
                const w = pred.w !== undefined ? pred.w : (pred.bbox ? pred.bbox.w : 0);
                const h = pred.h !== undefined ? pred.h : (pred.bbox ? pred.bbox.h : 0);

                const box = document.createElement("div");
                box.style.cssText = [
                    "position: absolute",
                    `left: ${x * 100}%`,
                    `top: ${y * 100}%`,
                    `width: ${w * 100}%`,
                    `height: ${h * 100}%`,
                    `border: 2px solid ${color}`,
                    "border-radius: 2px",
                    "box-sizing: border-box",
                    "pointer-events: none"
                ].join(";");

                // label chip
                const chip = document.createElement("span");
                chip.style.cssText = [
                    "position: absolute",
                    "top: -18px",
                    "left: 0",
                    `background: ${color}`,
                    "color: #fff",
                    "font-size: 10px",
                    "padding: 1px 4px",
                    "border-radius: 3px",
                    "white-space: nowrap",
                    "line-height: 16px"
                ].join(";");
                chip.textContent = `${pred.label} ${(pred.confidence * 100).toFixed(0)}%`;
                box.appendChild(chip);
                containerEl.appendChild(box);
            }
        });
    },

    setAnnotationMode(mode) {
        localStorage.setItem("yolo-ann-mode", mode);
        this.annotationMode = mode;
        this.updateAnnotationModeUi();
        this.closeModal("annotation-mode-modal");
        
        // 選擇模式後自動切換至對應的 Workspace Tab
        if (document.getElementById("annotation-view")?.classList.contains("active")) {
            const targetTab = mode === "manual" ? "ann-manual" : "ann-auto";
            this.switchWorkspaceTab("annotation-view", targetTab);
        }
        showToast(`已切換至: ${mode === "manual" ? "手動標註模式" : "自動標註模式"}`, "success");
    },

    updateAnnotationModeUi() {
        const mode = localStorage.getItem("yolo-ann-mode");
        this.annotationMode = mode;
        
        const btnManual = document.getElementById("btn-home-mode-manual");
        const btnAuto = document.getElementById("btn-home-mode-auto");
        
        // 重設首頁大按鈕的狀態 (常駐/預設為手動標註)
        if (btnManual && btnAuto) {
            btnManual.classList.remove("active");
            btnAuto.classList.remove("active");
            
            if (mode === "auto") {
                btnAuto.classList.add("active");
            } else {
                btnManual.classList.add("active");
            }
        }

        // 切換首頁卡片流程容器
        const manualContainer = document.getElementById("cards-manual-container");
        const autoContainer = document.getElementById("cards-auto-container");
        if (manualContainer && autoContainer) {
            if (mode === "auto") {
                manualContainer.style.display = "none";
                autoContainer.style.display = "grid";
            } else {
                manualContainer.style.display = "grid";
                autoContainer.style.display = "none";
            }
        }
        
        // 標註中心側邊欄：保留的核心 4 個項目全數顯示
        const sidebar = document.querySelector("#annotation-view .sidebar-menu");
        if (sidebar) {
            sidebar.querySelectorAll("li").forEach(li => {
                li.classList.remove("disabled-semi-transparent");
                li.style.display = "";
            });
        }
    },

    // ==========================================================================
    // 標註生命週期 (Review / Verified / Unlabeled / QA / Versions) 實作
    // ==========================================================================
    renderReviewGallery() {
        const container = document.getElementById("review-gallery-container");
        if (!container) return;

        // review 渲染 AI 候選標註
        const items = (this.images || []).filter(img => {
            return this.isAiPendingLabel(img) && img.label && img.label !== "[]" && img.label !== "";
        });

        this.renderMiniGallery(container, items, "無待審核的候選標籤。");
    },

    renderVerifiedGallery() {
        const container = document.getElementById("verified-gallery-container");
        if (!container) return;

        // verified 渲染 done 或 verified 圖片
        const items = (this.images || []).filter(img => {
            return ["done", "verified"].includes(img.status);
        });

        this.renderMiniGallery(container, items, "無已確認標籤。");
    },

    renderUnlabeledGallery() {
        const container = document.getElementById("unlabeled-gallery-container");
        if (!container) return;

        // unlabeled 渲染未標註圖片：label 為空或 "[]"，且狀態不是 ignore
        const items = (this.images || []).filter(img => {
            const hasNoLabel = !img.label || img.label === "[]" || img.label === "";
            return hasNoLabel && img.status !== "ignore";
        });

        this.renderMiniGallery(container, items, "無未標註影像。");
    },

    renderMiniGallery(container, items, emptyText) {
        container.innerHTML = "";

        if (items.length === 0) {
            container.innerHTML = `<div class="empty-hint" style="grid-column: 1 / -1; padding: 20px; text-align: center; color: var(--text-secondary);">${emptyText}</div>`;
            return;
        }

        items.forEach(img => {
            const indexInMaster = this.masterImageIndexLookup(img.path);

            const card = document.createElement("div");
            card.className = "gallery-card mini";
            card.style.cursor = "pointer";

            let labelText = "未標註";
            if (img.label) {
                try {
                    if (img.label.startsWith("[")) {
                        const boxes = JSON.parse(img.label);
                        if (boxes.length > 0) {
                            labelText = `${boxes[0].label} (${boxes.length})`;
                        }
                    }
                } catch (e) {}
            }

            const imgUrl = `${API_BASE}${img.thumb_url || img.url}`;

            card.innerHTML = `
                <div class="gallery-card-img-wrapper" style="position: relative; aspect-ratio: 4/3; background: var(--bg-dark); border-radius: 6px; overflow: hidden;">
                    <img src="${imgUrl}" loading="lazy" style="width: 100%; height: 100%; object-fit: cover;">
                    <span class="status-badge ${img.status}" style="position: absolute; top: 6px; right: 6px; font-size: 10px; padding: 2px 6px; border-radius: 4px;">${this.getStatusText(img)}</span>
                </div>
                <div class="gallery-card-info" style="padding: 8px 4px;">
                    <span style="font-size: 11px; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary);">${img.path.split('/').pop().split('\\').pop()}</span>
                    <strong style="font-size: 12px; display: block; margin-top: 2px; color: var(--neon-blue);">${labelText}</strong>
                </div>
            `;

            card.addEventListener("click", () => {
                if (indexInMaster !== -1) {
                    this.openAnnotationEditor(indexInMaster);
                    showToast(`已載入: ${img.path.split('/').pop()}`, "info");
                }
            });

            container.appendChild(card);
        });
    },

    runAnnotationQualityCheck() {
        if (!this.projectLoaded) return;

        const issues = {
            tinyBoxes: [],
            outOfBounds: [],
            invalidClass: [],
            emptyDone: [],
            duplicateOverlap: []
        };

        this.images.forEach(img => {
            const filename = img.path.split('/').pop().split('\\').pop();

            if (!img.label || img.label === "[]" || img.label === "") {
                if (["done", "verified"].includes(img.status)) {
                    issues.emptyDone.push({ path: img.path, filename });
                }
                return;
            }

            let boxes = [];
            try {
                if (img.label.startsWith("[")) {
                    boxes = JSON.parse(img.label);
                } else {
                    return;
                }
            } catch (e) {
                issues.invalidClass.push({ path: img.path, filename, label: "格式損毀" });
                return;
            }

            let tinyCount = 0;
            let oobCount = 0;
            let invalidClsCount = 0;

            boxes.forEach(box => {
                if (box.w < 0.01 || box.h < 0.01) {
                    tinyCount++;
                }

                if (box.x < 0 || box.y < 0 || box.x + box.w > 1.01 || box.y + box.h > 1.01) {
                    oobCount++;
                }

                if (!this.classes.includes(box.label)) {
                    invalidClsCount++;
                }
            });

            if (tinyCount > 0) issues.tinyBoxes.push({ path: img.path, filename, count: tinyCount });
            if (oobCount > 0) issues.outOfBounds.push({ path: img.path, filename, count: oobCount });
            if (invalidClsCount > 0) issues.invalidClass.push({ path: img.path, filename, label: `無效類別 (${invalidClsCount} 個)` });

            let overlapCount = 0;
            for (let i = 0; i < boxes.length; i++) {
                for (let j = i + 1; j < boxes.length; j++) {
                    const iou = this.calculateBboxIoU(boxes[i], boxes[j]);
                    if (iou > 0.95) {
                        overlapCount++;
                    }
                }
            }
            if (overlapCount > 0) {
                issues.duplicateOverlap.push({ path: img.path, filename, count: overlapCount });
            }
        });

        this.renderAnnotationQualityReport(issues);
    },

    calculateBboxIoU(box1, box2) {
        const x1 = Math.max(box1.x, box2.x);
        const y1 = Math.max(box1.y, box2.y);
        const x2 = Math.min(box1.x + box1.w, box2.x + box2.w);
        const y2 = Math.min(box1.y + box1.h, box2.y + box2.h);

        const w = Math.max(0, x2 - x1);
        const h = Math.max(0, y2 - y1);
        const inter = w * h;

        const union = (box1.w * box1.h) + (box2.w * box2.h) - inter;
        if (union <= 0) return 0;
        return inter / union;
    },

    renderAnnotationQualityReport(issues) {
        const container = document.getElementById("qa-warnings-container");
        if (!container) return;

        container.innerHTML = "";

        const totalIssues = issues.tinyBoxes.length + issues.outOfBounds.length + issues.invalidClass.length + issues.emptyDone.length + issues.duplicateOverlap.length;

        if (totalIssues === 0) {
            container.innerHTML = `
                <div class="guide-warning-item info" style="display: flex; align-items: flex-start; gap: 10px; background: rgba(46, 204, 113, 0.1); border: 1px solid rgba(46, 204, 113, 0.2); padding: 12px; border-radius: 8px; color: var(--text-primary);">
                    <i class="fa-solid fa-circle-check" style="color: #2ecc71; margin-top: 3px; font-size: 15px;"></i>
                    <div>
                        <strong style="display: block; font-size: 13px; color: #2ecc71;">檢查通過</strong>
                        <span style="font-size: 12px; color: var(--text-secondary);">未發現標註框過小、越界、重複重疊或無效類別等標記異常。</span>
                    </div>
                </div>
            `;
            return;
        }

        const addWarning = (type, title, desc, items) => {
            const listHtml = items.map(item => {
                const indexInMaster = this.masterImageIndexLookup(item.path);
                return `<span class="qa-item-link" style="color: var(--neon-blue); text-decoration: underline; cursor: pointer; margin-right: 8px; font-size: 11px;" data-index="${indexInMaster}">${item.filename}</span>`;
            }).join(" ");

            const itemDiv = document.createElement("div");
            itemDiv.className = `guide-warning-item ${type === 'error' ? 'danger' : 'warn'}`;
            const itemBg = type === 'error' ? 'rgba(231, 76, 60, 0.08)' : 'rgba(241, 196, 15, 0.08)';
            const borderCol = type === 'error' ? 'rgba(231, 76, 60, 0.2)' : 'rgba(241, 196, 15, 0.2)';
            const iconCol = type === 'error' ? '#e74c3c' : '#f1c40f';
            const icon = type === 'error' ? 'fa-circle-xmark' : 'fa-triangle-exclamation';

            itemDiv.setAttribute("style", `display: flex; align-items: flex-start; gap: 10px; background: ${itemBg}; border: 1px solid ${borderCol}; padding: 12px; border-radius: 8px; color: var(--text-primary); margin-bottom: 8px;`);
            itemDiv.innerHTML = `
                <i class="fa-solid ${icon}" style="color: ${iconCol}; margin-top: 3px; font-size: 15px;"></i>
                <div style="flex: 1;">
                    <strong style="display: block; font-size: 13px; color: ${iconCol};">${title}</strong>
                    <span style="font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 6px;">${desc}</span>
                    <div style="display: flex; flex-wrap: wrap; gap: 4px;">${listHtml}</div>
                </div>
            `;

            itemDiv.querySelectorAll(".qa-item-link").forEach(link => {
                link.addEventListener("click", (e) => {
                    const idx = parseInt(e.target.getAttribute("data-index"));
                    if (idx !== -1 && !isNaN(idx)) {
                        this.openAnnotationEditor(idx);
                    }
                });
            });

            container.appendChild(itemDiv);
        };

        if (issues.outOfBounds.length > 0) {
            addWarning("error", "標註框越界 (Out of Bounds)", `發現 ${issues.outOfBounds.length} 張影像的標註框超出邊界，這可能在部分 YOLO 版本中引起致命錯誤或異常裁剪。`, issues.outOfBounds);
        }
        if (issues.invalidClass.length > 0) {
            addWarning("error", "無效或損毀的標籤類別", `發現 ${issues.invalidClass.length} 張影像包含未定義於類別清單的標籤，或 JSON 格式損毀。`, issues.invalidClass);
        }
        if (issues.tinyBoxes.length > 0) {
            addWarning("warn", "邊界框過小 (Too Small)", `發現 ${issues.tinyBoxes.length} 張影像的標記框極小 (寬度或高度小於 1%)，可能會被 YOLO 演算法忽略。`, issues.tinyBoxes);
        }
        if (issues.duplicateOverlap.length > 0) {
            addWarning("warn", "高重疊重複標註 (High Overlap)", `偵測到 ${issues.duplicateOverlap.length} 張影像中存在重疊率極高 (IoU > 0.95) 的重複框，可能為誤標。`, issues.duplicateOverlap);
        }
        if (issues.emptyDone.length > 0) {
            addWarning("warn", "已確認標記但無標框", `發現 ${issues.emptyDone.length} 張標記狀態為已完成，但沒有標註任何邊界框，請確認是否為背景圖片。`, issues.emptyDone);
        }
    },

    renderAutoLabelResultReport(status) {
        const reportPanel = document.getElementById("autolabel-result-report");
        if (!reportPanel) return;

        reportPanel.style.display = "block";

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };

        const totalBoxes = status.total_annotations || status.total_boxes || 0;
        const detectedImages = status.detected_images || 0;
        const emptyImages = status.empty_images || 0;
        const processed = status.processed || 0;

        setVal("result-processed", processed);
        setVal("result-detected", detectedImages);
        setVal("result-empty", emptyImages);
        setVal("result-boxes", totalBoxes);

        const isSegment = status.task_type === "segment";
        const labelTerm = isSegment ? "候選遮罩總數" : "候選框總數";
        const imageTerm = isSegment ? "有遮罩圖片" : "有框圖片";
        const emptyTerm = isSegment ? "無遮罩圖片" : "無框圖片";

        // 動態更新卡片的標題文字
        const reportGrid = reportPanel.querySelector(".result-grid");
        if (reportGrid) {
            const cards = reportGrid.querySelectorAll(".result-card");
            if (cards.length >= 4) {
                const detectedSpan = cards[1].querySelector("span");
                if (detectedSpan) detectedSpan.textContent = imageTerm;

                const emptySpan = cards[2].querySelector("span");
                if (emptySpan) emptySpan.textContent = emptyTerm;

                const boxesSpan = cards[3].querySelector("span");
                if (boxesSpan) boxesSpan.textContent = labelTerm;
            }
        }

        // 類別分布
        const distEl = document.getElementById("autolabel-class-distribution");
        const adviceEl = document.getElementById("autolabel-result-advice");
        
        if (distEl) distEl.innerHTML = "";
        if (adviceEl) adviceEl.innerHTML = "";

        if (totalBoxes > 0 && distEl) {
            let classDistributionHtml = `<strong style="display: block; margin-bottom: 8px; color: var(--text-primary);">${isSegment ? '偵測遮罩類別分布' : '偵測類別分布'}：</strong><div style="display: flex; flex-wrap: wrap; gap: 8px;">`;
            for (const [cls, count] of Object.entries(status.class_counts || {})) {
                classDistributionHtml += `<span style="background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.2); padding: 4px 8px; border-radius: 6px; font-size: 11px; color: var(--neon-blue); font-weight: bold;">${cls}: ${count} 個</span>`;
            }
            classDistributionHtml += '</div>';
            distEl.innerHTML = classDistributionHtml;
        }

        // 若完全沒有偵測到任何框
        if (totalBoxes === 0 && adviceEl) {
            const warningTitle = isSegment ? "無候選遮罩產生" : "無候選標註框產生";
            const warningDesc = isSegment
                ? "本次自動標註完成，但完全沒有偵測到任何遮罩。這通常是由於 <b>Confidence (信心度) 閾值設得過高</b>，或者模型權重與當前影像類別不匹配。<br>建議將 Confidence 下調至 0.25 ~ 0.35 重試，或更換模型。"
                : "本次自動標註完成，但完全沒有偵測到任何標籤。這通常是由於 <b>Confidence (信心度) 閾值設得過高</b>，或者模型權重與當前影像類別不匹配。<br>建議將 Confidence 下調至 0.25 ~ 0.35 重試，或更換模型。";

            adviceEl.innerHTML = `
                <div class="guide-warning-item warn" style="display: flex; align-items: flex-start; gap: 10px; background: rgba(241, 196, 15, 0.08); border: 1px solid rgba(241, 196, 15, 0.2); padding: 12px; border-radius: 8px; color: var(--text-primary); margin-bottom: 12px;">
                    <i class="fa-solid fa-triangle-exclamation" style="color: #f1c40f; margin-top: 3px; font-size: 15px;"></i>
                    <div style="flex: 1;">
                        <strong style="display: block; font-size: 13px; color: #f1c40f; margin-bottom: 4px;">${warningTitle}</strong>
                        <span style="font-size: 12px; color: var(--text-secondary); line-height: 1.6;">
                            ${warningDesc}
                        </span>
                    </div>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button class="btn btn-secondary btn-sm" id="btn-autolabel-lower-conf" style="font-weight: bold; border-color: #f1c40f; color: #f1c40f; padding: 6px 12px; border-radius: 6px; background: rgba(241, 196, 15, 0.05); cursor: pointer;"><i class="fa-solid fa-arrows-down-to-line"></i> 將 Confidence 調整為 0.35 並重試</button>
                </div>
            `;

            // 綁定「調整 Confidence 並重試」按鈕
            const lowerConfBtn = document.getElementById("btn-autolabel-lower-conf");
            if (lowerConfBtn) {
                lowerConfBtn.addEventListener("click", () => {
                    const confInput = document.getElementById("auto-label-confidence");
                    const confValText = document.getElementById("auto-label-confidence-val");
                    if (confInput) {
                        confInput.value = 0.35;
                        if (confValText) confValText.textContent = "0.35";
                        
                        // 隱藏結果面板，並自動點擊「執行自動標註任務」重跑
                        reportPanel.style.display = "none";
                        const runBtn = document.getElementById("btn-run-autolabel");
                        if (runBtn) {
                            runBtn.click();
                        }
                    }
                });
            }
        }
    },

    async renderLabelVersions() {
        if (!this.projectLoaded) return;

        try {
            const res = await API.listLabelVersions();
            const tbody = document.getElementById("label-versions-tbody");
            if (!tbody) return;

            tbody.innerHTML = "";

            if (!res.versions || res.versions.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-secondary); padding: 20px;">尚無任何標籤版本備份記錄</td></tr>`;
                return;
            }

            res.versions.forEach((v, index) => {
                const tr = document.createElement("tr");
                const isCurrent = index === 0;
                
                let actionBtn = "";
                if (isCurrent) {
                    actionBtn = `<span class="val badge done" style="background: rgba(46, 204, 113, 0.2); color: #2ecc71; padding: 4px 8px; border-radius: 4px;">目前最新</span>`;
                } else {
                    actionBtn = `<button class="btn btn-secondary btn-sm btn-restore-version" data-version="${v.version}" style="padding: 4px 8px; font-size: 11px;"><i class="fa-solid fa-undo"></i> 還原此版</button>`;
                }

                tr.innerHTML = `
                    <td style="font-weight: bold; color: var(--text-primary);">${v.name}</td>
                    <td>${v.total_boxes.toLocaleString()} 個</td>
                    <td>${v.verified_images.toLocaleString()} 張</td>
                    <td style="color: var(--text-secondary);">${v.timestamp}</td>
                    <td>${actionBtn}</td>
                `;

                const restoreBtn = tr.querySelector(".btn-restore-version");
                if (restoreBtn) {
                    restoreBtn.addEventListener("click", async () => {
                        if (confirm(`您確定要將目前的標記還原到「${v.name}」版本嗎？\n這會覆寫當前的 labels.csv 標記！`)) {
                            try {
                                const restoreRes = await API.restoreLabelVersion(v.version);
                                showToast(restoreRes.message || "標記還原成功", "success");
                                await this.scanDataset();
                                this.renderLabelVersions();
                            } catch (err) {
                                showToast(`還原失敗: ${err.message}`, "error");
                            }
                        }
                    });
                }

                tbody.appendChild(tr);
            });
        } catch (err) {
            showToast(`載入版本列表失敗: ${err.message}`, "error");
        }
    },

    hasValidBoxes(label) {
        if (!label || label === "[]" || label.trim() === "") return false;
        try {
            const boxes = JSON.parse(label);
            return Array.isArray(boxes) && boxes.length > 0;
        } catch {
            return false;
        }
    },

    getPendingReviewItems() {
        return (this.images || []).filter(img => {
            return this.isAiPendingLabel(img) && this.hasValidBoxes(img.label);
        });
    },

    enterCandidateReviewMode() {
        this.reviewQueue = this.getPendingReviewItems();

        if (this.reviewQueue.length === 0) {
            showToast("自動標註完成，但沒有需要審核的候選框。", "info");
            this.switchWorkspaceTab("annotation-view", "ann-manual");
            return;
        }

        this.reviewMode = true;
        this.currentReviewIndex = 0;

        const first = this.reviewQueue[0];
        const masterIndex = this.masterImageIndexLookup(first.path);

        if (masterIndex === -1) {
            showToast("找不到候選圖片索引，請重新掃描資料庫。", "error");
            return;
        }

        // 進入標註主畫布並載入圖片與 AI Bbox
        this.openAnnotationEditor(masterIndex);

        // 顯示與更新 Review UI
        this.enableReviewEditorUi();
        this.updateReviewProgressText();

        showToast(`已進入候選審核模式：1 / ${this.reviewQueue.length}`, "success");
    },

    enableReviewEditorUi() {
        const bar = document.getElementById("review-toolbar");
        if (bar) {
            bar.style.display = this.reviewMode ? "flex" : "none";
        }
    },

    updateReviewProgressText() {
        const progressEl = document.getElementById("review-progress-text");
        const fileEl = document.getElementById("review-current-file");
        if (this.reviewMode && this.reviewQueue.length > 0) {
            const currentItem = this.reviewQueue[this.currentReviewIndex];
            const filename = currentItem.path.split('/').pop().split('\\').pop();
            
            if (progressEl) progressEl.textContent = `${this.currentReviewIndex + 1} / ${this.reviewQueue.length}`;
            if (fileEl) fileEl.textContent = filename;
        }
    },

    async acceptCurrentReviewLabel() {
        if (this.currentImgIndex < 0) return;
        const img = this.images[this.currentImgIndex];

        // 抓取當前 ImageLabeler 中的框
        let labelStr = "";
        if (typeof ImageLabeler !== "undefined" && ImageLabeler.getLabelString) {
            labelStr = ImageLabeler.getLabelString();
        }

        if (!labelStr || labelStr === "[]") {
            showToast("目前沒有標註框，無法接受。", "warn");
            return;
        }

        const original = this.labelDataCache[img.path]?.label || img.label || "";
        const edited = labelStr !== original;
        this.labelDataCache[img.path] = this.makeLabelCacheEntry(img, {
            label: labelStr,
            status: "done",
            source: edited ? "auto_edited" : "auto_accepted",
            review_state: edited ? "edited" : "accepted"
        });
        Object.assign(img, this.labelDataCache[img.path]);

        try {
            await API.saveLabels(this.labelDataCache);
            showToast("已接受此候選標註", "success");
            this.gotoNextReviewCandidate();
        } catch (err) {
            showToast(`接受標註失敗: ${err.message}`, "error");
        }
    },

    async saveReviewAndNext() {
        if (this.currentImgIndex < 0) return;
        const img = this.images[this.currentImgIndex];

        let labelStr = "";
        if (typeof ImageLabeler !== "undefined" && ImageLabeler.getLabelString) {
            labelStr = ImageLabeler.getLabelString();
        }

        if (!labelStr || labelStr === "[]") {
            const confirmEmpty = confirm("目前沒有任何標註框，是否將此圖片保持 pending 並跳到下一張？");
            if (!confirmEmpty) return;
        } else {
            this.labelDataCache[img.path] = this.makeLabelCacheEntry(img, {
                label: labelStr,
                status: "done",
                source: "auto_edited",
                review_state: "edited"
            });
            Object.assign(img, this.labelDataCache[img.path]);

            try {
                await API.saveLabels(this.labelDataCache);
            } catch (err) {
                showToast(`儲存失敗: ${err.message}`, "error");
                return;
            }
        }

        this.gotoNextReviewCandidate();
    },

    async ignoreCurrentReviewImage() {
        if (this.currentImgIndex < 0) return;
        const img = this.images[this.currentImgIndex];

        this.labelDataCache[img.path] = this.makeLabelCacheEntry(img, {
            label: "",
            status: "ignore",
            source: "auto_rejected",
            review_state: "rejected"
        });
        Object.assign(img, this.labelDataCache[img.path]);

        try {
            await API.saveLabels(this.labelDataCache);
            showToast("已忽略此圖片", "info");
            this.gotoNextReviewCandidate();
        } catch (err) {
            showToast(`忽略失敗: ${err.message}`, "error");
        }
    },

    navigateReviewCandidate(direction) {
        if (!this.reviewMode || this.reviewQueue.length === 0) return;
        this.currentReviewIndex += direction;
        if (this.currentReviewIndex < 0) this.currentReviewIndex = this.reviewQueue.length - 1;
        if (this.currentReviewIndex >= this.reviewQueue.length) this.currentReviewIndex = 0;

        const target = this.reviewQueue[this.currentReviewIndex];
        const masterIndex = this.masterImageIndexLookup(target.path);
        if (masterIndex === -1) {
            showToast("找不到候選圖片索引，請重新掃描資料庫。", "error");
            return;
        }

        this.openAnnotationEditor(masterIndex);
        this.updateReviewProgressText();
    },

    gotoNextReviewCandidate() {
        this.reviewQueue = this.getPendingReviewItems();

        if (this.reviewQueue.length === 0) {
            showToast("候選審核完成，所有候選標註皆已處理。", "success");
            this.exitReviewMode();
            return;
        }

        this.currentReviewIndex = Math.min(this.currentReviewIndex, this.reviewQueue.length - 1);
        if (this.currentReviewIndex < 0) {
            this.currentReviewIndex = 0;
        }

        const next = this.reviewQueue[this.currentReviewIndex];
        const masterIndex = this.masterImageIndexLookup(next.path);

        if (masterIndex !== -1) {
            this.currentImgIndex = masterIndex;
            this.loadImgToLabelView(masterIndex);
            this.updateReviewProgressText();
        } else {
            showToast("無法定位下一張候選圖片", "error");
            this.exitReviewMode();
        }
    },

    exitReviewMode() {
        this.reviewMode = false;
        this.reviewQueue = [];
        this.currentReviewIndex = -1;
        this.enableReviewEditorUi();
        this.scanDataset();
        this.switchWorkspaceTab("annotation-view", "ann-manual");
        showToast("已離開候選審核模式", "info");
    },

    // ==========================================================================
    // Session 儲存/載入與開新檔
    // ==========================================================================
    setupSessionEvents() {
        this.bindClick("btn-studio-new-session", () => this.newSession());
        this.bindClick("btn-studio-open-session", () => this.openSession());
        this.bindClick("btn-studio-save-session", () => this.saveSession());
    },

    async newSession() {
        if (this.projectLoaded) {
            if (!confirm("確定要建立新檔嗎？未儲存的變更將會遺失。")) {
                return;
            }
        }
        try {
            await API.closeProject();
            this.projectLoaded = false;
            this.projectName = "";
            this.inputPath = "";
            this.classes = [];
            this.images = [];
            this.currentImgIndex = -1;
            this.labelDataCache = {};
            this.reviewMode = false;
            this.reviewQueue = [];
            this.currentReviewIndex = -1;
            
            // 隱藏 review-toolbar
            this.enableReviewEditorUi();
            
            this.resetUiToEmptyState();
            showToast("已重置 Vision Training Studio 狀態 (開啟新檔)", "success");
            this.switchView("database-view");
        } catch (err) {
            showToast(`重置專案失敗: ${err.message}`, "error");
        }
    },

    buildStudioSessionPayload() {
        // 抓取劃分比例
        const trainRatio = parseFloat(document.getElementById("slider-train")?.value || 70) / 100;
        const valRatio = parseFloat(document.getElementById("slider-val")?.value || 20) / 100;
        const testRatio = parseFloat(document.getElementById("slider-test")?.value || 10) / 100;

        // 抓取當前分頁與標籤頁
        let activeView = "database-view";
        let activeTab = "db-manage";
        document.querySelectorAll(".app-view").forEach(v => {
            if (v.classList.contains("active")) {
                activeView = v.id;
                const activeLi = v.querySelector(".sidebar-menu li.active");
                if (activeLi) {
                    activeTab = activeLi.getAttribute("data-tab");
                }
            }
        });

        const autoLabelModelSource = document.getElementById("auto-label-model-source")?.value || "custom_path";
        const autoLabelModelPath = document.getElementById("auto-label-model-path")?.value || "";
        const autoLabelConf = parseFloat(document.getElementById("auto-label-confidence")?.value || 0.75);
        const autoLabelIou = parseFloat(document.getElementById("auto-label-iou")?.value || 0.5);

        const trainModel = document.getElementById("train-model")?.value || "yolo11n";
        const trainEpochs = parseInt(document.getElementById("train-epochs")?.value || 50, 10);
        const trainBatch = parseInt(document.getElementById("train-batch")?.value || 16, 10);

        return {
            schema_version: "1.0",
            project_name: this.projectName,
            task_type: this.taskType || "Detection",
            annotation_type: (this.taskType === "Segmentation" || this.taskType === "segmentation") ? "polygon" : "bbox",
            annotation_mode: this.annotationMode || "manual",
            review_mode: this.reviewMode,
            current_review_index: this.currentReviewIndex,
            input_path: this.inputPath,
            output_path: document.getElementById("output-path-display")?.value || (this.inputPath ? `${this.inputPath}/runs` : ""),
            classes: this.classes,
            current_view: activeView,
            current_tab: activeTab,
            current_image_index: this.currentImgIndex,
            autolabel: {
                model_source: autoLabelModelSource,
                model_path: autoLabelModelPath,
                confidence: autoLabelConf,
                iou: autoLabelIou
            },
            training: {
                model_id: trainModel,
                epochs: trainEpochs,
                batch: trainBatch
            },
            dataset_split: {
                train: trainRatio,
                val: valRatio,
                test: testRatio
            }
        };
    },

    async saveSession() {
        if (!this.projectLoaded) {
            showToast("目前未載入專案，請先載入或建立專案再儲存。", "warn");
            return;
        }

        // 儲存當前影像標註
        if (this.currentImgIndex >= 0 && typeof ImageLabeler !== "undefined" && ImageLabeler.getLabelString) {
            const labelStr = ImageLabeler.getLabelString();
            const img = this.images[this.currentImgIndex];
            if (img) {
                this.labelDataCache[img.path] = this.makeLabelCacheEntry(img, {
                    label: labelStr,
                    status: img.status || "done"
                });
            }
        }
        
        // 寫入 labelDataCache 至 labels.csv
        try {
            await API.saveLabels(this.labelDataCache);
        } catch (err) {
            console.warn("自動儲存當前標籤至 labels.csv 失敗:", err);
        }

        const sessionPayload = this.buildStudioSessionPayload();

        // 決定是否彈出另存 dialog
        let chooseFileRes = null;
        if (confirm("是否要另存新檔？(按取消將直接存至專案目錄的 studio_session.vtsproj.json)")) {
            chooseFileRes = await API.chooseSaveSessionFile();
            if (chooseFileRes.status === "cancelled" || !chooseFileRes.path) {
                showToast("已取消另存紀錄檔。", "info");
                return;
            }
        }

        const filepath = chooseFileRes ? chooseFileRes.path : null;

        try {
            const res = await API.saveStudioSession(sessionPayload, filepath);
            if (res.status === "success") {
                showToast(res.message || "Session 儲存成功！", "success");
            }
        } catch (err) {
            showToast(`儲存 Session 失敗: ${err.message}`, "error");
        }
    },

    async openSession() {
        if (this.projectLoaded) {
            if (!confirm("確定要載入其他紀錄檔嗎？當前未儲存的工作狀態將會遺失。")) {
                return;
            }
        }

        try {
            const chooseRes = await API.chooseOpenSessionFile();
            if (chooseRes.status === "cancelled" || !chooseRes.path) {
                return;
            }

            const res = await API.openStudioSession(chooseRes.path);
            if (res.status === "success") {
                const session = res.session_data;
                const project = res.active_project;
                
                // 還原專案狀態
                this.projectLoaded = true;
                this.projectName = project.project_name;
                this.inputPath = project.input_path;
                this.classes = project.classes;
                this.taskType = project.task_type || "Detection";
                this.annotationMode = session.annotation_mode || this.annotationMode || "manual";

                // 更新頂部專案 Badge
                this.html("active-project-badge", `
                    <span class="dot active"></span> Project: ${this.projectName}
                `);
                this.value("input-path-display", this.inputPath);
                this.value("output-path-display", project.output_path || `${this.inputPath}/runs`);
                this.value("label-input-path-display", this.inputPath);
                this.value("auto-label-path-display", this.inputPath);

                const canvas = this.el("label-canvas");
                const canvasContainer = this.el("canvas-container-div");

                if (canvas && canvasContainer && window.ImageLabeler) {
                    ImageLabeler.init("label-canvas", "canvas-container-div");
                    ImageLabeler.setClassColors(this.classes);
                }

                this.enableTabs();

                // 恢復其他參數
                if (session.autolabel) {
                    this.value("auto-label-model-source", session.autolabel.model_source || "custom_path");
                    this.value("auto-label-model-path", session.autolabel.model_path || "");
                    this.value("auto-label-confidence", session.autolabel.confidence || 0.75);
                    const confValEl = document.getElementById("auto-label-confidence-val");
                    if (confValEl) confValEl.textContent = (session.autolabel.confidence || 0.75).toFixed(2);
                    
                    this.value("auto-label-iou", session.autolabel.iou || 0.5);
                    const iouValEl = document.getElementById("auto-label-iou-val");
                    if (iouValEl) iouValEl.textContent = (session.autolabel.iou || 0.5).toFixed(2);

                    const customGroup = document.getElementById("auto-label-custom-model-group");
                    if (customGroup) {
                        customGroup.style.display = session.autolabel.model_source === "custom_path" ? "block" : "none";
                    }
                }

                if (session.training) {
                    this.value("train-model", session.training.model_id || "yolo11n");
                    this.value("train-epochs", session.training.epochs || 50);
                    this.value("train-batch", session.training.batch || 16);
                }

                if (session.dataset_split) {
                    const t = Math.round((session.dataset_split.train || 0.7) * 100);
                    const v = Math.round((session.dataset_split.val || 0.2) * 100);
                    const ts = Math.round((session.dataset_split.test || 0.1) * 100);

                    this.value("slider-train", t);
                    this.value("slider-val", v);
                    this.value("slider-test", ts);

                    const lblTrain = document.getElementById("lbl-train");
                    if (lblTrain) lblTrain.textContent = `${t}%`;
                    const lblVal = document.getElementById("lbl-val");
                    if (lblVal) lblVal.textContent = `${v}%`;
                    const lblTest = document.getElementById("lbl-test");
                    if (lblTest) lblTest.textContent = `${ts}%`;
                }

                // 掃描資料
                await this.scanDataset();

                // 恢復當前圖片索引
                if (session.current_image_index >= 0 && this.images && this.images.length > session.current_image_index) {
                    this.currentImgIndex = session.current_image_index;
                }

                if (session.review_mode) {
                    this.reviewMode = true;
                    this.reviewQueue = this.getPendingReviewItems();
                    this.currentReviewIndex = Math.min(
                        Math.max(session.current_review_index || 0, 0),
                        Math.max(this.reviewQueue.length - 1, 0)
                    );
                    this.enableReviewEditorUi();
                } else {
                    this.reviewMode = false;
                    this.reviewQueue = [];
                    this.currentReviewIndex = -1;
                    this.enableReviewEditorUi();
                }

                // 切換回儲存時的分頁與 Tab
                if (session.current_view) {
                    this.switchView(session.current_view, session.current_tab);
                } else {
                    this.switchView("database-view", "db-manage");
                }

                // 載入當前影像
                if (this.currentImgIndex >= 0) {
                    this.loadImgToLabelView(this.currentImgIndex);
                }

                showToast("已成功載入 Session 狀態檔", "success");
            }
        } catch (err) {
            showToast(`載入 Session 失敗: ${err.message}`, "error");
        }
    }
};

// 網頁加載後啟動
window.addEventListener("DOMContentLoaded", () => {
    App.init();
});
