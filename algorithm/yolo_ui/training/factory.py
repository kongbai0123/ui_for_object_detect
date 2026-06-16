# -*- coding: utf-8 -*-
from typing import Dict, Any
from training.base import BaseTrainer
from training.ultralytics_trainer import UltralyticsTrainer
from training.torchvision_classifier import TorchvisionClassifierTrainer

class TrainerFactory:
    @staticmethod
    def create_trainer(
        config: Dict[str, Any],
        output_dir: str,
        classes: list,
        input_path: str
    ) -> BaseTrainer:
        """
        根據配置與任務類型，建立對應的訓練器適配器。
        """
        # 可以依據 framework 或是 task_type
        # 例如 model_registry 中：
        # - detection 任務使用 ultralytics
        # - classification 任務使用 torchvision 或 ultralytics (如 yolov8n-cls)
        model_id = config.get("model_id", "")
        
        # 特殊 YOLO 分類模型，如 yolov8n-cls, yolo11n-cls 等，也使用 UltralyticsTrainer
        if "-cls" in model_id or config.get("framework") == "ultralytics":
            return UltralyticsTrainer(config, output_dir, classes, input_path)
            
        task_type = config.get("task_type", "detection")
        if task_type == "detection":
            return UltralyticsTrainer(config, output_dir, classes, input_path)
        elif task_type == "classification":
            return TorchvisionClassifierTrainer(config, output_dir, classes, input_path)
            
        raise ValueError(f"不支援的任務類型或模型架構: {task_type} / {model_id}")
