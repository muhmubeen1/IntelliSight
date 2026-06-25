import os
import json
import cv2
import torch
import numpy as np
import torch.nn as nn
import torchvision.models.video as video_models


class I3DService:
    def __init__(self):
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

        self.model_path = os.path.join(base_dir, "saved_models", "best_i3d.pth")
        self.classes_path = os.path.join(base_dir, "saved_models", "i3d_classes.json")

        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

        with open(self.classes_path, "r") as f:
            class_to_idx = json.load(f)

        self.idx_to_class = {v: k for k, v in class_to_idx.items()}
        self.num_classes = len(class_to_idx)

        self.model = video_models.r3d_18(weights=None)
        self.model.fc = nn.Linear(self.model.fc.in_features, self.num_classes)

        state_dict = torch.load(self.model_path, map_location=self.device)
        self.model.load_state_dict(state_dict)

        self.model.to(self.device)
        self.model.eval()

        print("[INFO] I3D/R3D Model Loaded")

    def load_video_frames(self, video_path, clip_len=32, frame_size=112):
        cap = cv2.VideoCapture(video_path)

        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        if total_frames <= 0:
            cap.release()
            return None

        frame_indices = np.linspace(0, total_frames - 1, clip_len).astype(int)
        frames = []

        for frame_idx in frame_indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            success, frame = cap.read()

            if not success:
                continue

            frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            frame = cv2.resize(frame, (frame_size, frame_size))
            frame = frame / 255.0

            frames.append(frame)

        cap.release()

        if len(frames) < clip_len:
            return None

        frames = np.array(frames, dtype=np.float32)

        # T,H,W,C → C,T,H,W
        frames = np.transpose(frames, (3, 0, 1, 2))

        frames = torch.tensor(frames, dtype=torch.float32).unsqueeze(0)

        return frames

    def predict_video(self, video_path):
        frames = self.load_video_frames(video_path)

        if frames is None:
            return {
                "label": "Unknown",
                "confidence": 0.0
            }

        frames = frames.to(self.device)

        with torch.no_grad():
            outputs = self.model(frames)
            probabilities = torch.softmax(outputs, dim=1)
            confidence, predicted_idx = torch.max(probabilities, 1)

        label = self.idx_to_class[predicted_idx.item()]
        confidence = float(confidence.item())

        return {
            "label": label,
            "confidence": round(confidence, 4)
        }