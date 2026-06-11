from collections import Counter

from ai_services.preprocessing_service import preprocess_video
from ai_services.i3d_service import I3DService
from ai_services.vit_service import ViTService
from ai_services.fusion_service import FusionService


vit_service = ViTService()
i3d_service = I3DService()
fusion_service = FusionService()


def run_ai_pipeline(video_path):
    frames = preprocess_video(
        video_path,
        frame_count=32
    )

    if frames is None or len(frames) == 0:
        raise Exception("No frames extracted from video")

    vit_predictions = []

    for frame in frames:
        vit_result = vit_service.predict_frame(frame)
        vit_predictions.append(vit_result)

    labels = [prediction["label"] for prediction in vit_predictions]

    label_counts = Counter(labels)

    final_vit_label = label_counts.most_common(1)[0][0]

    same_label_predictions = [
        prediction for prediction in vit_predictions
        if prediction["label"] == final_vit_label
    ]

    avg_confidence = sum(
        prediction["confidence"] for prediction in same_label_predictions
    ) / len(same_label_predictions)

    vit_result = {
        "label": final_vit_label,
        "confidence": round(avg_confidence, 4),
        "frame_votes": dict(label_counts)
    }

    i3d_result = i3d_service.predict(vit_result)

    final_result = fusion_service.fuse(
        vit_result,
        i3d_result
    )
    

    return final_result