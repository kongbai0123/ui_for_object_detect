# -*- coding: utf-8 -*-
from abc import ABC, abstractmethod
from typing import Dict, Any

class BaseTrainer(ABC):
    def __init__(self, config: Dict[str, Any], output_dir: str):
        self.config = config
        self.output_dir = output_dir
        self.is_stopped = False
        self.train_status = {
            "status": "idle",
            "epoch": 0,
            "total_epochs": config.get("epochs", 50),
            "train_loss": 0.0,
            "val_loss": 0.0,
            "accuracy": 0.0,
            "best_accuracy": 0.0,
            "elapsed_time": 0,
            "remaining_time": 0,
            "log": []
        }

    @abstractmethod
    def train(self):
        """啟動背景訓練線程"""
        pass

    @abstractmethod
    def stop(self):
        """停止訓練線程"""
        pass

    def get_status(self) -> Dict[str, Any]:
        """獲取當前訓練狀態"""
        return self.train_status
