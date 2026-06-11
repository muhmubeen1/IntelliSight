from dataset_loader import VideoDataset

dataset = VideoDataset(
    "../dataset/train"
)

print(
    "Total Videos:",
    len(dataset)
)

if len(dataset) > 0:

    frames, label = dataset[0]

    print(
        "Frames Shape:",
        frames.shape
    )

    print(
        "Label:",
        label
    )