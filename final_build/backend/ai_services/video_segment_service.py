"""
Segment-wise Video Prediction Service
=======================================
"""

import cv2
import numpy as np
import os
import subprocess
import tempfile
import shutil
from typing import List, Dict, Any

from ai_services.video_prediction_service import predict_video
from ai_services.i3d_service import I3DService
from ai_services.fusion_service import FusionService

i3d_service = I3DService()
fusion_service = FusionService()

ANOMALY_CLASSES = [
    'Abuse', 'Arrest', 'Arson', 'Assault', 'Burglary',
    'Explosion', 'Fighting', 'NormalVideos', 'RoadAccident',
    'Robbery', 'Shooting', 'Shoplifting', 'Stealing', 'Vandalism',
]
NORMAL_CLASS = 'NormalVideos'
ANOMALY_THRESHOLD = 0.60
MERGE_GAP_SECONDS = 3.0


def extract_segment(video_path: str, start_time: float, end_time: float, output_path: str) -> bool:
    try:
        duration = end_time - start_time
        cmd = [
            'ffmpeg', '-y',
            '-ss', str(start_time),
            '-t', str(duration),
            '-i', video_path,
            '-c:v', 'libx264', '-preset', 'fast',
            '-pix_fmt', 'yuv420p',
            '-an', '-threads', '2',
            output_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        
        if result.returncode != 0:
            print(f"[FFmpeg] Error: {result.stderr[:200]}")
            return False
        
        if not os.path.exists(output_path) or os.path.getsize(output_path) < 1000:
            return False
        
        return True
        
    except Exception as e:
        print(f"[Segment Extract] Error: {e}")
        return False


def predict_segment(video_path: str, max_frames: int = 16) -> Dict[str, Any]:
    try:
        vit_result = predict_video(video_path, frame_skip=5, max_frames=max_frames)
        i3d_result = i3d_service.predict_video(video_path, max_frames=32)
        fusion_result = fusion_service.fuse_predictions(vit_result, i3d_result)
        
        return {
            'label': fusion_result['final_label'],
            'confidence': fusion_result['final_confidence'],
            'alert_required': fusion_result['alert_required'],
        }
    except Exception as e:
        print(f"[Segment Predict] Error: {e}")
        import traceback
        traceback.print_exc()
        return {'label': 'Unknown', 'confidence': 0.0, 'alert_required': False}


def predict_video_timeline(video_path: str, segment_duration: float = 5.0, overlap: float = 2.0, temp_dir: str = None) -> List[Dict[str, Any]]:
    # Get video info
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"[Timeline] Cannot open original video: {video_path}")
        return []
    
    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    video_duration = total_frames / fps if fps > 0 else 0
    cap.release()
    
    print(f"[Timeline] Original: {total_frames} frames, {fps:.2f} fps, {video_duration:.2f}s")
    
    if video_duration <= 0:
        return []
    
    # FIX: Create temp directory if provided, or use system temp
    if temp_dir is None:
        temp_dir = tempfile.mkdtemp(prefix="video_segments_")
    else:
        # Ensure the provided directory exists
        os.makedirs(temp_dir, exist_ok=True)
    
    print(f"[Timeline] Using temp dir: {temp_dir}")
    
    segments = []
    step = segment_duration - overlap
    current_start = 0.0
    while current_start < video_duration:
        current_end = min(current_start + segment_duration, video_duration)
        segments.append({'start': current_start, 'end': current_end, 'index': len(segments)})
        current_start += step
    
    print(f"[Timeline] {len(segments)} segments ({segment_duration}s, {overlap}s overlap)")
    
    segment_results = []
    for seg in segments:
        seg_path = os.path.join(temp_dir, f"segment_{seg['index']:04d}.mp4")
        
        if not extract_segment(video_path, seg['start'], seg['end'], seg_path):
            print(f"[Timeline] Failed segment {seg['index']}")
            continue
        
        result = predict_segment(seg_path, max_frames=16)
        result['start_time'] = seg['start']
        result['end_time'] = seg['end']
        segment_results.append(result)
        
        if os.path.exists(seg_path):
            os.remove(seg_path)
        
        print(f"[Timeline] Segment {seg['index']}: {result['label']} ({result['confidence']:.2f}) [{seg['start']:.1f}s-{seg['end']:.1f}s]")
    
    shutil.rmtree(temp_dir, ignore_errors=True)
    
    timeline = merge_anomalies(segment_results)
    print(f"[Timeline] {len(timeline)} anomaly events detected")
    for t in timeline:
        print(f"  -> {t['anomaly_type']}: {t['start_time']:.1f}s-{t['end_time']:.1f}s (conf: {t['confidence']:.2f})")
    
    return timeline


def merge_anomalies(segment_results: List[Dict]) -> List[Dict[str, Any]]:
    abnormal = [r for r in segment_results if r['label'] != NORMAL_CLASS and r['confidence'] >= ANOMALY_THRESHOLD]
    if not abnormal:
        return []
    
    abnormal.sort(key=lambda x: x['start_time'])
    
    groups = []
    current_group = [abnormal[0]]
    
    for seg in abnormal[1:]:
        last = current_group[-1]
        same_type = seg['label'] == last['label']
        gap = seg['start_time'] - last['end_time']
        if same_type and gap <= MERGE_GAP_SECONDS:
            current_group.append(seg)
        else:
            groups.append(current_group)
            current_group = [seg]
    groups.append(current_group)
    
    timeline = []
    for group in groups:
        avg_confidence = sum(r['confidence'] for r in group) / len(group)
        timeline.append({
            'anomaly_type': group[0]['label'],
            'confidence': round(avg_confidence, 4),
            'start_time': group[0]['start_time'],
            'end_time': group[-1]['end_time'],
            'segment_count': len(group),
        })
    
    return timeline


def determine_severity(confidence: float, anomaly_type: str) -> str:
    if anomaly_type == NORMAL_CLASS:
        return "Low"
    if confidence >= 0.85:
        return "High"
    elif confidence >= 0.70:
        return "Medium"
    return "Low"