import os
import json
import cv2
import torch
import torch.nn as nn
import numpy as np


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

        self.model = torch.hub.load(
            "facebookresearch/pytorchvideo",
            "i3d_r50",
            pretrained=False
        )

        self.model.blocks[-1].proj = nn.Linear(
            self.model.blocks[-1].proj.in_features,
            self.num_classes
        )

        state_dict = torch.load(self.model_path, map_location=self.device)
        self.model.load_state_dict(state_dict)

        self.model.to(self.device)
        self.model.eval()

        print("[INFO] True I3D Model Loaded")

    def predict_frames(self, rgb_frames):
        if len(rgb_frames) < 32:
            return {
                "label": "Unknown",
                "confidence": 0.0
            }

        frames = []

        for frame in rgb_frames[:32]:
            frame = frame / 255.0
            frames.append(frame)

        frames = np.array(frames, dtype=np.float32)

        # T,H,W,C -> C,T,H,W
        frames = np.transpose(frames, (3, 0, 1, 2))

        frames = torch.tensor(frames, dtype=torch.float32).unsqueeze(0)
        frames = frames.to(self.device)

        with torch.no_grad():
            outputs = self.model(frames)
            probabilities = torch.softmax(outputs, dim=1)
            confidence, predicted_idx = torch.max(probabilities, 1)

        label = self.idx_to_class[predicted_idx.item()]

        return {
            "label": label,
            "confidence": round(float(confidence.item()), 4)
        }

    def predict_video(self, video_path: str, max_frames: int = 32):
        """Extract frames from video path and predict."""
        import cv2
        
        frames = []
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            print(f"[I3D] Cannot open video: {video_path}")
            return {"label": "Unknown", "confidence": 0.0}
        
        frame_count = 0
        while len(frames) < max_frames:
            ret, frame = cap.read()
            if not ret:
                break
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            # Normalize to 0-1 range for I3D
            frame_normalized = frame_rgb / 255.0
            frames.append(frame_normalized)
            frame_count += 1
        
        cap.release()
        
        print(f"[I3D] Extracted {len(frames)} frames from {video_path}")
        
        if len(frames) == 0:
            return {"label": "Unknown", "confidence": 0.0}
        
        # Pad with last frame if needed
        while len(frames) < 32:
            frames.append(frames[-1])
        
        return self.predict_frames(frames)