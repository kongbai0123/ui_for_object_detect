import os
import sys
import json
import csv
import sys
csv.field_size_limit(10 * 1024 * 1024)
import time
import uuid
import shutil
import zipfile
import threading
from pathlib import Path
from typing import Dict, List, Optional
from datetime import datetime
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from fastapi.responses import FileResponse
from PIL import Image, ImageOps
import hashlib

VALID_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


app = FastAPI(title="YOLO UI Backend API", version="1.0.0")

# 允許跨域請求
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_no_cache_headers(request, call_next):
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith(("/css/", "/js/")):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

# 掛載 UI 靜態資源與首頁路由
ui_path = Path(__file__).parent.resolve()
app.mount("/css", StaticFiles(directory=str(ui_path / "css")), name="css")
app.mount("/js", StaticFiles(directory=str(ui_path / "js")), name="js")

@app.get("/images/{file_path:path}")
def get_project_image(file_path: str):
    if not active_project["input_path"]:
        raise HTTPException(status_code=400, detail="沒有啟用中的專案")
    
    input_dir = Path(active_project["input_path"]).resolve()
    full_path = (input_dir / file_path).resolve()
    
    # 預防路徑遍歷攻擊
    if not str(full_path).startswith(str(input_dir)):
        raise HTTPException(status_code=403, detail="存取被拒絕")
        
    if not full_path.exists() or not full_path.is_file():
        raise HTTPException(status_code=404, detail="圖片不存在")
        
    media_type = "image/webp" if file_path.lower().endswith(".webp") else "image/jpeg"
    from fastapi.responses import FileResponse
    return FileResponse(str(full_path), media_type=media_type)

@app.get("/")
def read_index():
    from fastapi.responses import FileResponse
    return FileResponse(str(ui_path / "index.html"))

# 全域狀態
# 自動標註任務管理
autolabel_tasks: Dict[str, dict] = {}
autolabel_stop_flags: Dict[str, bool] = {}
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
        
    return active_project

@app.get("/api/project/active")
def get_active_project():
    return active_project

@app.post("/api/project/close")
def close_project():
    global active_project
    active_project = {
        "project_name": "",
        "input_path": "",
        "output_path": "",
        "classes": [],
        "task_type": "Detection",
        "status": "idle"
    }
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

@app.get("/api/project/choose_file")
def choose_file():
    try:
        import tkinter as tk
        from tkinter import filedialog
        
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        
        file_path = filedialog.askopenfilename(
            initialdir="C:/",
            title="選擇 YOLO 模型權重檔案 (.pt)",
            filetypes=[("YOLO Weights", "*.pt"), ("All Files", "*.*")]
        )
        root.destroy()
        
        if file_path:
            file_path = file_path.replace("\\", "/")
            return {"status": "success", "path": file_path}
        return {"status": "cancelled", "path": ""}
    except Exception as e:
        return {"status": "error", "message": str(e), "path": ""}

@app.get("/api/studio/session/choose_open_file")
def choose_open_session_file():
    try:
        import tkinter as tk
        from tkinter import filedialog
        
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        
        file_path = filedialog.askopenfilename(
            initialdir="C:/",
            title="選擇 Vision Training Studio 紀錄檔",
            filetypes=[("VTS Project File", "*.vtsproj.json"), ("All Files", "*.*")]
        )
        root.destroy()
        
        if file_path:
            file_path = file_path.replace("\\", "/")
            return {"status": "success", "path": file_path}
        return {"status": "cancelled", "path": ""}
    except Exception as e:
        return {"status": "error", "message": str(e), "path": ""}

@app.get("/api/studio/session/choose_save_file")
def choose_save_session_file():
    try:
        import tkinter as tk
        from tkinter import filedialog
        
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        
        file_path = filedialog.asksaveasfilename(
            initialdir="C:/",
            title="保存 Vision Training Studio 紀錄檔",
            defaultextension=".vtsproj.json",
            filetypes=[("VTS Project File", "*.vtsproj.json"), ("All Files", "*.*")]
        )
        root.destroy()
        
        if file_path:
            file_path = file_path.replace("\\", "/")
            return {"status": "success", "path": file_path}
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

def validate_image_file(path: Path) -> bool:
    try:
        with Image.open(path) as im:
            im.verify()
        return True
    except Exception:
        return False

THUMB_DIRNAME = ".vts_cache/thumbs"

def make_thumb(input_dir: Path, rel_path: str) -> Optional[str]:
    try:
        src = (input_dir / rel_path).resolve()
        if not src.exists():
            return None
            
        cache_dir = input_dir / THUMB_DIRNAME
        cache_dir.mkdir(parents=True, exist_ok=True)

        key = hashlib.sha1(rel_path.encode("utf-8")).hexdigest()[:20]
        thumb_path = cache_dir / f"{key}.webp"

        if not thumb_path.exists():
            with Image.open(src) as im:
                try:
                    im = ImageOps.exif_transpose(im)
                except Exception:
                    pass
                im = im.convert("RGB")
                im.thumbnail((320, 320))
                try:
                    im.save(thumb_path, "WEBP", quality=70, method=6)
                except Exception:
                    # Fallback to JPEG if WebP support is not available in Pillow
                    thumb_path = cache_dir / f"{key}.jpg"
                    if not thumb_path.exists():
                        im.save(thumb_path, "JPEG", quality=80)

        actual_name = f"{key}.webp" if (cache_dir / f"{key}.webp").exists() else f"{key}.jpg"
        return f"/thumbs/{actual_name}"
    except Exception as e:
        print(f"[THUMB-ERROR] 產生縮圖失敗 ({rel_path}): {e}")
        return None

@app.get("/thumbs/{filename}")
def get_thumb(filename: str):
    if not active_project["input_path"]:
        raise HTTPException(status_code=400, detail="沒有啟用中的專案")
        
    thumb_dir = Path(active_project["input_path"]) / ".vts_cache" / "thumbs"
    full_path = (thumb_dir / filename).resolve()
    
    if not str(full_path).startswith(str(thumb_dir.resolve())):
        raise HTTPException(status_code=403, detail="禁止存取越界路徑")
        
    if not full_path.exists():
        raise HTTPException(status_code=404, detail="縮圖不存在")
        
    media_type = "image/webp" if filename.endswith(".webp") else "image/jpeg"
    return FileResponse(str(full_path), media_type=media_type)

@app.get("/api/data/scan")
def scan_data():
    if not active_project["input_path"]:
        raise HTTPException(status_code=400, detail="沒有啟用中的專案")
        
    input_dir = Path(active_project["input_path"])
    images = []
    
    # 掃描資料夾
    for root, dirs, files in os.walk(input_dir):
        # 排除 runs 與快取目錄，避免掃描到快取縮圖與訓練輸出
        if "runs" in root or ".vts_cache" in root:
            continue
        for f in files:
            ext = Path(f).suffix.lower()
            if ext in VALID_IMAGE_EXTENSIONS:
                rel_path = os.path.relpath(os.path.join(root, f), input_dir)
                # 換成斜線以利 Web 使用
                rel_path = rel_path.replace("\\", "/")
                images.append(rel_path)
                
    # 讀取 labels.csv
    labels = {}
    csv_file = input_dir / "labels.csv"
    if csv_file.exists():
        try:
            with open(csv_file, "r", encoding="utf-8", newline="") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    img_path = row.get("image_path")
                    label_val = row.get("label", "")
                    status = row.get("status", "done")
                    if img_path:
                        labels[img_path] = {"label": label_val, "status": status}
        except Exception as e:
            print(f"讀取 labels.csv 出錯: {e}")
            
    # 合併掃描結果
    image_list = []
    for img in images:
        lbl_info = labels.get(img, {"label": "", "status": "pending"})
        # 獲取縮圖 URL，若無快取縮圖則退回到原圖
        thumb = make_thumb(input_dir, img)
        image_list.append({
            "path": img,
            "url": f"/images/{img}",
            "thumb_url": thumb if thumb else f"/images/{img}",
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

def safe_extract_zip(zip_file: zipfile.ZipFile, target_dir: Path) -> int:
    imported_count = 0
    target_root = target_dir.resolve()

    for member in zip_file.infolist():
        if member.is_dir():
            continue

        member_path = Path(member.filename)
        if member_path.is_absolute() or ".." in member_path.parts:
            raise HTTPException(status_code=400, detail=f"ZIP 內含不安全路徑: {member.filename}")

        if member_path.suffix.lower() not in VALID_IMAGE_EXTENSIONS:
            continue

        output_path = (target_root / member_path).resolve()
        if target_root not in output_path.parents and output_path != target_root:
            raise HTTPException(status_code=400, detail=f"ZIP 內含越界路徑: {member.filename}")

        output_path.parent.mkdir(parents=True, exist_ok=True)
        with zip_file.open(member) as src, open(output_path, "wb") as dst:
            shutil.copyfileobj(src, dst)
            
        # 影像內容與損毀校驗
        if not validate_image_file(output_path):
            try:
                output_path.unlink()
            except Exception:
                pass
            continue
            
        imported_count += 1

    return imported_count

@app.post("/api/data/import")
async def import_data(files: List[UploadFile] = File(...)):
    if not active_project["input_path"]:
        raise HTTPException(status_code=400, detail="沒有啟用中的專案")

    input_dir = Path(active_project["input_path"]).resolve()
    input_dir.mkdir(parents=True, exist_ok=True)

    imported_count = 0
    skipped_count = 0

    for file in files:
        filename = Path(file.filename or "").name
        ext = Path(filename).suffix.lower()

        try:
            if ext == ".zip":
                with zipfile.ZipFile(file.file) as zf:
                    imported_count += safe_extract_zip(zf, input_dir)
            elif ext in VALID_IMAGE_EXTENSIONS:
                output_path = input_dir / filename
                with open(output_path, "wb") as dst:
                    shutil.copyfileobj(file.file, dst)
                
                # 影像內容與損毀校驗
                if not validate_image_file(output_path):
                    try:
                        output_path.unlink()
                    except Exception:
                        pass
                    skipped_count += 1
                else:
                    imported_count += 1
            else:
                skipped_count += 1
        except zipfile.BadZipFile:
            raise HTTPException(status_code=400, detail=f"ZIP 檔案格式無效: {filename}")
        finally:
            await file.close()

    return {
        "status": "success",
        "imported": imported_count,
        "skipped": skipped_count,
        "message": f"已成功匯入 {imported_count} 張圖片" + (f"，跳過 {skipped_count} 張不合法或損毀影像" if skipped_count > 0 else "")
    }

@app.post("/api/labels/save")
def save_labels(payload: Dict):
    if not active_project["input_path"]:
        raise HTTPException(status_code=400, detail="沒有啟用中的專案")
        
    input_dir = Path(active_project["input_path"])
    csv_file = input_dir / "labels.csv"
    
    # 儲存為 csv 格式
    try:
        with open(csv_file, "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=["image_path", "label", "status"])
            writer.writeheader()
            for img_path, info in payload.items():
                lbl = info.get("label", "")
                status = info.get("status", "done")
                writer.writerow({
                    "image_path": img_path,
                    "label": lbl,
                    "status": status
                })
        return {"status": "success", "message": "標籤已儲存"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"無法儲存標籤: {str(e)}")

# 模擬訓練執行緒
def simulate_training_job(cfg: 'TrainConfig', input_path: str, output_folder: str):
    global train_status
    import random
    
    start_time = time.time()
    best_acc = 0.0
    epochs = cfg.epochs
    
    # 建立輸出目錄
    out_dir = Path(output_folder)
    out_dir.mkdir(parents=True, exist_ok=True)
    
    # 寫入初版訓練 log
    log_file = out_dir / "train_log.txt"
    with open(log_file, "w", encoding="utf-8") as f:
        f.write("Vision Training Studio Simulation Started\n")
        f.write(f"Selected model: {cfg.model_id}\n")
        f.write(f"Task type: {cfg.task_type}\n")
        f.write(f"Image size: {cfg.img_size}\n")
        f.write(f"Batch size: {cfg.batch_size}\n")
        f.write(f"Device: {cfg.device}\n")
        f.write(f"Optimizer: {cfg.optimizer}\n")
        f.write(f"Learning rate: {cfg.lr}\n")
        f.write(f"Weight decay: {cfg.weight_decay}\n")
        f.write(f"AMP: {cfg.amp}\n")
        f.write(f"Early stop: {cfg.early_stop}\n")
        f.write(f"Patience: {cfg.patience}\n\n")
        
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

current_trainer = None

from typing import Union

class TrainConfig(BaseModel):
    model_id: str
    task_type: str = "detection"
    weights: str = ""
    img_size: int = 640
    epochs: int = 50
    batch_size: Union[str, int] = 16
    device: str = "auto"
    optimizer: str = "AdamW"
    lr: Union[str, float] = 0.001
    weight_decay: float = 0.0005
    patience: int = 20
    amp: bool = True
    early_stop: bool = True

@app.get("/api/models/registry")
def get_model_registry():
    registry_path = Path(__file__).parent / "config" / "model_registry.json"
    if not registry_path.exists():
        return {"tasks": {}}
    try:
        with open(registry_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"無法讀取模型註冊表: {str(e)}")

@app.post("/api/train/start")
def start_train(config: TrainConfig):
    global current_trainer, train_status, train_thread, stop_train_event
    
    if not active_project["input_path"]:
        raise HTTPException(status_code=400, detail="沒有啟用中的專案")
        
    # 檢查是否已經在訓練
    if current_trainer is not None:
        status = current_trainer.get_status()
        if status["status"] == "training":
            return {"status": "error", "message": "訓練已在進行中"}
    elif train_status["status"] == "training":
        return {"status": "error", "message": "訓練已在進行中"}
            
    # 建立 runs/train_YYYYMMDD_HHMMSS 資料夾
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    output_folder = Path(active_project["output_path"]) / f"train_{timestamp}"
    
    # 寫入初始訓練設定日誌
    initial_log = [
        "Initializing training environment...",
        f"Selected model: {config.model_id}",
        f"Task type: {config.task_type}",
        f"Image size: {config.img_size}",
        f"Batch size: {config.batch_size}",
        f"Device: {config.device}",
        f"Optimizer: {config.optimizer}",
        f"Learning rate: {config.lr}",
        f"Weight decay: {config.weight_decay}",
        f"AMP: {config.amp}",
        f"Early stop: {config.early_stop}",
        f"Patience: {config.patience}"
    ]
    
    # 初始化全域狀態（供模擬或舊端點使用）
    train_status = {
        "status": "training",
        "epoch": 0,
        "total_epochs": config.epochs,
        "train_loss": 0.0,
        "val_loss": 0.0,
        "accuracy": 0.0,
        "best_accuracy": 0.0,
        "elapsed_time": 0,
        "remaining_time": 0,
        "log": initial_log
    }
    
    stop_train_event.clear()
    
    # 統一調用 TrainerFactory 以利真實/模擬適配器自主對齊
    from training.factory import TrainerFactory
    config_dict = config.model_dump()
    config_dict["weights"] = config.model_id + ".pt" if "yolo" in config.model_id.lower() else config.model_id
    
    try:
        current_trainer = TrainerFactory.create_trainer(
            config=config_dict,
            output_dir=str(output_folder),
            classes=active_project["classes"],
            input_path=active_project["input_path"]
        )
        current_trainer.train()
        # 初始化適配器狀態
        train_status = current_trainer.get_status()
        train_status["log"] = initial_log + train_status["log"]
    except Exception as e:
        # Fallback 到內置的 simulate_training_job 進行一般性模擬
        print(f"[TRAIN] 無法使用工廠創建適配器 ({e})，Fallback 使用一般模擬。")
        current_trainer = None
        train_thread = threading.Thread(
            target=simulate_training_job,
            args=(config, active_project["input_path"], str(output_folder)),
            daemon=True
        )
        train_thread.start()
        
    return {"status": "success", "output_dir": str(output_folder)}

@app.get("/api/train/status")
def get_train_status():
    global current_trainer, train_status
    if current_trainer is not None:
        return current_trainer.get_status()
    return train_status

@app.post("/api/train/stop")
def stop_train():
    global current_trainer, train_status, stop_train_event
    if current_trainer is not None:
        status = current_trainer.get_status()
        if status["status"] == "training":
            current_trainer.stop()
            train_status = current_trainer.get_status()
            return {"status": "success", "message": "已傳送停止訊號"}
    elif train_status["status"] == "training":
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

class SaveSessionRequest(BaseModel):
    filepath: Optional[str] = None
    session_data: dict

@app.post("/api/studio/session/save")
def save_studio_session(req: SaveSessionRequest):
    global active_project
    session_data = req.session_data
    
    # 決定寫入路徑
    if req.filepath:
        target_path = Path(req.filepath)
    else:
        # 如果沒給 filepath，預設保存在當前專案根目錄下的 studio_session.vtsproj.json
        if not active_project.get("input_path"):
            raise HTTPException(status_code=400, detail="沒有啟用中的專案，無法自動保存，請點選另存新檔。")
        target_path = Path(active_project["input_path"]) / "studio_session.vtsproj.json"
        
    try:
        target_path.parent.mkdir(parents=True, exist_ok=True)
        with open(target_path, "w", encoding="utf-8") as f:
            json.dump(session_data, f, indent=4, ensure_ascii=False)
            
        # 同步更新全域 active_project 的值，好讓專案資訊與儲存的 session 一致
        input_path = session_data.get("input_path")
        if input_path:
            active_project["input_path"] = str(Path(input_path).resolve())
            active_project["project_name"] = session_data.get("project_name", active_project["project_name"])
            active_project["classes"] = session_data.get("classes", active_project["classes"])
            active_project["task_type"] = session_data.get("task_type", active_project["task_type"])
            active_project["status"] = "active"
            
            # 寫入設定檔 project_config.json
            config_file = Path(input_path) / "project_config.json"
            with open(config_file, "w", encoding="utf-8") as f:
                json.dump(active_project, f, indent=4, ensure_ascii=False)
                
        return {"status": "success", "message": f"成功保存紀錄檔至: {str(target_path)}", "filepath": str(target_path)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"保存紀錄檔失敗: {str(e)}")

class OpenSessionRequest(BaseModel):
    filepath: str

@app.post("/api/studio/session/open")
def open_studio_session(req: OpenSessionRequest):
    global active_project
    target_path = Path(req.filepath)
    if not target_path.exists():
        raise HTTPException(status_code=404, detail="找不到指定的紀錄檔")
        
    try:
        with open(target_path, "r", encoding="utf-8") as f:
            session_data = json.load(f)
            
        # 套用 session 中的專案路徑
        input_path = session_data.get("input_path")
        if not input_path:
            raise HTTPException(status_code=400, detail="紀錄檔格式錯誤：未包含 input_path")
            
        path = Path(input_path).resolve()
        if not path.exists():
            raise HTTPException(status_code=404, detail=f"紀錄檔中指定的專案目錄不存在: {input_path}")
            
        # 同步 active_project 全域變數
        active_project = {
            "project_name": session_data.get("project_name", path.name),
            "input_path": str(path),
            "output_path": session_data.get("output_path", str(path / "runs")),
            "classes": session_data.get("classes", []),
            "task_type": session_data.get("task_type", "Detection"),
            "status": "active"
        }
        
        # 寫入 project_config.json
        config_file = path / "project_config.json"
        with open(config_file, "w", encoding="utf-8") as f:
            json.dump(active_project, f, indent=4, ensure_ascii=False)
            
        # 更新至 projects.json 中
        projects = get_registered_projects()
        if not any(p["input_path"] == active_project["input_path"] for p in projects):
            projects.append({
                "project_name": active_project["project_name"],
                "input_path": active_project["input_path"],
                "output_path": active_project["output_path"],
                "classes": active_project["classes"],
                "task_type": active_project["task_type"]
            })
            save_registered_projects(projects)
            
        return {"status": "success", "session_data": session_data, "active_project": active_project}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"讀取紀錄檔失敗: {str(e)}")

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
            with open(csv_file, "r", encoding="utf-8", newline="") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    label_val = row.get("label", "").strip()
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
            print(f"Error reading labels.csv in dataset_check: {e}")
            
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
        # 排除 runs 與 exports 目錄
        parts = Path(root).parts
        if "runs" in parts or "exports" in parts:
            continue
        for f in files:
            ext = Path(f).suffix.lower()
            if ext in valid_extensions:
                rel_path = os.path.relpath(os.path.join(root, f), input_dir).replace("\\", "/")
                images.append(rel_path)
                
    if len(images) == 0:
        return {"status": "error", "message": "資料集中沒有圖片，無法進行切分"}
        
    # Group Stratified Split 演算法
    # 1. 載入 labels.csv 取得每張圖片的類別標籤
    label_map = {}
    csv_file = input_dir / "labels.csv"
    if csv_file.exists():
        try:
            import csv
            with open(csv_file, "r", encoding="utf-8", newline="") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    image_path = row.get("image_path", "")
                    label_val = row.get("label", "")
                    if image_path:
                        labels_list = []
                        label_str = label_val.strip()
                        if label_str.startswith("[") and label_str.endswith("]"):
                            try:
                                boxes = json.loads(label_str)
                                for b in boxes:
                                    lbl = b.get("label", "unknown")
                                    labels_list.append(lbl)
                            except Exception:
                                if label_str:
                                    labels_list.append(label_str)
                        else:
                            if label_str:
                                labels_list.append(label_str)
                        label_map[image_path] = labels_list
        except Exception as e:
            print(f"Error reading labels.csv during split: {e}")

    # 2. 定義群組規則 (Group Key)
    def get_group_key(rel_path: str) -> str:
        parts = Path(rel_path).parts
        if len(parts) > 1:
            return parts[0]
        else:
            filename = parts[-1]
            for sep in ['_', '-']:
                if sep in filename:
                    prefix = filename.split(sep)[0]
                    if prefix.strip():
                        return prefix
            return Path(filename).stem

    # 3. 分群
    groups = {}
    for img in images:
        g_key = get_group_key(img)
        if g_key not in groups:
            groups[g_key] = []
        groups[g_key].append(img)

    # 4. 統計全體與群組內各類別數量
    total_class_counts = {}
    group_stats = {}
    for g_key, img_list in groups.items():
        g_classes = {}
        for img in img_list:
            classes_in_img = label_map.get(img, ["background"])
            if not classes_in_img:
                classes_in_img = ["background"]
            for c in classes_in_img:
                g_classes[c] = g_classes.get(c, 0) + 1
                total_class_counts[c] = total_class_counts.get(c, 0) + 1
        group_stats[g_key] = g_classes

    # 5. 排定類別稀有度順序（出現次數少者排前面）
    sorted_classes = [c for c, count in sorted(total_class_counts.items(), key=lambda x: x[1])]

    def get_group_rarity_score(g_key):
        g_classes = group_stats[g_key]
        min_rank = len(sorted_classes)
        for c in g_classes:
            if c in sorted_classes:
                rank = sorted_classes.index(c)
                if rank < min_rank:
                    min_rank = rank
        return min_rank

    # 6. 對群組依最稀有類別優先度升序、圖片數量降序進行排序
    sorted_group_keys = sorted(
        groups.keys(),
        key=lambda k: (get_group_rarity_score(k), -len(groups[k]))
    )

    # 7. 啟發式分配群組
    target_ratios = {
        "train": req.train_ratio,
        "val": req.val_ratio,
        "test": req.test_ratio
    }
    
    # 確保 ratio 之和為 1.0
    sum_ratios = sum(target_ratios.values())
    if sum_ratios > 0:
        target_ratios = {k: v / sum_ratios for k, v in target_ratios.items()}
    else:
        target_ratios = {"train": 0.7, "val": 0.2, "test": 0.1}

    total_images_count = len(images)
    expected_sizes = {
        k: max(1, int(total_images_count * v)) for k, v in target_ratios.items()
    }

    splits = {"train": [], "val": [], "test": []}
    allocated_sizes = {"train": 0, "val": 0, "test": 0}
    allocated_class_counts = {
        s: {c: 0 for c in total_class_counts} for s in ["train", "val", "test"]
    }
    expected_class_counts = {
        s: {c: count * ratio for c, count in total_class_counts.items()}
        for s, ratio in target_ratios.items()
    }

    for g_key in sorted_group_keys:
        g_imgs = groups[g_key]
        g_classes = group_stats[g_key]
        g_size = len(g_imgs)

        best_set = None
        best_score = float('inf')

        for s_name in ["train", "val", "test"]:
            if target_ratios[s_name] == 0:
                continue

            size_ratio = allocated_sizes[s_name] / expected_sizes[s_name]
            class_score = 0.0
            for c, count in g_classes.items():
                expected = expected_class_counts[s_name][c]
                allocated = allocated_class_counts[s_name][c]
                class_score += (allocated + count) / (expected + 1e-5)

            # 總得分：結合圖片數比值與類別飽和度
            score = size_ratio * 2.0 + class_score
            if score < best_score:
                best_score = score
                best_set = s_name

        if not best_set:
            best_set = "train"

        splits[best_set].extend(g_imgs)
        allocated_sizes[best_set] += g_size
        for c, count in g_classes.items():
            allocated_class_counts[best_set][c] += count

    # 固定隨機 Seed 42 打亂每個分割集內部的順序，但保留成員不變以防 Data Leakage
    import random
    rng = random.Random(42)
    for s_name in splits:
        rng.shuffle(splits[s_name])

    split_data = {
        "train": splits["train"],
        "val": splits["val"],
        "test": splits["test"],
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
        "message": f"資料集已成功完成群組分層切分 (Group Stratified Split)！(訓練集: {len(splits['train'])}, 驗證集: {len(splits['val'])}, 測試集: {len(splits['test'])})",
        "train_count": len(splits["train"]),
        "val_count": len(splits["val"]),
        "test_count": len(splits["test"])
    }

def get_project_images(input_dir: Path) -> List[str]:
    valid_extensions = {".jpg", ".png", ".bmp", ".jpeg"}
    images = []
    for root, dirs, files in os.walk(input_dir):
        if "runs" in Path(root).parts or "exports" in Path(root).parts:
            continue
        for f in files:
            if Path(f).suffix.lower() in valid_extensions:
                rel_path = os.path.relpath(os.path.join(root, f), input_dir).replace("\\", "/")
                images.append(rel_path)
    return sorted(images)

def load_label_map(input_dir: Path) -> Dict[str, str]:
    labels = {}
    csv_file = input_dir / "labels.csv"
    if not csv_file.exists():
        return labels

    try:
        import csv
        with open(csv_file, "r", encoding="utf-8", newline="") as f:
            for row in csv.DictReader(f):
                image_path = row.get("image_path", "")
                if image_path:
                    labels[image_path] = row.get("label", "")
    except Exception as e:
        print(f"Error reading labels.csv for export: {e}")
    return labels

def label_to_yolo_lines(label_value: str, class_names: List[str]) -> List[str]:
    if not label_value:
        return []

    label_value = label_value.strip()
    lines = []
    if label_value.startswith("["):
        try:
            boxes = json.loads(label_value)
            for box in boxes:
                label = box.get("label", "")
                if label not in class_names:
                    class_names.append(label)
                class_id = class_names.index(label)
                x = float(box.get("x", 0.5))
                y = float(box.get("y", 0.5))
                w = float(box.get("w", 1.0))
                h = float(box.get("h", 1.0))
                lines.append(f"{class_id} {x:.6f} {y:.6f} {w:.6f} {h:.6f}")
        except Exception:
            return []
    else:
        label = label_value
        if label not in class_names:
            class_names.append(label)
        class_id = class_names.index(label)
        lines.append(f"{class_id} 0.500000 0.500000 1.000000 1.000000")
    return lines

@app.post("/api/dataset/export")
def export_dataset():
    if not active_project.get("input_path"):
        raise HTTPException(status_code=400, detail="沒有啟用中的專案")

    input_dir = Path(active_project["input_path"]).resolve()
    if not input_dir.exists():
        raise HTTPException(status_code=400, detail="專案目錄不存在")

    split_file = input_dir / "split_config.json"
    if split_file.exists():
        with open(split_file, "r", encoding="utf-8") as f:
            split_data = json.load(f)
    else:
        images = get_project_images(input_dir)
        total = len(images)
        train_end = int(total * 0.7)
        val_end = train_end + int(total * 0.2)
        split_data = {
            "train": images[:train_end],
            "val": images[train_end:val_end],
            "test": images[val_end:],
            "ratios": {"train": 0.7, "val": 0.2, "test": 0.1},
            "timestamp": time.time()
        }
        with open(split_file, "w", encoding="utf-8") as f:
            json.dump(split_data, f, indent=4, ensure_ascii=False)

    export_dir = input_dir / "exports" / "yolo_dataset_v001"
    if export_dir.exists():
        shutil.rmtree(export_dir)

    label_map = load_label_map(input_dir)
    class_names = list(active_project.get("classes") or [])
    counts = {}

    for split_name in ["train", "val", "test"]:
        images_dir = export_dir / "images" / split_name
        labels_dir = export_dir / "labels" / split_name
        images_dir.mkdir(parents=True, exist_ok=True)
        labels_dir.mkdir(parents=True, exist_ok=True)
        counts[split_name] = 0

        for rel_path in split_data.get(split_name, []):
            src = (input_dir / rel_path).resolve()
            if not src.exists() or input_dir not in src.parents:
                continue
            dst_img = images_dir / rel_path
            dst_img.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst_img)

            dst_label = labels_dir / Path(rel_path).with_suffix(".txt")
            dst_label.parent.mkdir(parents=True, exist_ok=True)
            lines = label_to_yolo_lines(label_map.get(rel_path, ""), class_names)
            with open(dst_label, "w", encoding="utf-8") as f:
                f.write("\n".join(lines))
            counts[split_name] += 1

    with open(export_dir / "classes.txt", "w", encoding="utf-8") as f:
        f.write("\n".join(class_names))

    yaml_lines = [
        f"path: {str(export_dir).replace(chr(92), '/')}",
        "train: images/train",
        "val: images/val",
        "test: images/test",
        f"nc: {len(class_names)}",
        "names:"
    ]
    yaml_lines.extend([f"  {i}: {name}" for i, name in enumerate(class_names)])
    with open(export_dir / "data.yaml", "w", encoding="utf-8") as f:
        f.write("\n".join(yaml_lines) + "\n")

    return {
        "status": "success",
        "export_path": str(export_dir),
        "counts": counts,
        "classes": class_names
    }

@app.post("/api/report/generate")
def generate_report():
    if not active_project.get("input_path"):
        raise HTTPException(status_code=400, detail="沒有啟用中的專案")

    input_dir = Path(active_project["input_path"]).resolve()
    output_dir = Path(active_project.get("output_path") or (input_dir / "runs")).resolve()
    report_dir = output_dir / "reports"
    report_dir.mkdir(parents=True, exist_ok=True)

    scan = scan_data()
    dataset = dataset_check()
    report_path = report_dir / "model_development_report.md"
    now = time.strftime("%Y-%m-%d %H:%M:%S")

    lines = [
        f"# {active_project.get('project_name', 'YOLO Project')} 模型開發報告",
        "",
        f"- 產生時間：{now}",
        f"- Input：{active_project.get('input_path', '')}",
        f"- Output：{active_project.get('output_path', '')}",
        f"- 任務類型：{active_project.get('task_type', 'Detection')}",
        "",
        "## 資料集摘要",
        f"- 圖片總數：{scan['summary']['total_images']}",
        f"- 已標註：{scan['summary']['done']}",
        f"- 待確認：{scan['summary']['pending']}",
        f"- 已忽略：{scan['summary']['ignored']}",
        f"- 健康分數：{dataset['health_score']}",
        "",
        "## 類別分布",
    ]

    if dataset["class_distribution"]:
        lines.extend([f"- {name}: {count}" for name, count in dataset["class_distribution"].items()])
    else:
        lines.append("- 尚無標註類別統計")

    lines.extend([
        "",
        "## 訓練狀態",
        f"- 目前狀態：{train_status['status']}",
        f"- Epoch：{train_status['epoch']} / {train_status['total_epochs']}",
        f"- Best Accuracy：{train_status['best_accuracy']}%",
        "",
        "## 後續建議",
        "- 若仍有待確認影像，請先完成標註審核。",
        "- 匯出 YOLO dataset 後，可使用 `data.yaml` 交給實際訓練流程。",
        "- 模型完成後請執行推論與錯誤樣本分析，再更新資料集。"
    ])

    with open(report_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    return {"status": "success", "report_path": str(report_path)}

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

class AutoLabelPayload(BaseModel):
    model_source: str = "project_best"
    model_path: Optional[str] = None
    confidence: float = 0.75
    iou: float = 0.5

def find_latest_best_model() -> str:
    if not active_project.get("output_path"):
        raise HTTPException(status_code=400, detail="目前無啟用中的專案或 output_path 未設定")

    output_dir = Path(active_project["output_path"])
    candidates = []
    
    if output_dir.exists():
        for p in output_dir.glob("train_*/**/*.pt"):
            if p.name in ["best.pt", "best_model.pt"]:
                candidates.append(p)
                
    if not candidates:
        raise HTTPException(
            status_code=404, 
            detail="找不到專案訓練產生的最佳模型 (best.pt 或 best_model.pt)。請先在訓練中心訓練模型，或者選擇使用預訓練 YOLOv8n/YOLO11n 模型。"
        )
        
    latest = max(candidates, key=lambda p: p.stat().st_mtime)
    return str(latest)

def resolve_autolabel_model(payload: AutoLabelPayload) -> str:
    if payload.model_source == "pretrained_yolov8n":
        return "yolov8n.pt"
    elif payload.model_source == "pretrained_yolo11n":
        return "yolo11n.pt"
    elif payload.model_source == "custom_path":
        if not payload.model_path:
            raise HTTPException(status_code=400, detail="自訂模型來源需要提供模型路徑")
        m_path = Path(payload.model_path).resolve()
        if not m_path.exists():
            raise HTTPException(status_code=404, detail=f"找不到自訂模型檔案: {m_path}")
        return str(m_path)
    elif payload.model_source == "project_best":
        return find_latest_best_model()
    else:
        raise HTTPException(status_code=400, detail=f"不支援的模型來源: {payload.model_source}")

def merge_and_save_labels(target_dir: Path, label_cache: dict):
    csv_file = target_dir / "labels.csv"
    existing_cache = {}
    
    if csv_file.exists():
        try:
            import csv
            with open(csv_file, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    existing_cache[row["image_path"]] = {
                        "label": row["label"],
                        "status": row["status"]
                    }
        except Exception as e:
            print(f"[AUTOLABEL] 讀取現有 labels.csv 失敗: {e}")
            
    # 合併新舊標記（精細保護策略）
    for img_path, new_data in label_cache.items():
        if img_path in existing_cache:
            old_status = existing_cache[img_path].get("status", "pending")
            old_label = existing_cache[img_path].get("label", "")
            # ignore：永遠不覆蓋（使用者已排除此圖）
            if old_status == "ignore":
                continue
            # done / verified：有標籤時不覆蓋
            if old_status in {"done", "verified"} and old_label not in ["", "[]"]:
                continue
        existing_cache[img_path] = new_data
        
    # 寫入 CSV 檔案
    try:
        import csv
        with open(csv_file, "w", encoding="utf-8", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["image_path", "label", "status"])
            for img_path, data in existing_cache.items():
                writer.writerow([
                    img_path,
                    data.get("label", "[]"),
                    data.get("status", "pending")
                ])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"儲存自動標註 CSV 失敗: {str(e)}")

# ---------------------------------------------------------------------------
# 自動標註背景 Worker
# ---------------------------------------------------------------------------
def run_auto_label_worker(task_id: str, payload: AutoLabelPayload):
    """在背景執行緒逐張推論，每張完成後即時更新任務狀態。"""
    task = autolabel_tasks[task_id]
    try:
        from ultralytics import YOLO
    except ImportError:
        task["status"] = "error"
        task["error"] = "系統尚未安裝 ultralytics，請執行 pip install ultralytics"
        task["completed_at"] = datetime.now().isoformat()
        return

    target_dir = Path(active_project.get("input_path", "")).resolve()
    if not target_dir.exists():
        task["status"] = "error"
        task["error"] = f"資料目錄不存在: {target_dir}"
        task["completed_at"] = datetime.now().isoformat()
        return

    try:
        model_ref = resolve_autolabel_model(payload)
    except HTTPException as e:
        task["status"] = "error"
        task["error"] = e.detail
        task["completed_at"] = datetime.now().isoformat()
        return

    task["model"] = model_ref
    task["log"].append(f"載入模型: {model_ref}")

    valid_exts = {".jpg", ".jpeg", ".png", ".bmp"}
    image_files = sorted([p for p in target_dir.rglob("*") if p.suffix.lower() in valid_exts])

    if not image_files:
        task["status"] = "error"
        task["error"] = "資料目錄中找不到任何圖片"
        task["completed_at"] = datetime.now().isoformat()
        return

    task["total"] = len(image_files)
    task["log"].append(f"共找到 {len(image_files)} 張圖片，開始推論...")

    try:
        model = YOLO(model_ref)
        task["task_type"] = getattr(model, "task", "detect")
    except Exception as e:
        task["status"] = "error"
        task["error"] = f"載入 YOLO 模型失敗: {str(e)}"
        task["completed_at"] = datetime.now().isoformat()
        return

    label_cache = {}

    for img_path in image_files:
        # 檢查停止旗標
        if autolabel_stop_flags.get(task_id, False):
            task["status"] = "stopped"
            task["log"].append("任務已被使用者停止")
            task["completed_at"] = datetime.now().isoformat()
            break

        rel_path = img_path.relative_to(target_dir).as_posix()
        task["current_image"] = rel_path
        task["current_image_url"] = f"/images/{rel_path}"

        try:
            results = model.predict(
                source=str(img_path),
                conf=payload.confidence,
                iou=payload.iou,
                verbose=False
            )
        except Exception as e:
            task["failed"] += 1
            task["processed"] += 1
            task["log"].append(f"[失敗] {img_path.name}: {str(e)[:80]}")
            # 保留最後 20 條 log
            if len(task["log"]) > 20:
                task["log"] = task["log"][-20:]
            continue

        boxes_json = []
        is_segment = getattr(model, "task", "detect") == "segment"

        if is_segment and any(r.masks is not None for r in results):
            for r in results:
                if r.masks is None:
                    continue
                img_h, img_w = r.orig_shape
                for i, xyn in enumerate(r.masks.xyn):
                    cls_id = int(r.boxes.cls[i])
                    conf_val = float(r.boxes.conf[i])
                    label_name = model.names.get(cls_id, str(cls_id))
                    
                    points = [[round(float(pt[0]), 6), round(float(pt[1]), 6)] for pt in xyn.tolist()]
                    if len(points) > 2:
                        boxes_json.append({
                            "type": "polygon",
                            "points": points,
                            "label": label_name,
                            "confidence": round(conf_val, 4)
                        })
        else:
            for r in results:
                if r.boxes is None:
                    continue
                img_h, img_w = r.orig_shape
                for box in r.boxes:
                    cls_id = int(box.cls[0])
                    conf_val = float(box.conf[0])
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    label_name = model.names.get(cls_id, str(cls_id))
                    boxes_json.append({
                        "x": round(x1 / img_w, 6),
                        "y": round(y1 / img_h, 6),
                        "w": round((x2 - x1) / img_w, 6),
                        "h": round((y2 - y1) / img_h, 6),
                        "label": label_name,
                        "confidence": round(conf_val, 4)
                    })

        label_cache[rel_path] = {
            "label": json.dumps(boxes_json, ensure_ascii=False),
            "status": "pending"
        }

        task["current_predictions"] = boxes_json
        task["processed"] += 1

        box_count = len(boxes_json)
        if box_count > 0:
            task["success"] += 1
            task["detected_images"] += 1
            task["total_boxes"] += box_count
            for box in boxes_json:
                cls_lbl = box.get("label", "unknown")
                task["class_counts"][cls_lbl] = task["class_counts"].get(cls_lbl, 0) + 1
        else:
            task["empty_images"] += 1

        # 保留最後 20 條 log
        if len(task["log"]) > 20:
            task["log"] = task["log"][-20:]

    # 寫入結果（無論完成或停止，都保存已處理部分）
    if label_cache:
        try:
            merge_and_save_labels(target_dir, label_cache)
            task["log"].append(f"已儲存 {len(label_cache)} 筆標註至 labels.csv")
        except Exception as e:
            task["log"].append(f"[警告] 儲存 labels.csv 失敗: {str(e)[:80]}")

    if task["status"] not in {"stopped", "error"}:
        task["status"] = "completed"
        task["log"].append("自動標註任務完成！")
    task["completed_at"] = datetime.now().isoformat()
    task["current_image"] = ""
    task["current_image_url"] = ""
    task["current_predictions"] = []


# ---------------------------------------------------------------------------
# 自動標註 API
# ---------------------------------------------------------------------------
@app.post("/api/autolabel/start")
def start_auto_label(payload: AutoLabelPayload):
    """啟動背景自動標註任務，立即回傳 task_id。"""
    if not active_project.get("input_path"):
        raise HTTPException(status_code=400, detail="請先在資料庫載入圖片資料夾")

    task_id = str(uuid.uuid4())
    autolabel_tasks[task_id] = {
        "task_id": task_id,
        "status": "running",
        "task_type": "detect",
        "total": 0,
        "processed": 0,
        "success": 0,
        "failed": 0,
        "detected_images": 0,
        "empty_images": 0,
        "total_boxes": 0,
        "class_counts": {},
        "current_image": "",
        "current_image_url": "",
        "current_predictions": [],
        "model": "",
        "confidence": payload.confidence,
        "iou": payload.iou,
        "started_at": datetime.now().isoformat(),
        "completed_at": "",
        "error": "",
        "log": ["自動標註任務已啟動"]
    }
    autolabel_stop_flags[task_id] = False

    thread = threading.Thread(
        target=run_auto_label_worker,
        args=(task_id, payload),
        daemon=True
    )
    thread.start()

    return {"status": "started", "task_id": task_id}


@app.get("/api/autolabel/status/{task_id}")
def get_auto_label_status(task_id: str):
    """查詢自動標註任務的即時狀態。"""
    task = autolabel_tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"找不到自動標註任務: {task_id}")
    return task


@app.post("/api/autolabel/stop/{task_id}")
def stop_auto_label(task_id: str):
    """通知背景任務停止推論（graceful stop）。"""
    if task_id not in autolabel_tasks:
        raise HTTPException(status_code=404, detail=f"找不到自動標註任務: {task_id}")
    autolabel_stop_flags[task_id] = True
    autolabel_tasks[task_id]["status"] = "stopping"
    autolabel_tasks[task_id]["log"].append("使用者要求停止任務")
    return {"status": "stopping", "task_id": task_id}


@app.post("/api/autolabel/run")
def run_auto_label_legacy(payload: AutoLabelPayload):
    """Legacy wrapper：保留向下相容，內部改為啟動背景任務。"""
    return start_auto_label(payload)


@app.post("/api/labels/version/create")
def create_label_version(payload: Dict):
    if not active_project["input_path"]:
        raise HTTPException(status_code=400, detail="沒有啟用中的專案")
    
    input_dir = Path(active_project["input_path"])
    csv_file = input_dir / "labels.csv"
    if not csv_file.exists():
        raise HTTPException(status_code=400, detail="目前專案沒有 labels.csv 檔案，無法備份")
        
    version_name = payload.get("version_name", "").strip()
    if not version_name:
        version_name = "backup"
        
    # 過濾非法字元
    version_name = "".join([c for c in version_name if c.isalnum() or c in ('_', '-')])
    
    # 建立目錄
    versions_dir = input_dir / "label_versions"
    versions_dir.mkdir(parents=True, exist_ok=True)
    
    # 計算標記框與已確認圖片
    total_boxes = 0
    verified_images = 0
    import csv
    try:
        with open(csv_file, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                lbl = row.get("label", "")
                status = row.get("status", "")
                if status in ["done", "verified"]:
                    verified_images += 1
                if lbl and lbl != "[]":
                    try:
                        boxes = json.loads(lbl)
                        total_boxes += len(boxes)
                    except:
                        pass
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"讀取 labels.csv 統計失敗: {str(e)}")
        
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    version_id = f"label_{timestamp}_{version_name}"
    backup_file_name = f"labels_{timestamp}_{version_name}.csv"
    backup_path = versions_dir / backup_file_name
    
    try:
        shutil.copy2(csv_file, backup_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"備份 labels.csv 失敗: {str(e)}")
        
    # 寫入 versions.json
    versions_json_path = versions_dir / "versions.json"
    versions = []
    if versions_json_path.exists():
        try:
            with open(versions_json_path, "r", encoding="utf-8") as f:
                versions = json.load(f)
        except:
            versions = []
            
    new_version_info = {
        "version": version_id,
        "name": version_name,
        "total_boxes": total_boxes,
        "verified_images": verified_images,
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "file": backup_file_name
    }
    
    versions.insert(0, new_version_info)
    
    try:
        with open(versions_json_path, "w", encoding="utf-8") as f:
            json.dump(versions, f, indent=4, ensure_ascii=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"寫入 versions.json 失敗: {str(e)}")
        
    return {"status": "success", "message": f"標籤版本 {version_name} 已成功備份", "version": new_version_info}


@app.get("/api/labels/version/list")
def list_label_versions():
    if not active_project["input_path"]:
        raise HTTPException(status_code=400, detail="沒有啟用中的專案")
        
    input_dir = Path(active_project["input_path"])
    versions_json_path = input_dir / "label_versions" / "versions.json"
    
    if not versions_json_path.exists():
        return {"status": "success", "versions": []}
        
    try:
        with open(versions_json_path, "r", encoding="utf-8") as f:
            versions = json.load(f)
        return {"status": "success", "versions": versions}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"無法讀取版本列表: {str(e)}")


@app.post("/api/labels/version/restore")
def restore_label_version(payload: Dict):
    if not active_project["input_path"]:
        raise HTTPException(status_code=400, detail="沒有啟用中的專案")
        
    version_id = payload.get("version")
    if not version_id:
        raise HTTPException(status_code=400, detail="未指定版本 ID")
        
    input_dir = Path(active_project["input_path"])
    versions_dir = input_dir / "label_versions"
    versions_json_path = versions_dir / "versions.json"
    
    if not versions_json_path.exists():
        raise HTTPException(status_code=404, detail="找不到版本記錄檔")
        
    try:
        with open(versions_json_path, "r", encoding="utf-8") as f:
            versions = json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"讀取版本記錄檔失敗: {str(e)}")
        
    target_version = None
    for v in versions:
        if v["version"] == version_id:
            target_version = v
            break
            
    if not target_version:
        raise HTTPException(status_code=404, detail="指定的版本不存在")
        
    backup_file = versions_dir / target_version["file"]
    if not backup_file.exists():
        raise HTTPException(status_code=404, detail=f"版本備份檔案 {target_version['file']} 不存在")
        
    csv_file = input_dir / "labels.csv"
    
    try:
        tmp_backup = versions_dir / f"labels_auto_before_restore_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
        if csv_file.exists():
            shutil.copy2(csv_file, tmp_backup)
            
        shutil.copy2(backup_file, csv_file)
        return {"status": "success", "message": f"已成功還原為版本 {target_version['name']}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"還原版本失敗: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
