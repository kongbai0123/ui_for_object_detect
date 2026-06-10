// 訓練曲線即時繪圖引擎 (純 HTML5 Canvas 實作)
const TrainMonitor = {
    canvas: null,
    ctx: null,
    
    // 數據歷史記錄
    epochs: [],
    trainLosses: [],
    valLosses: [],
    accuracies: [],
    
    maxEpochs: 50,
    
    init(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext("2d");
        
        this.resize();
        window.addEventListener("resize", this.resize.bind(this));
    },
    
    resize() {
        if (!this.canvas) return;
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        this.draw();
    },
    
    reset(maxEpochs = 50) {
        this.epochs = [];
        this.trainLosses = [];
        this.valLosses = [];
        this.accuracies = [];
        this.maxEpochs = maxEpochs;
        this.draw();
    },
    
    addData(epoch, loss, valLoss, acc) {
        this.epochs.push(epoch);
        this.trainLosses.push(loss);
        this.valLosses.push(valLoss);
        this.accuracies.push(acc);
        this.draw();
    },
    
    draw() {
        if (!this.canvas || !this.ctx) return;
        
        const w = this.canvas.width;
        const h = this.canvas.height;
        
        const isLight = document.body.classList.contains("light-mode");
        
        // 清除畫布
        this.ctx.fillStyle = isLight ? "#eef0f6" : "#050508";
        this.ctx.fillRect(0, 0, w, h);
        
        // 邊距
        const padLeft = 45;
        const padRight = 45;
        const padTop = 30;
        const padBottom = 30;
        
        const graphW = w - padLeft - padRight;
        const graphH = h - padTop - padBottom;
        
        // 繪製背景網格線
        this.ctx.strokeStyle = isLight ? "rgba(0, 0, 0, 0.04)" : "rgba(255, 255, 255, 0.03)";
        this.ctx.lineWidth = 1;
        
        // 水平網格 (5條)
        for (let i = 0; i <= 4; i++) {
            const y = padTop + (graphH * i / 4);
            this.ctx.beginPath();
            this.ctx.moveTo(padLeft, y);
            this.ctx.lineTo(w - padRight, y);
            this.ctx.stroke();
            
            // 繪製左軸數值 (Loss: 0.0 ~ 1.0)
            this.ctx.fillStyle = "var(--text-muted)";
            this.ctx.font = "10px monospace";
            this.ctx.textAlign = "right";
            const lossVal = (1.0 - (i / 4)).toFixed(2);
            this.ctx.fillText(lossVal, padLeft - 8, y + 3);
            
            // 繪製右軸數值 (Acc: 0% ~ 100%)
            this.ctx.textAlign = "left";
            const accVal = `${Math.round(100 - (i * 25))}%`;
            this.ctx.fillText(accVal, w - padRight + 8, y + 3);
        }
        
        // 垂直網格 (根據最大 Epochs 分配)
        const gridInterval = Math.max(1, Math.ceil(this.maxEpochs / 10));
        for (let e = 0; e <= this.maxEpochs; e += gridInterval) {
            if (e === 0) continue;
            const x = padLeft + (graphW * (e - 1) / (this.maxEpochs - 1));
            this.ctx.beginPath();
            this.ctx.moveTo(x, padTop);
            this.ctx.lineTo(x, h - padBottom);
            this.ctx.stroke();
            
            // 繪製 X 軸數值 (Epoch)
            this.ctx.fillStyle = "var(--text-muted)";
            this.ctx.font = "10px monospace";
            this.ctx.textAlign = "center";
            this.ctx.fillText(e, x, h - padBottom + 16);
        }
        
        // 繪製座標軸線
        this.ctx.strokeStyle = isLight ? "rgba(0, 0, 0, 0.12)" : "rgba(255, 255, 255, 0.08)";
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();
        // 左軸
        this.ctx.moveTo(padLeft, padTop);
        this.ctx.lineTo(padLeft, h - padBottom);
        // 下軸
        this.ctx.lineTo(w - padRight, h - padBottom);
        // 右軸
        this.ctx.lineTo(w - padRight, padTop);
        this.ctx.stroke();
        
        if (this.epochs.length === 0) {
            // 沒有資料時顯示提示
            this.ctx.fillStyle = "var(--text-muted)";
            this.ctx.font = "12px var(--font-primary)";
            this.ctx.textAlign = "center";
            this.ctx.fillText("等待訓練啟動...", w / 2, h / 2);
            return;
        }
        
        // 坐標映射輔助函數
        // X 軸: 映射 Epoch 數
        const getX = (idx) => {
            if (this.maxEpochs <= 1) return padLeft;
            return padLeft + (graphW * idx / (this.maxEpochs - 1));
        };
        // Y 軸 (左): 映射 Loss (預設限制最大為 1.2，最小 0.0)
        const getYLeft = (val) => {
            const norm = Math.min(Math.max(val, 0), 1.2) / 1.2;
            return h - padBottom - (graphH * norm);
        };
        // Y 軸 (右): 映射 Accuracy (0% ~ 100%)
        const getYRight = (val) => {
            const norm = Math.min(Math.max(val, 0), 100) / 100;
            return h - padBottom - (graphH * norm);
        };
        
        // 1. 繪製 Train Loss 曲線 (藍色)
        this.drawLine(this.trainLosses, getX, getYLeft, "var(--neon-blue)", "rgba(0, 229, 255, 0.05)");
        
        // 2. 繪製 Val Loss 曲線 (紫色)
        this.drawLine(this.valLosses, getX, getYLeft, "var(--neon-purple)", "rgba(157, 78, 221, 0.05)");
        
        // 3. 繪製 Accuracy 曲線 (綠色)
        this.drawLine(this.accuracies, getX, getYRight, "var(--neon-green)", "rgba(0, 230, 118, 0.05)");
    },
    
    drawLine(dataList, getX, getY, strokeColor, fillColor) {
        if (dataList.length < 1) return;
        
        this.ctx.beginPath();
        this.ctx.moveTo(getX(0), getY(dataList[0]));
        
        for (let i = 1; i < dataList.length; i++) {
            this.ctx.lineTo(getX(i), getY(dataList[i]));
        }
        
        // 樣式設定
        this.ctx.strokeStyle = strokeColor;
        this.ctx.lineWidth = 2.5;
        this.ctx.stroke();
        
        // 繪製發光特效
        this.ctx.shadowBlur = 6;
        this.ctx.shadowColor = strokeColor;
        this.ctx.stroke();
        this.ctx.shadowBlur = 0; // 重設
        
        // 繪製最新點的大圓點發光特效
        const lastIdx = dataList.length - 1;
        const lastX = getX(lastIdx);
        const lastY = getY(dataList[lastIdx]);
        
        this.ctx.fillStyle = strokeColor;
        this.ctx.beginPath();
        this.ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
        this.ctx.fill();
        
        this.ctx.strokeStyle = strokeColor;
        this.ctx.beginPath();
        this.ctx.arc(lastX, lastY, 8, 0, Math.PI * 2);
        this.ctx.stroke();
    }
};
