class FusionService:
    def __init__(self):
        self.normal_label = "NormalVideos"

    def fuse_predictions(self, vit_result, i3d_result):
        vit_label = vit_result["label"]
        i3d_label = i3d_result["label"]

        vit_conf = vit_result["confidence"]
        i3d_conf = i3d_result["confidence"]

        if vit_label == "Unknown" and i3d_label == "Unknown":
            final_label = "Unknown"
            final_confidence = 0.0

        elif vit_label == i3d_label:
            final_label = vit_label
            final_confidence = (vit_conf + i3d_conf) / 2

        elif vit_label == self.normal_label and vit_conf >= 0.85:
            final_label = self.normal_label
            final_confidence = vit_conf

        elif i3d_label == self.normal_label and i3d_conf >= 0.85:
            final_label = self.normal_label
            final_confidence = i3d_conf

        else:
            if i3d_conf >= 0.80:
                final_label = i3d_label
                final_confidence = i3d_conf
            elif vit_conf >= 0.80:
                final_label = vit_label
                final_confidence = vit_conf
            else:
                final_label = "Uncertain"
                final_confidence = max(vit_conf, i3d_conf)

        alert_required = final_label not in [self.normal_label, "Unknown", "Uncertain"]

        return {
            "final_label": final_label,
            "final_confidence": round(final_confidence, 4),
            "alert_required": alert_required,
            "vit_prediction": vit_result,
            "i3d_prediction": i3d_result
        }