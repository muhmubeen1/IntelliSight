class I3DService:

    def predict(self, vit_result):

        if vit_result["label"] == "NormalVideos":
            return {
                "label": "NormalVideos",
                "confidence": 0.80
            }

        return {
            "label": vit_result["label"],
            "confidence": max(
                0.70,
                vit_result["confidence"] - 0.10
            )
        }