class FusionService:
    def __init__(self):
        self.normal_label = "NormalVideos"
        self.alert_threshold = 0.60

    def fuse_predictions(self, i3d_result, vit_result):
        vit_label = vit_result.get("label", self.normal_label)
        vit_conf = float(vit_result.get("confidence", 0.0))

        # I3D is currently unreliable, so final decision uses ViT only
        return self._build_result(
            vit_label,
            vit_conf,
            "vit_only_i3d_disabled",
            i3d_result,
            vit_result
        )

    def _build_result(self, label, confidence, source, i3d_result, vit_result):
        confidence = round(float(confidence), 4)

        alert_required = (
            label != self.normal_label
            and confidence >= self.alert_threshold
        )

        return {
            "label": label,
            "confidence": confidence,
            "final_label": label,
            "final_confidence": confidence,
            "alert_required": alert_required,
            "severity": self._get_severity(label, confidence),
            "fusion_source": source,
            "i3d_prediction": i3d_result,
            "vit_prediction": vit_result,
        }

    def _get_severity(self, label, confidence):
        if label == self.normal_label:
            return "none"

        if confidence >= 0.80:
            return "high"

        if confidence >= 0.60:
            return "medium"

        return "low"