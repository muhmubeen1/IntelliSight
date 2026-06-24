import os
import json
import torch
import timm
import cv2

from PIL import Image
from torchvision import transforms


BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

MODEL_PATH = os.path.join(BASE_DIR, "saved_models", "best_vit.pth")
CLASSES_PATH = os.path.join(BASE_DIR, "saved_models", "vit_classes.json")

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"


class ViTService:

    def __init__(self):

        with open(CLASSES_PATH, "r") as file:
            class_map = json.load(file)

        self.class_names = [
            class_map[str(index)]
            for index in range(len(class_map))
        ]

        self.model = timm.create_model(
            "vit_base_patch16_224",
            pretrained=False,
            num_classes=len(self.class_names)
        )

        state_dict = torch.load(
            MODEL_PATH,
            map_location=DEVICE
        )

        self.model.load_state_dict(state_dict)

        self.model.to(DEVICE)
        self.model.eval()

        self.transform = transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize(
                mean=[0.485, 0.456, 0.406],
                std=[0.229, 0.224, 0.225]
            )
        ])

        print("[INFO] ViT Model Loaded")

    def predict_frame(self, frame):

        image = cv2.cvtColor(
            frame,
            cv2.COLOR_BGR2RGB
        )

        image = Image.fromarray(image)

        image = self.transform(image)
        image = image.unsqueeze(0)
        image = image.to(DEVICE)

        with torch.no_grad():

            outputs = self.model(image)

            probs = torch.softmax(
                outputs,
                dim=1
            )

            confidence, predicted = torch.max(
                probs,
                dim=1
            )

        label = self.class_names[
            predicted.item()
        ]

        return {
            "label": label,
            "confidence": round(confidence.item(), 4)
        }