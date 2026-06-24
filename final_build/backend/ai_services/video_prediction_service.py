import cv2
from ai_services.vit_service import ViTService

vit = ViTService()

def predict_video(video_path, frame_skip=30, max_frames=20):
    cap = cv2.VideoCapture(video_path)

    predictions = []
    frame_count = 0
    used_frames = 0

    while cap.isOpened() and used_frames < max_frames:
        ret, frame = cap.read()

        if not ret:
            break

        if frame_count % frame_skip == 0:
            result = vit.predict_frame(frame)
            predictions.append(result)
            used_frames += 1

        frame_count += 1

    cap.release()

    if not predictions:
        return {
            "label": "Unknown",
            "confidence": 0.0,
            "votes": {}
        }

    votes = {}
    confidences = {}

    for pred in predictions:
        label = pred["label"]
        votes[label] = votes.get(label, 0) + 1
        confidences.setdefault(label, []).append(pred["confidence"])

    final_label = max(votes, key=votes.get)
    avg_confidence = sum(confidences[final_label]) / len(confidences[final_label])

    return {
        "label": final_label,
        "confidence": round(avg_confidence, 4),
        "votes": votes,
        "frames_used": used_frames
    }