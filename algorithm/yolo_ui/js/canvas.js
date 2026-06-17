// 安全 Toast 輔助
const safeShowToast = (msg, type = "info", duration = 3000) => {
    if (typeof showToast === "function") {
        showToast(msg, type, duration);
    } else {
        console.log(`[TOAST-FALLBACK] [${type}] ${msg}`);
        const alertEl = document.createElement("div");
        alertEl.style.cssText = "position: fixed; top: 10px; right: 10px; background: rgba(239, 68, 68, 0.9); color: white; padding: 12px 24px; border-radius: 6px; z-index: 10000; font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); font-weight: bold;";
        alertEl.textContent = msg;
        document.body.appendChild(alertEl);
        setTimeout(() => alertEl.remove(), duration);
    }
};

// Canvas 影像標記引擎
const ImageLabeler = {
    canvas: null,
    ctx: null,
    img: new Image(),
    
    // 圖片載入狀態
    imgLoaded: false,
    currentImagePath: "",
    
    // 平移與縮放狀態
    scale: 1.0,
    panX: 0,
    panY: 0,
    
    // 滑鼠與操作模式狀態
    mode: "select", // select, draw
    isDrawing: false,
    isPanning: false,
    isDraggingBox: false,
    dragOffsetX: 0,
    dragOffsetY: 0,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    lastMouseX: 0,
    lastMouseY: 0,
    
    // 標註框資料庫
    // 結構: { x: float, y: float, w: float, h: float, label: string }
    // 坐標以 0~1 的相對值儲存，以確保縮放與解析度無關
    bboxes: [],
    activePolygonPoints: [],
    selectedBoxIndex: -1,
    activeClass: "cat",
    classColors: {}, // label -> rgb color

    init(canvasId, containerId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext("2d");
        this.container = document.getElementById(containerId);
        
        // 綁定事件監聽
        this.canvas.addEventListener("mousedown", this.onMouseDown.bind(this));
        this.canvas.addEventListener("mousemove", this.onMouseMove.bind(this));
        this.canvas.addEventListener("mouseup", this.onMouseUp.bind(this));
        this.canvas.addEventListener("wheel", this.onWheel.bind(this));
        
        window.addEventListener("resize", this.fitToWindow.bind(this));
        
        this.img.onload = () => {
            try {
                this.imgLoaded = true;
                this.fitToWindow();
                const overlay = document.getElementById("canvas-empty-overlay");
                if (overlay) overlay.style.display = "none";
                
                // 填寫圖片屬性
                const infoSize = document.getElementById("info-size");
                if (infoSize) infoSize.textContent = `${this.img.naturalWidth} x ${this.img.naturalHeight}`;
                const infoFormat = document.getElementById("info-format");
                if (infoFormat) infoFormat.textContent = this.currentImagePath.split('.').pop().toUpperCase();
            } catch (err) {
                console.error("[CANVAS-ONLOAD-ERROR] Exception in onload:", err);
            }
        };
        
        this.img.onerror = () => {
            try {
                this.imgLoaded = false;
                const overlay = document.getElementById("canvas-empty-overlay");
                if (overlay) overlay.style.display = "flex";
                
                const filename = this.currentImagePath ? this.currentImagePath.split('/').pop().split('\\').pop() : "未知影像";
                const errorMsg = `影像 [${filename}] 載入失敗！網址: ${this.img.src}。請打開 F12 開發者工具檢查該請求或檔案是否損毀。`;
                console.error(`[IMAGE-LOAD-ERROR] Failed to load image: ${this.currentImagePath}, URL: ${this.img.src}`);
                safeShowToast(errorMsg, "error", 8000);
            } catch (err) {
                console.error("[CANVAS-ONERROR-ERROR] Exception in onerror:", err);
            }
        };
    },

    setClassColors(classes) {
        // 為每個類別隨機分配一個顏色 (色相環)
        this.classColors = {};
        classes.forEach((cls, idx) => {
            const hue = (idx * 137.5) % 360; // 黃金角分配，讓顏色最大化分散
            this.classColors[cls] = `hsl(${hue}, 85%, 60%)`;
        });
    },

    loadImage(url, path, labelStr) {
        this.imgLoaded = false;
        this.currentImagePath = path;
        this.bboxes = [];
        this.selectedBoxIndex = -1;
        
        // 解析 labels
        if (labelStr) {
            try {
                // 如果是 JSON 字串 (多個標記框)，解析它
                if (labelStr.trim().startsWith("[")) {
                    this.bboxes = JSON.parse(labelStr);
                } else if (labelStr.trim()) {
                    // 如果只是單一類別 (影像分類任務)，建立一個覆蓋整張圖 80% 的模擬標記框
                    this.bboxes = [{
                        x: 0.1, y: 0.1, w: 0.8, h: 0.8,
                        label: labelStr.trim()
                    }];
                }
            } catch (e) {
                console.error("解析標籤字串出錯:", e);
            }
        }
        
        this.img.src = `${API_BASE}${url}`;
        this.updateBBoxList();
    },

    fitToWindow() {
        if (!this.imgLoaded || !this.canvas) return;
        
        // 設 Canvas 為 container 大小
        const rect = this.container.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        
        // 計算縮放比例使其適應視窗
        const scaleX = rect.width / this.img.naturalWidth;
        const scaleY = rect.height / this.img.naturalHeight;
        this.scale = Math.min(scaleX, scaleY) * 0.95; // 縮小 5% 作為邊距
        
        // 置中圖片
        this.panX = (rect.width - this.img.naturalWidth * this.scale) / 2;
        this.panY = (rect.height - this.img.naturalHeight * this.scale) / 2;
        
        this.draw();
    },

    resetZoom() {
        this.scale = 1.0;
        const rect = this.container.getBoundingClientRect();
        this.panX = (rect.width - this.img.naturalWidth) / 2;
        this.panY = (rect.height - this.img.naturalHeight) / 2;
        this.draw();
    },

    // 將 Canvas 滑鼠坐標轉換為影像像素空間相對坐標 (0~1)
    getRelativeCoordinates(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const canvasX = clientX - rect.left;
        const canvasY = clientY - rect.top;
        
        const imgX = (canvasX - this.panX) / this.scale;
        const imgY = (canvasY - this.panY) / this.scale;
        
        return {
            x: imgX / this.img.naturalWidth,
            y: imgY / this.img.naturalHeight
        };
    },

    // 將影像相對坐標轉換為 Canvas 繪製坐標
    getCanvasCoordinates(relX, relY) {
        const imgX = relX * this.img.naturalWidth * this.scale + this.panX;
        const imgY = relY * this.img.naturalHeight * this.scale + this.panY;
        return { x: imgX, y: imgY };
    },

    onMouseDown(e) {
        if (!this.imgLoaded) return;
        
        // 滑鼠中鍵或空白鍵 + 左鍵 = 平移模式
        if (e.button === 1 || e.button === 2 || (e.button === 0 && this.mode === "select" && e.spaceKey)) {
            this.isPanning = true;
            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;
            e.preventDefault();
            return;
        }
        
        if (e.button === 0) { // 左鍵
            const mouseRel = this.getRelativeCoordinates(e.clientX, e.clientY);
            
            if (this.mode === "polygon") {
                // 如果點擊接近起點，或是雙擊，就封閉多邊形
                const distToStart = this.activePolygonPoints.length > 0
                    ? Math.hypot(mouseRel.x - this.activePolygonPoints[0][0], mouseRel.y - this.activePolygonPoints[0][1])
                    : Infinity;

                if (e.detail === 2 || (this.activePolygonPoints.length >= 3 && distToStart < 0.025)) {
                    if (this.activePolygonPoints.length >= 3) {
                        const newPoly = {
                            type: "polygon",
                            points: JSON.parse(JSON.stringify(this.activePolygonPoints)),
                            label: this.activeClass
                        };
                        this.bboxes.push(newPoly);
                        this.selectedBoxIndex = this.bboxes.length - 1;
                        this.activePolygonPoints = [];
                        this.updateBBoxList();
                        safeShowToast(`已完成多邊形標記: ${this.activeClass}`, "success");
                        if (typeof App !== "undefined" && App.saveCurrentImgLabelToCache) {
                            App.saveCurrentImgLabelToCache();
                        }
                    } else {
                        this.activePolygonPoints = [];
                    }
                } else {
                    this.activePolygonPoints.push([mouseRel.x, mouseRel.y]);
                }
                this.draw();
                return;
            }
            
            if (this.mode === "draw") {
                this.isDrawing = true;
                this.startX = mouseRel.x;
                this.startY = mouseRel.y;
                this.currentX = mouseRel.x;
                this.currentY = mouseRel.y;
            } else { // 選擇模式
                // 檢查是否點擊在現有的 Box / Polygon 內部，由小到大排序 (優先選取小物件)
                let clickedIdx = -1;
                let minArea = Infinity;
                
                this.bboxes.forEach((box, idx) => {
                    const isPolygon = box.type === "polygon" || !!box.points;
                    if (isPolygon) {
                        if (!box.points || box.points.length === 0) return;
                        const xs = box.points.map(pt => pt[0]);
                        const ys = box.points.map(pt => pt[1]);
                        const minX = Math.min(...xs);
                        const maxX = Math.max(...xs);
                        const minY = Math.min(...ys);
                        const maxY = Math.max(...ys);
                        if (mouseRel.x >= minX && mouseRel.x <= maxX &&
                            mouseRel.y >= minY && mouseRel.y <= maxY) {
                            const area = (maxX - minX) * (maxY - minY);
                            if (area < minArea) {
                                minArea = area;
                                clickedIdx = idx;
                            }
                        }
                    } else {
                        if (mouseRel.x >= box.x && mouseRel.x <= box.x + box.w &&
                            mouseRel.y >= box.y && mouseRel.y <= box.y + box.h) {
                            const area = box.w * box.h;
                            if (area < minArea) {
                                minArea = area;
                                clickedIdx = idx;
                            }
                        }
                    }
                });
                
                this.selectedBoxIndex = clickedIdx;
                if (clickedIdx !== -1) {
                    this.isDraggingBox = true;
                    const box = this.bboxes[clickedIdx];
                    const isPolygon = box.type === "polygon" || !!box.points;
                    if (isPolygon) {
                        this.dragStartPoints = JSON.parse(JSON.stringify(box.points));
                        this.dragStartMouseX = mouseRel.x;
                        this.dragStartMouseY = mouseRel.y;
                    } else {
                        this.dragOffsetX = mouseRel.x - box.x;
                        this.dragOffsetY = mouseRel.y - box.y;
                    }
                }
                this.updateBBoxList();
                this.draw();
            }
        }
    },

    onMouseMove(e) {
        if (!this.imgLoaded) return;
        
        if (this.isPanning) {
            const dx = e.clientX - this.lastMouseX;
            const dy = e.clientY - this.lastMouseY;
            this.panX += dx;
            this.panY += dy;
            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;
            this.draw();
            return;
        }

        if (this.mode === "polygon" && this.activePolygonPoints && this.activePolygonPoints.length > 0) {
            const mouseRel = this.getRelativeCoordinates(e.clientX, e.clientY);
            this.currentX = mouseRel.x;
            this.currentY = mouseRel.y;
            this.draw();
            return;
        }

        if (this.isDraggingBox && this.selectedBoxIndex !== -1) {
            const mouseRel = this.getRelativeCoordinates(e.clientX, e.clientY);
            const box = this.bboxes[this.selectedBoxIndex];
            const isPolygon = box.type === "polygon" || !!box.points;

            if (isPolygon) {
                const dx = mouseRel.x - this.dragStartMouseX;
                const dy = mouseRel.y - this.dragStartMouseY;
                box.points = this.dragStartPoints.map(pt => [pt[0] + dx, pt[1] + dy]);
            } else {
                let newX = mouseRel.x - this.dragOffsetX;
                let newY = mouseRel.y - this.dragOffsetY;
                
                // 邊界限制
                if (newX < 0) newX = 0;
                if (newY < 0) newY = 0;
                if (newX + box.w > 1.0) newX = 1.0 - box.w;
                if (newY + box.h > 1.0) newY = 1.0 - box.h;
                
                box.x = newX;
                box.y = newY;
            }
            
            this.draw();
            return;
        }
        
        if (this.isDrawing) {
            const mouseRel = this.getRelativeCoordinates(e.clientX, e.clientY);
            this.currentX = Math.min(Math.max(mouseRel.x, 0), 1.0);
            this.currentY = Math.min(Math.max(mouseRel.y, 0), 1.0);
            this.draw();
        }

        // 游標樣式更新
        if (this.isPanning) {
            this.canvas.style.cursor = "grabbing";
        } else if (e.spaceKey || e.button === 1 || e.button === 2) {
            this.canvas.style.cursor = "grab";
        } else if (this.isDraggingBox) {
            this.canvas.style.cursor = "move";
        } else if (this.mode === "draw" || this.mode === "polygon") {
            this.canvas.style.cursor = "crosshair";
        } else if (this.mode === "select") {
            const mouseRel = this.getRelativeCoordinates(e.clientX, e.clientY);
            let hovering = false;
            for (let i = 0; i < this.bboxes.length; i++) {
                const box = this.bboxes[i];
                const isPolygon = box.type === "polygon" || !!box.points;
                if (isPolygon) {
                    if (!box.points || box.points.length === 0) continue;
                    const xs = box.points.map(pt => pt[0]);
                    const ys = box.points.map(pt => pt[1]);
                    const minX = Math.min(...xs);
                    const maxX = Math.max(...xs);
                    const minY = Math.min(...ys);
                    const maxY = Math.max(...ys);
                    if (mouseRel.x >= minX && mouseRel.x <= maxX &&
                        mouseRel.y >= minY && mouseRel.y <= maxY) {
                        hovering = true;
                        break;
                    }
                } else {
                    if (mouseRel.x >= box.x && mouseRel.x <= box.x + box.w &&
                        mouseRel.y >= box.y && mouseRel.y <= box.y + box.h) {
                        hovering = true;
                        break;
                    }
                }
            }
            this.canvas.style.cursor = hovering ? "move" : "default";
        } else {
            this.canvas.style.cursor = "default";
        }
    },

    onMouseUp(e) {
        if (this.isPanning) {
            this.isPanning = false;
            return;
        }

        if (this.isDraggingBox) {
            this.isDraggingBox = false;
            this.updateBBoxList();
            this.draw();
            if (typeof App !== "undefined" && App.saveCurrentImgLabelToCache) {
                App.saveCurrentImgLabelToCache();
            }
            return;
        }
        
        if (this.isDrawing) {
            this.isDrawing = false;
            
            // 計算寬高與正坐標
            const x = Math.min(this.startX, this.currentX);
            const y = Math.min(this.startY, this.currentY);
            const w = Math.abs(this.startX - this.currentX);
            const h = Math.abs(this.startY - this.currentY);
            
            // 避免點擊建立超小框 (小於圖片的 1%)
            if (w > 0.01 && h > 0.01) {
                const newBox = {
                    x: x,
                    y: y,
                    w: w,
                    h: h,
                    label: this.activeClass
                };
                this.bboxes.push(newBox);
                this.selectedBoxIndex = this.bboxes.length - 1;
                this.updateBBoxList();
                safeShowToast(`已新增標記框: ${this.activeClass}`, "success");
            }
            this.draw();
        }
    },

    onWheel(e) {
        if (!this.imgLoaded) return;
        e.preventDefault();
        
        // 取得滾輪事件時滑鼠相對於 Canvas 的坐標
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        // 縮放因子
        const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
        const newScale = Math.min(Math.max(this.scale * zoomFactor, 0.05), 20); // 限制縮放 5% 到 2000%
        
        // 修正平移以維持滑鼠所指位置不變
        this.panX = mouseX - (mouseX - this.panX) * (newScale / this.scale);
        this.panY = mouseY - (mouseY - this.panY) * (newScale / this.scale);
        this.scale = newScale;
        
        this.draw();
    },

    deleteSelectedBox() {
        if (this.selectedBoxIndex >= 0 && this.selectedBoxIndex < this.bboxes.length) {
            const deleted = this.bboxes.splice(this.selectedBoxIndex, 1)[0];
            this.selectedBoxIndex = -1;
            this.updateBBoxList();
            this.draw();
            safeShowToast(`已刪除標記框: ${deleted.label}`, "info");
        }
    },

    clearAllBoxes() {
        if (this.bboxes.length > 0) {
            this.bboxes = [];
            this.selectedBoxIndex = -1;
            this.updateBBoxList();
            this.draw();
            safeShowToast("已清除此圖片的所有標記", "info");
        }
    },

    draw() {
        if (!this.canvas || !this.ctx) return;
        
        // 清除畫布
        this.ctx.fillStyle = document.body.classList.contains("light-mode") ? "#eef0f6" : "#050508";
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        if (!this.imgLoaded) return;
        
        // 1. 繪製圖片
        const drawW = this.img.naturalWidth * this.scale;
        const drawH = this.img.naturalHeight * this.scale;
        this.ctx.drawImage(this.img, this.panX, this.panY, drawW, drawH);
        
        // 2. 繪製已存在的 Bounding Box 或 Polygon
        this.bboxes.forEach((box, idx) => {
            const isSelected = idx === this.selectedBoxIndex;
            const color = this.classColors[box.label] || "var(--neon-blue)";
            const isPolygon = box.type === "polygon" || !!box.points;

            if (isPolygon) {
                if (!box.points || box.points.length === 0) return;
                
                this.ctx.beginPath();
                box.points.forEach((pt, pIdx) => {
                    const canvasPt = this.getCanvasCoordinates(pt[0], pt[1]);
                    if (pIdx === 0) {
                        this.ctx.moveTo(canvasPt.x, canvasPt.y);
                    } else {
                        this.ctx.lineTo(canvasPt.x, canvasPt.y);
                    }
                });
                this.ctx.closePath();

                // 填滿 HSL 透明顏色
                if (color.startsWith("hsl")) {
                    this.ctx.fillStyle = isSelected 
                        ? color.replace(")", ", 0.35)").replace("hsl", "hsla")
                        : color.replace(")", ", 0.18)").replace("hsl", "hsla");
                } else {
                    this.ctx.fillStyle = isSelected ? "rgba(0, 229, 255, 0.2)" : "rgba(0, 229, 255, 0.08)";
                }
                this.ctx.fill();

                // 繪製發光效果
                if (isSelected) {
                    this.ctx.shadowBlur = 6;
                    this.ctx.shadowColor = color;
                } else {
                    this.ctx.shadowBlur = 0;
                }

                this.ctx.strokeStyle = color;
                this.ctx.lineWidth = isSelected ? 2.5 : 1.5;
                this.ctx.setLineDash([]);
                this.ctx.stroke();

                // 重置發光
                this.ctx.shadowBlur = 0;

                // 繪製標籤名稱
                const firstPt = this.getCanvasCoordinates(box.points[0][0], box.points[0][1]);
                this.ctx.fillStyle = color;
                this.ctx.font = "bold 12px Outfit, sans-serif";
                const textWidth = this.ctx.measureText(box.label).width;
                this.ctx.fillRect(firstPt.x - 1, firstPt.y - 18, textWidth + 12, 18);
                this.ctx.fillStyle = "#000";
                this.ctx.fillText(box.label, firstPt.x + 6, firstPt.y - 5);
            } else {
                const p1 = this.getCanvasCoordinates(box.x, box.y);
                const p2 = this.getCanvasCoordinates(box.x + box.w, box.y + box.h);
                const w = p2.x - p1.x;
                const h = p2.y - p1.y;

                // 繪製半透明填充
                this.ctx.fillStyle = isSelected ? "rgba(0, 229, 255, 0.12)" : "rgba(255, 255, 255, 0.03)";
                this.ctx.fillRect(p1.x, p1.y, w, h);
                
                // 繪製邊框與發光特效
                if (isSelected) {
                    this.ctx.shadowBlur = 6;
                    this.ctx.shadowColor = color;
                } else {
                    this.ctx.shadowBlur = 0;
                }

                this.ctx.strokeStyle = color;
                this.ctx.lineWidth = isSelected ? 2 : 1.2;
                this.ctx.setLineDash([]); // 全改為實線
                this.ctx.strokeRect(p1.x, p1.y, w, h);
                
                // 重設發光屬性
                this.ctx.shadowBlur = 0;
                
                // 繪製標籤名稱底色與文字
                this.ctx.fillStyle = color;
                this.ctx.font = "bold 12px Outfit, sans-serif";
                const textWidth = this.ctx.measureText(box.label).width;
                
                // 標籤放置在左上角頂部
                this.ctx.fillRect(p1.x - 1, p1.y - 18, textWidth + 12, 18);
                this.ctx.fillStyle = "#000";
                this.ctx.fillText(box.label, p1.x + 6, p1.y - 5);
            }
        });
        
        // 3. 繪製正在拖曳中的矩形
        if (this.isDrawing) {
            const p1 = this.getCanvasCoordinates(this.startX, this.startY);
            const p2 = this.getCanvasCoordinates(this.currentX, this.currentY);
            const w = p2.x - p1.x;
            const h = p2.y - p1.y;
            
            this.ctx.strokeStyle = "var(--neon-blue)";
            this.ctx.lineWidth = 1;
            this.ctx.setLineDash([4, 4]);
            this.ctx.strokeRect(p1.x, p1.y, w, h);
            
            this.ctx.fillStyle = "rgba(0, 229, 255, 0.08)";
            this.ctx.fillRect(p1.x, p1.y, w, h);
            this.ctx.setLineDash([]);
        }

        // 4. 繪製正在繪製中的多邊形頂點與引導線
        if (this.mode === "polygon" && this.activePolygonPoints && this.activePolygonPoints.length > 0) {
            this.ctx.beginPath();
            this.activePolygonPoints.forEach((pt, pIdx) => {
                const canvasPt = this.getCanvasCoordinates(pt[0], pt[1]);
                if (pIdx === 0) {
                    this.ctx.moveTo(canvasPt.x, canvasPt.y);
                } else {
                    this.ctx.lineTo(canvasPt.x, canvasPt.y);
                }
            });
            const currentMouseCanvas = this.getCanvasCoordinates(this.currentX, this.currentY);
            this.ctx.lineTo(currentMouseCanvas.x, currentMouseCanvas.y);
            
            this.ctx.strokeStyle = "#a855f7";
            this.ctx.lineWidth = 1.5;
            this.ctx.setLineDash([3, 3]);
            this.ctx.stroke();
            this.ctx.setLineDash([]);

            // 繪製頂點圓點
            this.activePolygonPoints.forEach((pt) => {
                const canvasPt = this.getCanvasCoordinates(pt[0], pt[1]);
                this.ctx.beginPath();
                this.ctx.arc(canvasPt.x, canvasPt.y, 4, 0, Math.PI * 2);
                this.ctx.fillStyle = "#00e5ff";
                this.ctx.fill();
                this.ctx.lineWidth = 1;
                this.ctx.strokeStyle = "#fff";
                this.ctx.stroke();
            });
        }
    },

    updateBBoxList() {
        const container = document.getElementById("bbox-list-container");
        if (!container) return;
        
        container.innerHTML = "";
        
        if (this.bboxes.length === 0) {
            container.innerHTML = `<div class="empty-hint">無標記框</div>`;
            return;
        }
        
        this.bboxes.forEach((box, idx) => {
            const item = document.createElement("div");
            const isSelected = idx === this.selectedBoxIndex;
            item.className = `bbox-item ${isSelected ? "selected" : ""}`;
            
            const color = this.classColors[box.label] || "var(--neon-blue)";
            
            const isPolygon = box.type === "polygon" || !!box.points;
            const coordStr = isPolygon 
                ? `[polygon, pts:${box.points.length}]`
                : `[x:${box.x.toFixed(2)}, y:${box.y.toFixed(2)}]`;

            item.innerHTML = `
                <div class="bbox-info">
                    <span class="class-tag-color" style="background: ${color};"></span>
                    <strong>${box.label}</strong>
                    <span style="color: var(--text-muted); font-size: 0.65rem;">${coordStr}</span>
                </div>
                <button class="btn-delete-box" data-idx="${idx}" title="刪除"><i class="fa-solid fa-trash-can"></i></button>
            `;
            
            // 點擊項目選取
            item.addEventListener("click", (e) => {
                if (e.target.closest(".btn-delete-box")) return; // 如果點了刪除按鈕
                this.selectedBoxIndex = idx;
                this.draw();
                this.updateBBoxList();
            });
            
            // 刪除按鈕點擊
            item.querySelector(".btn-delete-box").addEventListener("click", (e) => {
                e.stopPropagation();
                this.selectedBoxIndex = idx;
                this.deleteSelectedBox();
            });
            
            container.appendChild(item);
        });
    },

    // 取得適合 API 的標記儲存格式
    getLabelString() {
        if (this.bboxes.length === 0) {
            return "";
        }
        // 如果只有一個框，且占據了 80% 以上，為分類任務簡化，直接儲存該標籤字串
        if (this.bboxes.length === 1 && this.bboxes[0].w >= 0.7 && this.bboxes[0].h >= 0.7) {
            return this.bboxes[0].label;
        }
        // 否則儲存為完整的 JSON 陣列 (代表多物件偵測邊框)
        return JSON.stringify(this.bboxes);
    }
};
