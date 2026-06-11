class FusionService:

    def fuse(self, vit_result, i3d_result):

        vit_conf = vit_result["confidence"]
        i3d_conf = i3d_result["confidence"]

        final_confidence = round(
            (vit_conf * 0.7) +
            (i3d_conf * 0.3),
            4
        )

        if vit_result["label"] == i3d_result["label"]:
            final_label = vit_result["label"]
        else:
            final_label = vit_result["label"]

        alert_required = (
            final_label != "NormalVideos"
            and final_confidence >= 0.70
        )

        return {
            "label": final_label,
            "confidence": final_confidence,
            "vit_prediction": vit_result,
            "i3d_prediction": i3d_result,
            "alert_required": alert_required
        }