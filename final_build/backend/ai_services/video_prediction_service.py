from ai_services.vit_service import ViTService

vit = ViTService()


def predict_video_from_frames(frames, max_frames=32):
    predictions = []

    for frame in frames[:max_frames]:
        result = vit.predict_rgb_frame(frame)
        predictions.append(result)

    if not predictions:
        return {
            "label": "Unknown",
            "confidence": 0.0,
            "votes": {},
            "frames_used": 0
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
        "frames_used": len(predictions)
    }