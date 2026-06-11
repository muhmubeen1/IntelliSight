import cv2

from ai_services.vit_service import ViTService

vit = ViTService()

frame = cv2.imread("test.jpg")

result = vit.predict_frame(frame)

print(result)