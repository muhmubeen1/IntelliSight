from ai_services.preprocessing_service import preprocess_video

video_path = "uploads/test.mp4"

frames = preprocess_video(video_path)

print("Preprocessing successful")
print("Frames shape:", frames.shape)