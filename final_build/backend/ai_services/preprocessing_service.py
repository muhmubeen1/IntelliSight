import cv2
import numpy as np


def preprocess_video(video_path, frame_count=16, size=(224, 224)):
    """
    Extract selected frames from a video for AI inference.

    Returns:
        List of OpenCV BGR frames.
    """

    cap = cv2.VideoCapture(video_path)

    if not cap.isOpened():
        raise ValueError("Could not open video file")

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    if total_frames <= 0:
        raise ValueError("Video has no readable frames")

    frame_indices = np.linspace(
        0,
        total_frames - 1,
        frame_count,
        dtype=int
    )

    frame_indices = set(frame_indices.tolist())

    frames = []
    current_frame = 0

    while True:
        ret, frame = cap.read()

        if not ret:
            break

        if current_frame in frame_indices:
            frame = cv2.resize(frame, size)
            frames.append(frame)

        current_frame += 1

    cap.release()

    if len(frames) == 0:
        raise ValueError("No frames extracted from video")

    while len(frames) < frame_count:
        frames.append(frames[-1])

    return frames