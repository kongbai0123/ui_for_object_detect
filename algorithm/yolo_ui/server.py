import os
import sys
import json
import time
import shutil
import zipfile
import threading
from pathlib import Path
from typing import Dict, List, Optional
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

app = FastAPI(title="YOLO UI Backend API", version="1.0.0")

# 允許跨域請求
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 掛載 UI 靜態資源與首頁路由
ui_path = Path(__file__).parent.resolve()
app.mount("/css", StaticFiles(directory=str(ui_path / "css")), name="css")
app.mount("/js", StaticFiles(directory=str(ui_path / "js")), name="js")

@app.get("/")
def read_index():
    from fastapi.responses import FileResponse
    return FileResponse(str(ui_path / "index.html"))

# 全域狀態
active_project = {
    "project_name": "",
    "input_path": "",
    "output_path": "",
    "classes": [],
    "status": "idle"
}

# 訓練狀態
train_status = {
    "status": "idle",  # idle, training, paused, completed, stopped
    "epoch": 0,
    "total_epochs": 50,
    "train_loss": 0.0,
    "val_loss": 0.0,
    "accuracy": 0.0,
    "best_accuracy": 0.0,
    "elapsed_time": 0,
    "remaining_time": 0,
    "log": []
}

train_thread: Optional[threading.Thread] = None
stop_train_event = threading.Event()

PROJECTS_JSON_PATH = Path(__file__).parent / "projects.json"

def get_registered_projects() -> list:
    if not PROJECTS_JSON_PATH.exists():
        return []
    try:
        with open(PROJECTS_JSON_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []

def save_registered_projects(projects: list):
    try:
        with open(PROJECTS_JSON_PATH, "w", encoding="utf-8") as f:
            json.dump(projects, f, indent=4, ensure_ascii=False)
    except Exception as e:
        print(f"Error saving projects list: {e}")

class ProjectConfig(BaseModel):
    project_name: str
    input_path: str
    classes: List[str]
    task_type: Optional[str] = "Detection"
    output_path: Optional[str] = None

# 自動生成測試圖片 (當 input 目錄是空的時候)
def generate_sample_images(target_dir: Path):
    # 清理先前版本可能遺留的範例圖片
    sample_files = [
        "sample_cat_01.jpg",
        "sample_cat_02.jpg",
        "sample_dog_01.jpg",
        "sample_dog_02.jpg",
        "sample_person_01.jpg",
        "sample_person_02.jpg",
        "sample_mix_01.jpg"
    ]
    for name in sample_files:
        p = target_dir / name
        if p.exists():
            try:
                p.unlink()
            except Exception:
                pass
                
    # 如果 labels.csv 存在，則也將其清除，避免載入舊標籤
    csv_file = target_dir / "labels.csv"
    if csv_file.exists():
        try:
            csv_file.unlink()
        except Exception:
            pass

@app.post("/api/project/create")
def create_project(cfg: ProjectConfig):
    global active_project
    input_path = Path(cfg.input_path).resolve()
    task_type = cfg.task_type or "Detection"
    
    # 預設建立 input 資料夾
    try:
        input_path.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"無法建立 Input 路徑: {str(e)}")
        
    if cfg.output_path:
        runs_path = Path(cfg.output_path).resolve()
    else:
        runs_path = input_path / "runs"
        
    try:
        runs_path.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"無法建立 Output 路徑: {str(e)}")
    
    # 更新全域專案設定
    active_project = {
        "project_name": cfg.project_name,
        "input_path": str(input_path),
        "output_path": str(runs_path),
        "classes": cfg.classes,
        "task_type": task_type,
        "status": "active"
    }
    
    # 寫入設定檔 project_config.json
    config_file = input_path / "project_config.json"
    with open(config_file, "w", encoding="utf-8") as f:
        json.dump(active_project, f, indent=4, ensure_ascii=False)
        
    # 自動生成幾張範例圖片以供測試
    generate_sample_images(input_path)
    
    # 註冊至 projects.json
    projects = get_registered_projects()
    projects = [p for p in projects if p["input_path"] != str(input_path)]
    projects.append({
        "project_name": cfg.project_name,
        "input_path": str(input_path),
        "output_path": str(runs_path),
        "classes": cfg.classes,
        "task_type": task_type
    })
    save_registered_projects(projects)

    # 動態掛載靜態檔案目錄，以便前端讀取圖片
    try:
        found = False
        for route in app.routes:
            if hasattr(route, "path") and route.path == "/images":
                if hasattr(route, "app") and hasattr(route.app, "directory"):
                    route.app.directory = str(input_path)
                    found = True
                    break
        if not found:
            app.mount("/images", StaticFiles(directory=str(input_path)), name="images")
    except Exception as e:
        print(f"動態掛載目錄出錯: {e}")
        
    return active_project

@app.get("/api/project/active")
def get_active_project():
    return active_project

@app.get("/api/project/choose_directory")
def choose_directory():
    try:
        import tkinter as tk
        from tkinter import filedialog
        
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        
        folder_path = filedialog.askdirectory(initialdir="C:/", title="選擇專案工作目錄")
        root.destroy()
        
        if folder_path:
            folder_path = folder_path.replace("\\", "/")
            return {"status": "success", "path": folder_path}
        return {"status": "cancelled", "path": ""}
    except Exception as e:
        return {"status": "error", "message": str(e), "path": ""}

class ProjectUpdate(BaseModel):
    input_path: str
    output_path: str
    classes: Optional[List[str]] = None

@app.post("/api/project/update")
def update_project(cfg: ProjectUpdate):
    global active_project
    
    input_path = Path(cfg.input_path).resolve()
    output_path = Path(cfg.output_path).resolve()
    
    try:
        input_path.mkdir(parents=True, exist_ok=True)
        output_path.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"無法建立指定目錄: {str(e)}")
        
    # 如果原本沒有 active project，初始化預設專案
    if not active_project.get("project_name"):
        active_project["project_name"] = "YoloProject"
        active_project["classes"] = []
        active_project["status"] = "active"
        
    active_project["input_path"] = str(input_path)
    active_project["output_path"] = str(output_path)
    
    if cfg.classes is not None:
        active_project["classes"] = cfg.classes
    
    # 寫入設定檔 project_config.json
    config_file = input_path / "project_config.json"
    with open(config_file, "w", encoding="utf-8") as f:
        json.dump(active_project, f, indent=4, ensure_ascii=False)
        
    # 動態重新掛載靜態圖片目錄
    try:
        app.mount("/images", StaticFiles(directory=str(input_path)), name="images")
    except RuntimeError:
        pass
        
    return active_project

@app.get("/api/project/open_output_folder")
def open_output_folder():
    if not active_project.get("output_path"):
        raise HTTPException(status_code=400, detail="沒有啟用中的專案或未設定輸出路徑")
    
    path = Path(active_project["output_path"]).resolve()
    if not path.exists():
        try:
            path.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"無法建立輸出目錄: {str(e)}")
            
    try:
        if sys.platform == "win32":
            os.startfile(str(path))
        else:
            import subprocess
            if sys.platform == "darwin":
                subprocess.Popen(["open", str(path)])
            else:
                subprocess.Popen(["xdg-open", str(path)])
        return {"status": "success", "message": f"已開啟資料夾: {str(path)}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"無法開啟資料夾: {str(e)}")

@app.get("/api/data/scan")
def scan_data():
    if not active_project["input_path"]:
        raise HTTPException(status_code=400, detail="沒有啟用中的專案")
        
    input_dir = Path(active_project["input_path"])
    images = []
    valid_extensions = {".jpg", ".png", ".bmp", ".jpeg"}
    
    # 掃描資料夾
    for root, dirs, files in os.walk(input_dir):
        # 排除 runs 目錄，避免掃描到訓練輸出
        if "runs" in root:
            continue
        for f in files:
            ext = Path(f).suffix.lower()
            if ext in valid_extensions:
                rel_path = os.path.relpath(os.path.join(root, f), input_dir)
                # 換成斜線以利 Web 使用
                rel_path = rel_path.replace("\\", "/")
                images.append(rel_path)
                
    # 讀取 labels.csv
    labels = {}
    csv_file = input_dir / "labels.csv"
    if csv_file.exists():
        try:
            with open(csv_file, "r", encoding="utf-8") as f:
                lines = f.readlines()
                for line in lines[1:]:  # 跳過標題
                    parts = line.strip().split(",", 2)
                    if len(parts) >= 2:
                        img_path = parts[0]
                        label_val = parts[1]
                        status = parts[2] if len(parts) > 2 else "done"
                        labels[img_path] = {"label": label_val, "status": status}
        except Exception as e:
            print(f"讀取 labels.csv 出錯: {e}")
            
    # 合併掃描結果
    image_list = []
    for img in images:
        lbl_info = labels.get(img, {"label": "", "status": "pending"})
        image_list.append({
            "path": img,
            "url": f"/images/{img}",
            "label": lbl_info["label"],
            "status": lbl_info["status"]
        })
        
    # 計算統計摘要
    total = len(image_list)
    done_count = sum(1 for x in image_list if x["status"] == "done")
    pending_count = sum(1 for x in image_list if x["status"] == "pending")
    ignore_count = sum(1 for x in image_list if x["status"] == "ignore")
    
    return {
        "images": image_list,
        "summary": {
            "total_images": total,
            "done": done_count,
            "pending": pending_count,
            "ignored": ignore_count,
            "classes": active_project["classes"]
        }
    }

@app.post("/api/labels/save")
def save_labels(payload: Dict):
    if not active_project["input_path"]:
        raise HTTPException(status_code=400, detail="沒有啟用中的專案")
        
    input_dir = Path(active_project["input_path"])
    csv_file = input_dir / "labels.csv"
    
    # 儲存為 csv 格式
    try:
        with open(csv_file, "w", encoding="utf-8") as f:
            f.write("image_path,label,status\n")
            for img_path, info in payload.items():
                lbl = info.get("label", "")
                status = info.get("status", "done")
                # 避免逗號破壞 csv，將 label 加上引號 (物件偵測的 JSON string 也可以儲存)
                if "," in lbl or "[" in lbl:
                    lbl = f'"{lbl}"'
                f.write(f"{img_path},{lbl},{status}\n")
        return {"status": "success", "message": "標籤已儲存"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"無法儲存標籤: {str(e)}")

# 模擬訓練執行緒
def simulate_training_job(epochs: int, input_path: str, output_folder: str):
    global train_status
    import random
    
    start_time = time.time()
    best_acc = 0.0
    
    # 建立輸出目錄
    out_dir = Path(output_folder)
    out_dir.mkdir(parents=True, exist_ok=True)
    
    # 寫入初版訓練 log
    log_file = out_dir / "train_log.txt"
    with open(log_file, "w", encoding="utf-8") as f:
        f.write("YOLO UI Training Job Started\n")
        f.write(f"Input Dataset: {input_path}\n")
        f.write(f"Total Epochs: {epochs}\n\n")
        
    for epoch in range(1, epochs + 1):
        if stop_train_event.is_set():
            train_status["status"] = "stopped"
            with open(log_file, "a", encoding="utf-8") as f:
                f.write(f"\n[WARNING] Training aborted by user at epoch {epoch}.\n")
            break
            
        # 模擬訓練時間 (每 epoch 耗時 0.5 ~ 1 秒)
        time.sleep(0.8)
        
        # 物理公式或曲線擬合模擬
        # Loss 隨 Epoch 下降，Accuracy 隨 Epoch 上升
        factor = 1.0 - (epoch / epochs)
        train_loss = 0.8 * (factor ** 1.5) + random.uniform(0.01, 0.05)
        val_loss = 0.85 * (factor ** 1.5) + random.uniform(0.02, 0.07)
        accuracy = 95.0 - (35.0 * (factor ** 2.0)) + random.uniform(-1.0, 1.0)
        accuracy = min(max(accuracy, 10.0), 99.5)
        
        if accuracy > best_acc:
            best_acc = accuracy
            
        elapsed = int(time.time() - start_time)
        remaining = int((elapsed / epoch) * (epochs - epoch)) if epoch > 0 else 0
        
        # 更新狀態
        train_status["epoch"] = epoch
        train_status["train_loss"] = round(train_loss, 4)
        train_status["val_loss"] = round(val_loss, 4)
        train_status["accuracy"] = round(accuracy, 2)
        train_status["best_accuracy"] = round(best_acc, 2)
        train_status["elapsed_time"] = elapsed
        train_status["remaining_time"] = remaining
        
        log_entry = f"Epoch {epoch:03d}/{epochs:03d} - loss: {train_loss:.4f} - val_loss: {val_loss:.4f} - acc: {accuracy:.2f}%"
        train_status["log"].append(log_entry)
        
        # 寫入記錄檔
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(log_entry + "\n")
            
        # 寫入即時 metrics.json
        metrics_data = {
            "epoch": epoch,
            "train_loss": train_loss,
            "val_loss": val_loss,
            "accuracy": accuracy,
            "best_accuracy": best_acc
        }
        with open(out_dir / "metrics.json", "w", encoding="utf-8") as f:
            json.dump(metrics_data, f, indent=4)
            
    if train_status["status"] != "stopped":
        train_status["status"] = "completed"
        # 寫入最終模型成果與模擬圖表
        with open(out_dir / "best_model.pt", "w") as f:
            f.write("Simulated Best YOLO PyTorch Weights")
        with open(out_dir / "confusion_matrix.png", "w") as f:
            f.write("Simulated Confusion Matrix Image")
            
        # 建立導出設定
        export_dir = out_dir / "export"
        export_dir.mkdir(exist_ok=True)
        with open(export_dir / "labels.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(active_project["classes"]))
            
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(f"\n[INFO] Training finished successfully. Best Acc: {best_acc:.2f}%\n")

@app.post("/api/train/start")
def start_train(payload: Dict):
    global train_status, train_thread, stop_train_event
    
    if not active_project["input_path"]:
        raise HTTPException(status_code=400, detail="沒有啟用中的專案")
        
    if train_status["status"] == "training":
        return {"status": "error", "message": "訓練已在進行中"}
        
    epochs = int(payload.get("epochs", 50))
    
    # 建立 runs/train_YYYYMMDD_HHMMSS 資料夾
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    output_folder = Path(active_project["output_path"]) / f"train_{timestamp}"
    
    # 重設訓練狀態
    train_status = {
        "status": "training",
        "epoch": 0,
        "total_epochs": epochs,
        "train_loss": 0.0,
        "val_loss": 0.0,
        "accuracy": 0.0,
        "best_accuracy": 0.0,
        "elapsed_time": 0,
        "remaining_time": 0,
        "log": ["Initializing training environment..."]
    }
    
    stop_train_event.clear()
    
    # 啟動背景訓練執行緒
    train_thread = threading.Thread(
        target=simulate_training_job,
        args=(epochs, active_project["input_path"], str(output_folder)),
        daemon=True
    )
    train_thread.start()
    
    return {"status": "success", "output_dir": str(output_folder)}

@app.get("/api/train/status")
def get_train_status():
    return train_status

@app.post("/api/train/stop")
def stop_train():
    global train_status
    if train_status["status"] == "training":
        stop_train_event.set()
        train_status["status"] = "stopped"
        return {"status": "success", "message": "已傳送停止訊號"}
    return {"status": "error", "message": "目前未在訓練中"}

# --- 心跳與自動關閉機制 ---
last_heartbeat_time = time.time()
HEARTBEAT_TIMEOUT = 30.0
_heartbeat_started = False
_heartbeat_lock = threading.Lock()

def monitor_heartbeat():
    global last_heartbeat_time
    while True:
        time.sleep(5)
        if time.time() - last_heartbeat_time > HEARTBEAT_TIMEOUT:
            print("偵測到瀏覽器已關閉 (30秒無心跳)，正在關閉後端服務...")
            os._exit(0)

def start_heartbeat_monitor():
    global _heartbeat_started
    with _heartbeat_lock:
        if not _heartbeat_started:
            _heartbeat_started = True
            threading.Thread(target=monitor_heartbeat, daemon=True).start()

# 確保載入此模組時即啟動監控
start_heartbeat_monitor()

@app.get("/api/heartbeat")
def receive_heartbeat():
    global last_heartbeat_time
    last_heartbeat_time = time.time()
    return {"status": "ok"}

@app.post("/api/shutdown")
def shutdown_server():
    def delay_shutdown():
        time.sleep(0.5)
        os._exit(0)
    threading.Thread(target=delay_shutdown, daemon=True).start()
    return {"status": "shutdown_triggered"}

# --- 模型轉換與量化 API 實作 ---
transform_status = {
    "status": "idle",  # idle, exporting, completed, error
    "log": [],
    "output_file": ""
}

class ExportPayload(BaseModel):
    model_path: str
    format: str
    precision: str

def run_export_simulation(model_path: str, fmt: str, precision: str, output_path: str):
    global transform_status
    transform_status["status"] = "exporting"
    transform_status["log"] = [f"[INFO] Starting model export from {model_path} to {fmt.upper()} format..."]
    time.sleep(1.0)
    transform_status["log"].append(f"[INFO] Loading PyTorch weights... Size: 22.4 MB")
    time.sleep(0.8)
    transform_status["log"].append(f"[INFO] Converting network layers to {fmt.upper()} graph architecture...")
    time.sleep(1.0)
    if precision == "FP16":
        transform_status["log"].append(f"[INFO] Applying FP16 (Half-precision) compression to weights...")
    elif precision == "INT8":
        transform_status["log"].append(f"[INFO] Initializing INT8 quantization calibration loop...")
        time.sleep(0.8)
        transform_status["log"].append(f"[INFO] Calibration done. Calibrating scales for convolution filters...")
        time.sleep(0.8)
        transform_status["log"].append(f"[INFO] Quantizing model weights to 8-bit signed integers.")
    
    time.sleep(0.6)
    # 建立轉換後的模型檔案
    model_name = Path(model_path).stem
    out_dir = Path(output_path) / Path(model_path).parent / "export"
    out_dir.mkdir(exist_ok=True, parents=True)
    
    suffix = f".{fmt}"
    if fmt == "tensorrt":
        suffix = ".engine"
    elif fmt == "openvino":
        suffix = "_openvino_model"
    
    quant_prefix = f"_{precision.lower()}" if precision != "FP32" else ""
    converted_filename = f"{model_name}{quant_prefix}{suffix}"
    converted_file = out_dir / converted_filename
    
    with open(converted_file, "w") as f:
        f.write(f"Simulated Exported YOLO Model: format={fmt}, precision={precision}")
        
    transform_status["log"].append(f"[SUCCESS] Model conversion and optimization completed successfully!")
    transform_status["log"].append(f"[SUCCESS] Exported file size: {2.4 if precision == 'INT8' else 11.2 if precision == 'FP16' else 22.4:.1f} MB")
    transform_status["log"].append(f"[SUCCESS] Output saved: runs/{Path(model_path).parent.name}/export/{converted_filename}")
    
    transform_status["output_file"] = f"{Path(model_path).parent}/export/{converted_filename}".replace("\\", "/")
    transform_status["status"] = "completed"

@app.get("/api/transform/models")
def get_trained_models():
    if not active_project.get("output_path"):
        return []
    output_dir = Path(active_project["output_path"])
    if not output_dir.exists():
        return []
    
    models = []
    # 搜尋 runs/train_* 資料夾
    for p in output_dir.iterdir():
        if p.is_dir() and p.name.startswith("train_"):
            pt_files = list(p.glob("**/*.pt"))
            if pt_files:
                for pt in pt_files:
                    rel_pt = pt.relative_to(output_dir)
                    models.append({
                        "name": f"{p.name} ({pt.name})",
                        "path": str(rel_pt).replace("\\", "/")
                    })
    return models

@app.post("/api/transform/export")
def start_transform(payload: ExportPayload):
    global transform_status
    if not active_project.get("output_path"):
        raise HTTPException(status_code=400, detail="沒有啟用中的專案")
        
    # 啟動背景轉檔執行緒
    threading.Thread(
        target=run_export_simulation,
        args=(payload.model_path, payload.format, payload.precision, active_project["output_path"]),
        daemon=True
    ).start()
    return {"status": "success"}

@app.get("/api/transform/status")
def get_transform_status():
    return transform_status

@app.get("/api/transform/download")
def download_model(file: str):
    if not active_project.get("output_path"):
        raise HTTPException(status_code=400, detail="沒有啟用中的專案")
    filepath = Path(active_project["output_path"]) / file
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="找不到指定的模型檔案")
    from fastapi.responses import FileResponse
    return FileResponse(str(filepath), filename=filepath.name)

# --- 模型推論預測 API 實作 ---
@app.post("/api/inference/run")
async def run_inference(
    model: str = Form(""),
    conf: float = Form(0.25),
    file: UploadFile = File(...)
):
    if not active_project.get("input_path"):
        raise HTTPException(status_code=400, detail="沒有啟用中的專案")
    
    contents = await file.read()
    
    # 取得影像長寬
    width, height = 640, 480
    try:
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(contents))
        width, height = img.size
    except Exception:
        pass
        
    import random
    inf_time_ms = random.uniform(6.0, 18.0)
    
    # 依類別隨機預測
    predictions = []
    classes = active_project["classes"]
    if classes:
        num_preds = random.randint(1, 3)
        for _ in range(num_preds):
            pred_conf = random.uniform(0.3, 0.98)
            if pred_conf >= conf:
                w = random.uniform(0.15, 0.35)
                h = random.uniform(0.15, 0.35)
                x = random.uniform(0.05, 0.95 - w)
                y = random.uniform(0.05, 0.95 - h)
                label = random.choice(classes)
                predictions.append({
                    "x": x,
                    "y": y,
                    "w": w,
                    "h": h,
                    "label": label,
                    "confidence": round(pred_conf, 2)
                })
                
    # 存入 input_path 底下之暫存測試檔案，以便前端渲染
    input_dir = Path(active_project["input_path"])
    temp_file = input_dir / "temp_inference.jpg"
    with open(temp_file, "wb") as f:
        f.write(contents)
        
    return {
        "status": "success",
        "predictions": predictions,
        "inference_time": f"{inf_time_ms:.1f} ms",
        "size": f"{width} x {height}",
        "url": "/images/temp_inference.jpg?t=" + str(int(time.time()))
    }

class SwitchProjectRequest(BaseModel):
    input_path: str

class SplitRequest(BaseModel):
    train_ratio: float
    val_ratio: float
    test_ratio: float

class ModelTagRequest(BaseModel):
    model_path: str
    stage: str

@app.get("/api/projects/list")
def list_projects():
    return get_registered_projects()

@app.post("/api/projects/switch")
def switch_project(req: SwitchProjectRequest):
    global active_project
    path = Path(req.input_path).resolve()
    config_file = path / "project_config.json"
    if not config_file.exists():
        if path.exists():
            active_project = {
                "project_name": path.name,
                "input_path": str(path),
                "output_path": str(path / "runs"),
                "classes": ["cat", "dog"],
                "task_type": "Detection",
                "status": "active"
            }
            with open(config_file, "w", encoding="utf-8") as f:
                json.dump(active_project, f, indent=4, ensure_ascii=False)
        else:
            raise HTTPException(status_code=404, detail="找不到專案路徑與設定檔")
    else:
        with open(config_file, "r", encoding="utf-8") as f:
            active_project = json.load(f)
            active_project["status"] = "active"

    # 動態更新掛載點
    try:
        found = False
        for route in app.routes:
            if hasattr(route, "path") and route.path == "/images":
                if hasattr(route, "app") and hasattr(route.app, "directory"):
                    route.app.directory = active_project["input_path"]
                    found = True
                    break
        if not found:
            app.mount("/images", StaticFiles(directory=active_project["input_path"]), name="images")
    except Exception as e:
        print(f"動態掛載目錄出錯: {e}")

    # 也更新到 projects.json 中
    projects = get_registered_projects()
    if not any(p["input_path"] == active_project["input_path"] for p in projects):
        projects.append({
            "project_name": active_project["project_name"],
            "input_path": active_project["input_path"],
            "output_path": active_project["output_path"],
            "classes": active_project["classes"],
            "task_type": active_project.get("task_type", "Detection")
        })
        save_registered_projects(projects)

    return active_project

@app.get("/api/system/check")
def system_check():
    import sys
    import platform
    
    py_ver = sys.version.split()[0]
    torch_installed = False
    torch_ver = "Missing"
    cuda_available = False
    cuda_device_count = 0
    gpu_name = "-"
    vram_total = 0
    vram_free = 0
    cudnn_ver = "-"
    
    try:
        import torch
        torch_installed = True
        torch_ver = torch.__version__
        cuda_available = torch.cuda.is_available()
        if cuda_available:
            cuda_device_count = torch.cuda.device_count()
            gpu_name = torch.cuda.get_device_name(0)
            t = torch.cuda.get_device_properties(0).total_memory
            r = torch.cuda.memory_reserved(0)
            a = torch.cuda.memory_allocated(0)
            vram_total = round(t / (1024 ** 2))
            vram_free = round((t - a) / (1024 ** 2))
            if torch.backends.cudnn.is_available():
                cudnn_ver = str(torch.backends.cudnn.version())
    except Exception:
        pass

    ultralytics_ver = "Missing"
    try:
        import ultralytics
        ultralytics_ver = ultralytics.__version__
    except Exception:
        pass
        
    opencv_ver = "Missing"
    try:
        import cv2
        opencv_ver = cv2.__version__
    except Exception:
        pass
        
    ort_ver = "Missing"
    try:
        import onnxruntime
        ort_ver = onnxruntime.__version__
    except Exception:
        pass

    writable = False
    if active_project.get("input_path"):
        try:
            test_file = Path(active_project["input_path"]) / "perm_test.tmp"
            with open(test_file, "w") as f:
                f.write("test")
            test_file.unlink()
            writable = True
        except Exception:
            pass
            
    return {
        "python_version": py_ver,
        "torch_version": torch_ver,
        "cuda_available": cuda_available,
        "cuda_device_count": cuda_device_count,
        "gpu_name": gpu_name,
        "vram_total_mb": vram_total,
        "vram_free_mb": vram_free,
        "cudnn_version": cudnn_ver,
        "ultralytics_version": ultralytics_ver,
        "opencv_version": opencv_ver,
        "onnxruntime_version": ort_ver,
        "dataset_path_valid": bool(active_project.get("input_path") and Path(active_project["input_path"]).exists()),
        "output_path_writable": writable,
        "os_platform": f"{platform.system()} {platform.release()}"
    }

@app.get("/api/dataset/check")
def dataset_check():
    if not active_project.get("input_path"):
        raise HTTPException(status_code=400, detail="沒有啟用中的專案")
        
    input_dir = Path(active_project["input_path"])
    if not input_dir.exists():
        raise HTTPException(status_code=400, detail="專案目錄不存在")

    valid_extensions = {".jpg", ".png", ".bmp", ".jpeg"}
    total_images = 0
    broken_images = []
    image_sizes = {}
    
    from PIL import Image
    for root, dirs, files in os.walk(input_dir):
        if "runs" in root:
            continue
        for f in files:
            ext = Path(f).suffix.lower()
            if ext in valid_extensions:
                total_images += 1
                img_path = Path(root) / f
                try:
                    with Image.open(img_path) as img:
                        img.verify()
                    with Image.open(img_path) as img:
                        size_str = f"{img.size[0]}x{img.size[1]}"
                        image_sizes[size_str] = image_sizes.get(size_str, 0) + 1
                except Exception:
                    broken_images.append(os.path.relpath(img_path, input_dir).replace("\\", "/"))
                    
    labeled_images = 0
    empty_images = 0
    class_distribution = {}
    labels = {}
    
    csv_file = input_dir / "labels.csv"
    if csv_file.exists():
        try:
            with open(csv_file, "r", encoding="utf-8") as f:
                lines = f.readlines()
                for line in lines[1:]:
                    parts = line.strip().split(",", 2)
                    if len(parts) >= 2:
                        img_path = parts[0]
                        label_val = parts[1].strip()
                        if label_val.startswith('"') and label_val.endswith('"'):
                            label_val = label_val[1:-1]
                        
                        if label_val:
                            if label_val.startswith("["):
                                try:
                                    boxes = json.loads(label_val)
                                    if len(boxes) > 0:
                                        labeled_images += 1
                                        for b in boxes:
                                            lbl = b.get("label", "unknown")
                                            class_distribution[lbl] = class_distribution.get(lbl, 0) + 1
                                    else:
                                        empty_images += 1
                                except Exception:
                                    labeled_images += 1
                                    class_distribution[label_val] = class_distribution.get(label_val, 0) + 1
                            else:
                                labeled_images += 1
                                class_distribution[label_val] = class_distribution.get(label_val, 0) + 1
                        else:
                            empty_images += 1
        except Exception as e:
            print(f"Error reading labels.csv: {e}")
            
    empty_images = total_images - labeled_images
    
    health_score = 100
    if total_images == 0:
        health_score = 0
    else:
        health_score -= len(broken_images) * 10
        labeled_pct = labeled_images / total_images
        if labeled_pct < 0.5:
            health_score -= int((0.5 - labeled_pct) * 60)
        
    health_score = max(min(health_score, 100), 0)
    
    return {
        "health_score": health_score,
        "total_images": total_images,
        "labeled_images": labeled_images,
        "empty_images": empty_images,
        "broken_images": broken_images,
        "class_distribution": class_distribution,
        "image_sizes": image_sizes
    }

@app.post("/api/dataset/split")
def dataset_split(req: SplitRequest):
    if not active_project.get("input_path"):
        raise HTTPException(status_code=400, detail="沒有啟用中的專案")
        
    input_dir = Path(active_project["input_path"])
    valid_extensions = {".jpg", ".png", ".bmp", ".jpeg"}
    
    images = []
    for root, dirs, files in os.walk(input_dir):
        if "runs" in root:
            continue
        for f in files:
            ext = Path(f).suffix.lower()
            if ext in valid_extensions:
                rel_path = os.path.relpath(os.path.join(root, f), input_dir).replace("\\", "/")
                images.append(rel_path)
                
    if len(images) == 0:
        return {"status": "error", "message": "資料集中沒有圖片，無法進行切分"}
        
    import random
    random.shuffle(images)
    
    total = len(images)
    train_end = int(total * req.train_ratio)
    val_end = train_end + int(total * req.val_ratio)
    
    train_imgs = images[:train_end]
    val_imgs = images[train_end:val_end]
    test_imgs = images[val_end:]
    
    split_data = {
        "train": train_imgs,
        "val": val_imgs,
        "test": test_imgs,
        "ratios": {
            "train": req.train_ratio,
            "val": req.val_ratio,
            "test": req.test_ratio
        },
        "timestamp": time.time()
    }
    
    with open(input_dir / "split_config.json", "w", encoding="utf-8") as f:
        json.dump(split_data, f, indent=4, ensure_ascii=False)
        
    return {
        "status": "success",
        "message": f"資料集已成功切分！(訓練集: {len(train_imgs)}, 驗證集: {len(val_imgs)}, 測試集: {len(test_imgs)})",
        "train_count": len(train_imgs),
        "val_count": len(val_imgs),
        "test_count": len(test_imgs)
    }

@app.get("/api/experiments/list")
def list_experiments():
    if not active_project.get("output_path"):
        return []
        
    runs_dir = Path(active_project["output_path"])
    if not runs_dir.exists():
        return []
        
    experiments = []
    for d in runs_dir.iterdir():
        if d.is_dir() and d.name.startswith("train_"):
            run_id = d.name
            best_acc = "-"
            epochs = "-"
            train_loss = "-"
            val_loss = "-"
            
            metrics_file = d / "metrics.json"
            if metrics_file.exists():
                try:
                    with open(metrics_file, "r", encoding="utf-8") as f:
                        m = json.load(f)
                        best_acc = f"{m.get('best_accuracy', m.get('accuracy', '-'))}%"
                        epochs = m.get("epoch", "-")
                        train_loss = m.get("train_loss", "-")
                        val_loss = m.get("val_loss", "-")
                except Exception:
                    pass
                    
            c_time = d.stat().st_ctime
            time_str = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(c_time))
            
            experiments.append({
                "run_id": run_id,
                "created_at": time_str,
                "best_accuracy": best_acc,
                "epoch": epochs,
                "train_loss": train_loss,
                "val_loss": val_loss,
                "path": str(d)
            })
            
    experiments.sort(key=lambda x: x["created_at"], reverse=True)
    return experiments

@app.get("/api/models/list")
def list_models():
    if not active_project.get("output_path"):
        return []
        
    runs_dir = Path(active_project["output_path"])
    if not runs_dir.exists():
        return []
        
    models = []
    for root, dirs, files in os.walk(runs_dir):
        for f in files:
            ext = Path(f).suffix.lower()
            if ext in {".pt", ".onnx", ".tflite", ".xml", ".engine"}:
                full_path = Path(root) / f
                rel_path = os.path.relpath(full_path, runs_dir).replace("\\", "/")
                size_mb = round(full_path.stat().st_size / (1024 ** 2), 2)
                c_time = full_path.stat().st_ctime
                time_str = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(c_time))
                
                stage = "Draft"
                registry_config = runs_dir / "models_registry.json"
                if registry_config.exists():
                    try:
                        with open(registry_config, "r", encoding="utf-8") as rf:
                              reg = json.load(rf)
                              stage = reg.get(rel_path, {}).get("stage", "Draft")
                    except Exception:
                        pass
                        
                models.append({
                    "name": f,
                    "path": rel_path,
                    "size_mb": size_mb,
                    "stage": stage,
                    "format": ext[1:].upper(),
                    "created_at": time_str
                })
    return models

@app.post("/api/models/tag")
def tag_model(req: ModelTagRequest):
    if not active_project.get("output_path"):
        raise HTTPException(status_code=400, detail="沒有啟用中的專案")
        
    runs_dir = Path(active_project["output_path"])
    registry_config = runs_dir / "models_registry.json"
    
    reg = {}
    if registry_config.exists():
        try:
            with open(registry_config, "r", encoding="utf-8") as f:
                reg = json.load(f)
        except Exception:
            pass
            
    if req.model_path not in reg:
        reg[req.model_path] = {}
    reg[req.model_path]["stage"] = req.stage
    
    try:
        with open(registry_config, "w", encoding="utf-8") as f:
            json.dump(reg, f, indent=4, ensure_ascii=False)
        return {"status": "success", "message": "模型標籤更新成功"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"無法儲存標籤: {str(e)}")

@app.get("/api/logs/read")
def read_logs():
    if active_project.get("output_path"):
        runs_dir = Path(active_project["output_path"])
        if runs_dir.exists():
            latest_log = None
            latest_time = 0
            for d in runs_dir.iterdir():
                if d.is_dir() and d.name.startswith("train_"):
                    log_file = d / "train_log.txt"
                    if log_file.exists():
                        c_time = log_file.stat().st_mtime
                        if c_time > latest_time:
                            latest_time = c_time
                            latest_log = log_file
            if latest_log:
                try:
                    with open(latest_log, "r", encoding="utf-8") as f:
                        return {"source": latest_log.name, "lines": f.readlines()[-300:]}
                except Exception:
                    pass

    backend_log = Path(__file__).parent / "backend_err.log"
    if backend_log.exists():
        try:
            with open(backend_log, "r", encoding="utf-8") as f:
                return {"source": "backend_err.log", "lines": f.readlines()[-300:]}
        except Exception:
            pass
            
    return {"source": "None", "lines": ["目前尚無日誌記錄。"]}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)

