from ai_services.fusion_service import fuse_predictions

i3d_result = {
    "label": "abnormal",
    "confidence": 0.90
}

vit_result = {
    "label": "abnormal",
    "confidence": 0.85
}

result = fuse_predictions(i3d_result, vit_result)

print(result)