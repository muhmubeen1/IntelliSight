import os
import cv2
import torch
import numpy as np

from torch.utils.data import Dataset


class VideoDataset(Dataset):

    def __init__(
        self,
        root_dir,
        frame_count=32,
        size=(224, 224)
    ):

        self.root_dir = root_dir
        self.frame_count = frame_count
        self.size = size

        self.samples = []

        classes = {
            "normal": 0,
            "abnormal": 1
        }

        for class_name, label in classes.items():

            class_dir = os.path.join(
                root_dir,
                class_name
            )

            if not os.path.exists(class_dir):
                continue

            for file in os.listdir(class_dir):

                if file.endswith(
                    (
                        ".mp4",
                        ".avi",
                        ".mov"
                    )
                ):

                    self.samples.append(
                        (
                            os.path.join(
                                class_dir,
                                file
                            ),
                            label
                        )
                    )

    def __len__(self):
        return len(self.samples)

    def extract_frames(
        self,
        video_path
    ):

        cap = cv2.VideoCapture(video_path)

        total_frames = int(
            cap.get(
                cv2.CAP_PROP_FRAME_COUNT
            )
        )

        indices = np.linspace(
            0,
            max(total_frames - 1, 0),
            self.frame_count,
            dtype=int
        )

        frames = []

        current = 0

        while True:

            ret, frame = cap.read()

            if not ret:
                break

            if current in indices:

                frame = cv2.resize(
                    frame,
                    self.size
                )

                frame = cv2.cvtColor(
                    frame,
                    cv2.COLOR_BGR2RGB
                )

                frame = frame / 255.0

                frames.append(frame)

            current += 1

        cap.release()

        while len(frames) < self.frame_count:
            frames.append(frames[-1])

        return np.array(
            frames,
            dtype=np.float32
        )

    def __getitem__(
        self,
        idx
    ):

        video_path, label = self.samples[idx]

        frames = self.extract_frames(
            video_path
        )

        frames = torch.tensor(
            frames,
            dtype=torch.float32
        )

        frames = frames.permute(
            3,
            0,
            1,
            2
        )

        return frames, label