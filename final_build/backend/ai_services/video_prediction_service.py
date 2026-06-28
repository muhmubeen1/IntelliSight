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


def predict_video(video_path, frame_skip=5, max_frames=32):
    """
    Original API that takes a video file path.
    Extracts frames and runs prediction.
    """
    import cv2
    
    frames = []
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return {
            "label": "Unknown",
            "confidence": 0.0,
            "votes": {},
            "frames_used": 0
        }
    
    frame_count = 0
    while len(frames) < max_frames:
        ret, frame = cap.read()
        if not ret:
            break
        
        if frame_count % frame_skip == 0:
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            frames.append(frame_rgb)
        
        frame_count += 1
    
    cap.release()
    
    return predict_video_from_frames(frames, max_frames=max_frames)