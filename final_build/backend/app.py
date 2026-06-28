"""
IntelliSight Flask Backend
==========================
AI-Assisted Anomaly Detection System for Public Safety

Production-ready with comprehensive error handling, structured logging,
thread-safe background processing, and graceful shutdown support.
"""

import os
os.environ["OPENCV_FFMPEG_LOGLEVEL"] = "quiet"
import sys
import time
import threading
import logging
import traceback
from datetime import datetime, timezone, timedelta
from io import BytesIO
from typing import Optional, Dict, Any, List, Tuple
from collections import deque


# Third-party imports
import cv2
import numpy as np
from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
from flask_migrate import Migrate
from flask_jwt_extended import (
    JWTManager, create_access_token, jwt_required,
    get_jwt_identity, verify_jwt_in_request
)
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash
from dotenv import load_dotenv
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

# Local imports
from models import (
    db, User, Role, UserRole, Video, DetectionEvent, Alert,
    VideoAnomalyTimeline, AlertArchive,
    LiveStreamSession, LiveStreamDetection
)

from ai_services.i3d_service import I3DService
from ai_services.fusion_service import FusionService
from ai_services.video_prediction_service import predict_video_from_frames
from ai_services.preprocessing_service import extract_sampled_rgb_frames

# =============================================================================
# CONFIGURATION & SETUP
# =============================================================================

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('intellisight.log')
    ]
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
current_live_stream_id = None

# =============================================================================
# FLASK CONFIGURATION
# =============================================================================

app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

app.config['JWT_SECRET_KEY'] = os.getenv('JWT_SECRET_KEY')
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = False
app.config['JWT_TOKEN_LOCATION'] = ['headers']
app.config['JWT_HEADER_NAME'] = 'Authorization'
app.config['JWT_HEADER_TYPE'] = 'Bearer'

app.config['PROPAGATE_EXCEPTIONS'] = True

# =============================================================================
# EXTENSIONS INITIALIZATION
# =============================================================================

db.init_app(app)
migrate = Migrate(app, db)
jwt = JWTManager(app)

# Single CORS configuration - covers all /api/* routes
CORS(app, resources={
    r"/api/*": {
        "origins": "*",
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        "allow_headers": ["Authorization", "Content-Type"]
    }
})

# =============================================================================
# PATH CONFIGURATION
# =============================================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app.config['UPLOAD_FOLDER'] = os.path.join(BASE_DIR, 'uploads')
app.config['LIVE_CLIPS_FOLDER'] = os.path.join(BASE_DIR, 'live_clips')
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500MB max upload

HLS_SEGMENTS_DIR = os.path.join(BASE_DIR, "..", "live-server", "videos", "ipcam")

os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(app.config['LIVE_CLIPS_FOLDER'], exist_ok=True)

# =============================================================================
# AI SERVICE INITIALIZATION
# =============================================================================

try:
    i3d_service = I3DService()
    fusion_service = FusionService()
    logger.info("AI services initialized successfully")
except Exception as e:
    logger.error(f"Failed to initialize AI services: {str(e)}")
    i3d_service = None
    fusion_service = None

# =============================================================================
# CLASS DEFINITIONS
# =============================================================================

ANOMALY_CLASSES = [
    'Abuse', 'Arrest', 'Arson', 'Assault', 'Burglary',
    'Explosion', 'Fighting', 'NormalVideos', 'RoadAccident',
    'Robbery', 'Shooting', 'Shoplifting', 'Stealing', 'Vandalism',
]

ALERT_CLASSES = [c for c in ANOMALY_CLASSES if c != 'NormalVideos']

# =============================================================================
# THREAD-SAFE LIVE CLASSIFICATION STATE
# =============================================================================

classification_lock = threading.Lock()

# Holds the most recent classification result — updated by background thread
latest_live_classification: Dict[str, Any] = {
    "result": "NormalVideos",
    "confidence": 0.0,
    "timestamp": None,
    "alert_required": False,
    "severity": "Low"
}

# Live stream temporal state (for smoothing)
live_stream_temporal_state = {
    "recent_labels": deque(maxlen=10),
    "recent_confidences": deque(maxlen=10),
    "smoothed_confidence": 0.0,
    "stable_label": "Normal",
    "alert_cooldowns": {},
    "consecutive_anomaly_count": 0,
    "last_processed_segment": "",
}

# Background analysis thread controls
background_analysis_active: bool = False
background_analysis_thread: Optional[threading.Thread] = None

# Gates the popup so it fires exactly once per unique detection timestamp
last_broadcast_timestamp: Optional[str] = None

# =============================================================================
# BACKGROUND LIVE STREAM ANALYSIS
# =============================================================================

# HLS stream segments written by Node.js/FFmpeg — background thread reads .ts files from here
MIN_SEGMENTS_REQUIRED = 2

# How often (seconds) the background thread runs a new analysis clip
ANALYSIS_INTERVAL_SECONDS = 5

# Frames captured per analysis cycle
FRAMES_TO_SAMPLE = 32

# Temporal smoothing parameters
STABILITY_WINDOW_SIZE = 10
EMA_ALPHA = 0.3
ALERT_COOLDOWN_SECONDS = 15
CONFIDENCE_THRESHOLD = 0.65
STABILITY_THRESHOLD = 0.6

# Adaptive interval bounds
MIN_INTERVAL = 2
MAX_INTERVAL = 10
NORMAL_INTERVAL = 8


def get_latest_ts_segments(count: int = 3) -> List[str]:
    """
    Returns the paths of the most recently modified .ts segment files.
    Node.js writes these to HLS_SEGMENTS_DIR as FFmpeg produces them.
    """
    try:
        seg_dir = os.path.abspath(HLS_SEGMENTS_DIR)
        if not os.path.exists(seg_dir):
            return []

        files = [
            os.path.join(seg_dir, filename)
            for filename in os.listdir(seg_dir)
            if filename.endswith(".ts")
        ]

        files.sort(key=lambda path: os.path.getmtime(path))
        return files[-count:]

    except Exception as e:
        logger.debug(f"[BG-ANALYSIS] Segment read error: {e}")
        return []


def compute_stable_label(recent_labels):
    """
    Returns the most common label in the recent window if it exceeds
    STABILITY_THRESHOLD fraction. Otherwise returns 'Uncertain'.
    """
    if len(recent_labels) < 3:
        return "Normal"

    from collections import Counter
    counts = Counter(recent_labels)
    total = len(recent_labels)
    most_common = counts.most_common(1)[0]
    label, count = most_common

    if count / total >= STABILITY_THRESHOLD:
        return label
    return "Uncertain"


def update_ema_confidence(current_confidence, previous_ema, alpha=EMA_ALPHA):
    """Exponential moving average of confidence scores."""
    if previous_ema == 0.0:
        return current_confidence
    return alpha * current_confidence + (1 - alpha) * previous_ema


def should_trigger_alert(label, smoothed_confidence, cooldowns):
    """
    Determines if an alert should fire based on:
    1. Label is an anomaly (not Normal/Uncertain)
    2. Smoothed confidence >= threshold
    3. Cooldown for this label has expired
    """
    if label in ("Normal", "Uncertain"):
        return False

    if smoothed_confidence < CONFIDENCE_THRESHOLD:
        return False

    now = datetime.now()
    cooldown_key = label
    if cooldown_key in cooldowns:
        if now < cooldowns[cooldown_key]:
            return False

    return True


def set_alert_cooldown(label, cooldowns, cooldown_seconds=ALERT_COOLDOWN_SECONDS):
    """Sets cooldown expiry for a given anomaly label."""
    cooldowns[label] = datetime.now() + timedelta(seconds=cooldown_seconds)


def compute_adaptive_interval(label, smoothed_confidence, stable_label):
    """
    Returns the next sleep interval based on scene state:
    - Faster polling when anomaly is suspected or detected
    - Slower polling when scene is clearly normal
    """
    if stable_label not in ("Normal", "Uncertain") and smoothed_confidence > 0.75:
        return MIN_INTERVAL

    if label not in ("Normal", "Uncertain") or smoothed_confidence > 0.5:
        return ANALYSIS_INTERVAL_SECONDS

    return NORMAL_INTERVAL




def run_background_analysis():
    """
    Production-ready daemon thread for live stream anomaly detection.

    Key improvements over naive single-shot:
    - Temporal smoothing via EMA confidence + label stability window
    - Adaptive sampling interval (saves GPU when scene is calm)
    - Alert cooldowns prevent spam from flickering detections
    - Reads .ts segments directly from disk (already fixed)
    """
    global background_analysis_active

    logger.info("[BG-ANALYSIS] Optimized background analysis thread started")
    logger.info(f"[BG-ANALYSIS] Thread entering loop. Active={background_analysis_active}")
    logger.info(f"[BG-ANALYSIS] AI services: i3d={i3d_service is not None}, fusion={fusion_service is not None}")

    state = live_stream_temporal_state

    while background_analysis_active:
        cycle_start = time.time()
        current_interval = ANALYSIS_INTERVAL_SECONDS

        try:
            if i3d_service is None or fusion_service is None:
                time.sleep(2)
                continue

            segments = get_latest_ts_segments(count=3)

            if len(segments) < MIN_SEGMENTS_REQUIRED:
                logger.info(f"[BG-ANALYSIS] Waiting for segments ({len(segments)} found)...")
                time.sleep(2)
                continue

            newest_segment = segments[-1]
            if newest_segment == state["last_processed_segment"]:
                logger.info("[BG-ANALYSIS] No new segment yet, waiting...")
                time.sleep(2)
                continue

            # Skip segments that previously failed
            if newest_segment in state.get("failed_segments", set()):
                logger.info(f"[BG-ANALYSIS] Skipping previously failed segment: {os.path.basename(newest_segment)}")
                time.sleep(2)
                continue

            state["last_processed_segment"] = newest_segment

            frames_per_segment = max(1, FRAMES_TO_SAMPLE // len(segments))
            frames = []

            for segment_path in segments:
                cap = None
                try:
                    cap = cv2.VideoCapture(segment_path)
                    if not cap.isOpened():
                        logger.warning(f"[BG-ANALYSIS] Cannot open segment: {os.path.basename(segment_path)}")
                        continue

                    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
                    if total_frames <= 0:
                        logger.warning(f"[BG-ANALYSIS] No frames in segment: {os.path.basename(segment_path)}")
                        continue

                    # Sample frames evenly
                    indices = np.linspace(0, total_frames - 1, min(frames_per_segment, total_frames), dtype=int)
                    seg_frames = []

                    for idx in indices:
                        cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
                        ret, frame = cap.read()
                        if not ret or frame is None:
                            continue
                        if frame.shape[0] < 10 or frame.shape[1] < 10:
                            continue  # Skip tiny/corrupted frames

                        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                        frame_resized = cv2.resize(frame_rgb, (224, 224))
                        seg_frames.append(frame_resized)

                    if len(seg_frames) > 0:
                        frames.extend(seg_frames)
                        logger.info(f"[BG-ANALYSIS] Extracted {len(seg_frames)} valid frames from {os.path.basename(segment_path)}")
                    else:
                        logger.warning(f"[BG-ANALYSIS] No valid frames extracted from {os.path.basename(segment_path)}")

                except Exception as extract_err:
                    logger.warning(f"[BG-ANALYSIS] Failed to process segment {os.path.basename(segment_path)}: {extract_err}")
                    continue
                finally:
                    if cap is not None:
                        cap.release()

            if len(frames) < 8:
                logger.info(f"[BG-ANALYSIS] Not enough frames ({len(frames)}), skipping")
                time.sleep(ANALYSIS_INTERVAL_SECONDS)
                continue

            frames_np = np.array(frames, dtype=np.uint8)

            vit_result    = predict_video_from_frames(frames_np, max_frames=16)
            i3d_result    = i3d_service.predict_frames(frames_np)
            fusion_result = fusion_service.fuse_predictions(vit_result, i3d_result)

            raw_label        = fusion_result["final_label"]
            raw_confidence   = fusion_result["final_confidence"]
            raw_alert_req    = fusion_result["alert_required"]
            timestamp        = get_current_timestamp()

            state["recent_labels"].append(raw_label)
            state["recent_confidences"].append(raw_confidence)

            state["smoothed_confidence"] = update_ema_confidence(
                raw_confidence,
                state["smoothed_confidence"]
            )

            stable_label = compute_stable_label(state["recent_labels"])
            state["stable_label"] = stable_label

            if stable_label not in ("Normal", "Uncertain"):
                state["consecutive_anomaly_count"] += 1
            else:
                state["consecutive_anomaly_count"] = 0

            final_label      = stable_label if stable_label != "Uncertain" else raw_label
            final_confidence = state["smoothed_confidence"]
            severity         = determine_severity(final_confidence, final_label)

            alert_required = should_trigger_alert(
                stable_label,
                final_confidence,
                state["alert_cooldowns"]
            )

            if alert_required:
                set_alert_cooldown(stable_label, state["alert_cooldowns"])

            logger.info(
                f"[BG-ANALYSIS] raw={raw_label}({raw_confidence:.2f}) | "
                f"stable={stable_label} | smoothed_conf={final_confidence:.2f} | "
                f"alert={alert_required} | consec_anomaly={state['consecutive_anomaly_count']}"
            )

            with classification_lock:
                latest_live_classification.update({
                    "result":         final_label,
                    "confidence":     round(final_confidence, 3),
                    "timestamp":      timestamp,
                    "alert_required": alert_required,
                    "severity":       severity,
                    "raw_label":      raw_label,
                    "raw_confidence": round(raw_confidence, 3),
                    "stable_label":   stable_label,
                    "consecutive_anomaly_count": state["consecutive_anomaly_count"],
                })

            if alert_required:
                # Live-stream anomalies are saved as child logs under one stream session.
                # We intentionally do NOT create DetectionEvent + Alert here, otherwise
                # the Alerts screen gets many separate live alert cards from one stream.
                with app.app_context():
                    saved_detection = save_live_stream_detection(
                        anomaly_type=final_label,
                        confidence=final_confidence,
                        severity=severity,
                        frame_timestamp=timestamp,
                        consecutive_count=state['consecutive_anomaly_count'],
                    )

                if saved_detection:
                    logger.info(
                        f"[BG-ANALYSIS] LIVE DETECTION SAVED — stream={saved_detection['stream_id']} | "
                        f"{final_label} | {severity} | {timestamp}"
                    )
            else:
                logger.info(f"[BG-ANALYSIS] Normal — {final_label} ({final_confidence:.2f})")

            current_interval = compute_adaptive_interval(
                raw_label,
                final_confidence,
                stable_label
            )

        except Exception as e:
            logger.error(f"[BG-ANALYSIS] Unexpected error: {e}")

        elapsed = time.time() - cycle_start
        sleep_time = max(1, current_interval - elapsed)
        time.sleep(sleep_time)

    logger.info("[BG-ANALYSIS] Background analysis thread stopped")


def start_background_analysis():
    """
    Start the background analysis daemon thread.
    Safe to call multiple times — won't start a second thread if already running.
    """
    global background_analysis_active, background_analysis_thread

    if background_analysis_active:
        logger.info("[BG-ANALYSIS] Already running — skipping start")
        return

    # Start one parent session for this live stream.
    create_live_stream_session()

    background_analysis_active = True
    background_analysis_thread = threading.Thread(
        target=run_background_analysis,
        daemon=True,
        name="LiveStreamAnalysis"
    )
    background_analysis_thread.start()
    logger.info("[BG-ANALYSIS] Thread started")


def stop_background_analysis():
    """
    Stop the background analysis thread and reset all live classification state.
    Called when the stream disconnects.
    """
    global background_analysis_active, background_analysis_thread, last_broadcast_timestamp

    background_analysis_active = False
    last_broadcast_timestamp = None

    # Reset classification state to clean defaults
    with classification_lock:
        latest_live_classification.update({
            "result":         "NormalVideos",
            "confidence":     0.0,
            "timestamp":      None,
            "alert_required": False,
            "severity":       "Low"
        })

    # Reset temporal state
    live_stream_temporal_state["recent_labels"].clear()
    live_stream_temporal_state["recent_confidences"].clear()
    live_stream_temporal_state["smoothed_confidence"] = 0.0
    live_stream_temporal_state["stable_label"] = "Normal"
    live_stream_temporal_state["alert_cooldowns"].clear()
    live_stream_temporal_state["consecutive_anomaly_count"] = 0
    live_stream_temporal_state["last_processed_segment"] = ""

    # Wait briefly for thread to exit cleanly
    if background_analysis_thread and background_analysis_thread.is_alive():
        background_analysis_thread.join(timeout=3)

    background_analysis_thread = None

    # Mark the parent live stream session as completed.
    close_live_stream_session()

    logger.info("[BG-ANALYSIS] Thread stopped and state reset")


# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

def get_current_timestamp() -> str:
    """Returns ISO-formatted UTC timestamp."""
    return datetime.now(timezone.utc).isoformat()


def determine_severity(confidence: float, anomaly_type: str) -> str:
    """
    Determine alert severity based on confidence and anomaly type.
    Returns: "High", "Medium", or "Low"
    """
    if anomaly_type == "NormalVideos":
        return "Low"
    if confidence >= 0.85:
        return "High"
    elif confidence >= 0.70:
        return "Medium"
    return "Low"


def is_alert_required(anomaly_type: str, confidence: float) -> bool:
    """Determine if an alert should be generated for a detection."""
    return anomaly_type != "NormalVideos" and confidence >= 0.60




def create_live_stream_session() -> Optional[int]:
    """
    Create one parent database record for the currently running live stream.
    All live anomalies detected during this stream are saved as child rows in
    LiveStreamDetection instead of creating separate top-level Alert cards.
    """
    global current_live_stream_id

    try:
        # Reuse the current active session if the stream is already running.
        if current_live_stream_id is not None:
            existing = LiveStreamSession.query.get(current_live_stream_id)
            if existing and existing.status == "active" and not existing.is_archived:
                return current_live_stream_id

        stream_session = LiveStreamSession(status="active")
        db.session.add(stream_session)
        db.session.commit()

        current_live_stream_id = stream_session.stream_id
        logger.info(f"[LIVE-SESSION] Started session {current_live_stream_id}")
        return current_live_stream_id

    except Exception as e:
        db.session.rollback()
        logger.error(f"[LIVE-SESSION] Failed to start session: {e}")
        return None


def close_live_stream_session() -> None:
    """Close the active live stream session when live analysis stops."""
    global current_live_stream_id

    if current_live_stream_id is None:
        return

    try:
        stream_session = LiveStreamSession.query.get(current_live_stream_id)
        if stream_session and stream_session.status == "active":
            stream_session.status = "completed"
            stream_session.ended_at = datetime.now(timezone.utc)
            db.session.commit()
            logger.info(f"[LIVE-SESSION] Closed session {current_live_stream_id}")

    except Exception as e:
        db.session.rollback()
        logger.error(f"[LIVE-SESSION] Failed to close session: {e}")

    finally:
        current_live_stream_id = None


def save_live_stream_detection(
    anomaly_type: str,
    confidence: float,
    severity: str,
    frame_timestamp: Optional[str] = None,
    consecutive_count: int = 0,
) -> Optional[Dict[str, Any]]:
    """
    Save every live anomaly with its timestamp under the active stream session.
    Returns plain IDs instead of a SQLAlchemy object to avoid detached-session errors.
    """
    try:
        stream_id = create_live_stream_session()
        if stream_id is None:
            return None

        detection = LiveStreamDetection(
            stream_id=stream_id,
            anomaly_type=anomaly_type,
            confidence=float(confidence),
            severity=severity,
            detected_at=datetime.now(timezone.utc),
            frame_timestamp=frame_timestamp,
        )
        db.session.add(detection)

        stream_session = LiveStreamSession.query.get(stream_id)
        if stream_session:
            stream_session.total_detections = (stream_session.total_detections or 0) + 1

        db.session.commit()

        # Copy IDs immediately after commit and return a plain dict.
        # This prevents SQLAlchemy detached-object errors in the background thread.
        saved_detection_id = detection.detection_id
        saved_stream_id = stream_id

        logger.info(
            f"[LIVE-SESSION] Detection saved under stream {saved_stream_id}: "
            f"{anomaly_type} | {severity} | {confidence:.2f} | consecutive={consecutive_count}"
        )

        return {
            "stream_id": saved_stream_id,
            "detection_id": saved_detection_id,
        }

    except Exception as e:
        db.session.rollback()
        logger.error(f"[LIVE-SESSION] Failed to save detection: {e}")
        return None

def cleanup_temp_files(directory: str, max_age_hours: int = 24) -> None:
    """Clean up temporary files older than specified hours."""
    try:
        current_time = time.time()
        max_age_seconds = max_age_hours * 3600

        for filename in os.listdir(directory):
            file_path = os.path.join(directory, filename)
            if os.path.isfile(file_path):
                file_age = current_time - os.path.getmtime(file_path)
                if file_age > max_age_seconds:
                    os.remove(file_path)
                    logger.info(f"Cleaned up old file: {file_path}")
    except Exception as e:
        logger.error(f"Error during temp file cleanup: {str(e)}")


def get_video_duration(video_path: str) -> float:
    """Get video duration in seconds."""
    try:
        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS)
        frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        cap.release()
        return round(frames / fps, 2) if fps > 0 else 0.0
    except Exception:
        return 0.0


# =============================================================================
# ERROR HANDLERS
# =============================================================================

@app.errorhandler(400)
def bad_request(error):
    """Handle bad request errors."""
    logger.warning(f"Bad request: {str(error)}")
    return jsonify({
        "success": False,
        "error": "Bad request",
        "message": str(error.description) if hasattr(error, 'description') else "Invalid request"
    }), 400


@app.errorhandler(401)
def unauthorized(error):
    """Handle unauthorized access errors."""
    logger.warning(f"Unauthorized access attempt: {str(error)}")
    return jsonify({
        "success": False,
        "error": "Unauthorized",
        "message": "Authentication required. Please log in."
    }), 401


@app.errorhandler(404)
def not_found(error):
    """Handle resource not found errors."""
    return jsonify({
        "success": False,
        "error": "Not found",
        "message": "The requested resource was not found"
    }), 404


@app.errorhandler(500)
def internal_error(error):
    """Handle internal server errors."""
    logger.error(f"Internal server error: {str(error)}\n{traceback.format_exc()}")
    db.session.rollback()
    return jsonify({
        "success": False,
        "error": "Internal server error",
        "message": "An unexpected error occurred. Please try again later."
    }), 500


# =============================================================================
# AUTHENTICATION ENDPOINTS
# =============================================================================

@app.route('/api/auth/register', methods=['POST'])
def register() -> Tuple[Dict[str, Any], int]:
    """Register a new user account."""
    try:
        data = request.get_json()

        if not data or not isinstance(data, dict):
            return jsonify({
                "success": False,
                "message": "Invalid request body. JSON object expected."
            }), 400

        email     = data.get('email', '').strip().lower()
        password  = data.get('password', '')
        full_name = data.get('full_name', 'Unknown User').strip()

        if not email:
            return jsonify({"success": False, "message": "Email is required"}), 400

        if not password or len(password) < 6:
            return jsonify({"success": False, "message": "Password must be at least 6 characters"}), 400

        existing_user = User.query.filter_by(email=email).first()
        if existing_user:
            return jsonify({"success": False, "message": "Email already registered"}), 400

        hashed_password = generate_password_hash(password, method='pbkdf2:sha256')

        new_user = User(
            full_name=full_name,
            email=email,
            password_hash=hashed_password,
            status='active'
        )

        db.session.add(new_user)
        db.session.commit()

        logger.info(f"New user registered: {email}")

        return jsonify({
            "success": True,
            "message": "User created successfully",
            "user_id": new_user.user_id
        }), 201

    except Exception as e:
        db.session.rollback()
        logger.error(f"Registration error: {str(e)}\n{traceback.format_exc()}")
        return jsonify({"success": False, "message": "Registration failed. Please try again."}), 500


@app.route('/api/auth/login', methods=['POST'])
def login() -> Tuple[Dict[str, Any], int]:
    """Authenticate user and return JWT access token."""
    try:
        data = request.get_json()

        if not data:
            return jsonify({"success": False, "message": "Invalid request body"}), 400

        email    = data.get('email', '').strip().lower()
        password = data.get('password', '')

        if not email or not password:
            return jsonify({"success": False, "message": "Email and password are required"}), 400

        user = User.query.filter_by(email=email).first()

        if not user:
            return jsonify({"success": False, "message": "Invalid email or password"}), 401

        if not check_password_hash(user.password_hash, password):
            logger.warning(f"Failed login attempt for: {email}")
            return jsonify({"success": False, "message": "Invalid email or password"}), 401

        if user.status != 'active':
            return jsonify({"success": False, "message": "Account is deactivated. Contact support."}), 403

        access_token = create_access_token(identity=str(user.user_id))

        logger.info(f"User logged in: {email} (ID: {user.user_id})")

        return jsonify({
            "success": True,
            "access_token": access_token,
            "user": {
                "user_id":   user.user_id,
                "email":     user.email,
                "full_name": user.full_name
            }
        }), 200

    except Exception as e:
        logger.error(f"Login error: {str(e)}\n{traceback.format_exc()}")
        return jsonify({"success": False, "message": "Login failed. Please try again."}), 500


# =============================================================================
# VIDEO CLASSIFICATION ENDPOINTS
# =============================================================================

@app.route("/api/classify", methods=["POST"])
@jwt_required()
def classify_video() -> Tuple[Dict[str, Any], int]:
    """
    Classify uploaded video with segment-wise timeline detection.
    Creates DetectionEvent and linked Alerts for proper database relations.
    """
    file_path = None
    try:
        user_id = int(get_jwt_identity())

        if "video" not in request.files:
            return jsonify({"success": False, "message": "No video file provided"}), 400

        file = request.files["video"]
        if file.filename == "":
            return jsonify({"success": False, "message": "Empty filename"}), 400

        filename  = secure_filename(file.filename)
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)

        logger.info(f"Video uploaded: {filename} by user {user_id}")

        # Save video record
        video = Video(
            user_id=user_id,
            filename=filename,
            file_path=file_path,
            status="processing"
        )
        db.session.add(video)
        db.session.commit()

        # ── Segment-wise timeline prediction ─────────────────────────────
        logger.info(f"[Timeline] Starting segment analysis for {filename}")

        from ai_services.video_segment_service import predict_video_timeline

        timeline = predict_video_timeline(
            file_path,
            segment_duration=5.0,
            overlap=2.0,
            temp_dir=os.path.join(BASE_DIR, 'temp_segments')
        )

        # Save timeline records to database
        timeline_records = []
        for item in timeline:
            record = VideoAnomalyTimeline(
                video_id=video.video_id,
                anomaly_type=item['anomaly_type'],
                confidence=item['confidence'],
                start_time=item['start_time'],
                end_time=item['end_time'],
                detected_at=datetime.now(timezone.utc)
            )
            db.session.add(record)
            timeline_records.append(record)

        db.session.commit()
        logger.info(f"[Timeline] Saved {len(timeline_records)} anomaly records for video {video.video_id}")

        # Create DetectionEvent to link alerts to video
        detection = DetectionEvent(
            video_id=video.video_id,
            anomaly_type="Multiple Anomalies" if timeline else "NormalVideos",
            confidence=max([t['confidence'] for t in timeline]) if timeline else 0.0
        )
        db.session.add(detection)
        db.session.commit()
        logger.info(f"[Detection] Created DetectionEvent {detection.event_id} for video {video.video_id}")

        # Create alerts per anomaly event — linked to DetectionEvent
        alerts = []
        for item in timeline:
            severity = determine_severity(item['confidence'], item['anomaly_type'])
            alert = Alert(
                event_id=detection.event_id,
                message=(
                    f"{item['anomaly_type']} detected from "
                    f"{item['start_time']:.1f}s to {item['end_time']:.1f}s "
                    f"(confidence: {item['confidence']:.2%})"
                ),
                severity=severity,
                status="New"
            )
            db.session.add(alert)
            alerts.append(alert)

        db.session.commit()
        logger.info(f"[Alerts] Created {len(alerts)} alerts for video {video.video_id}")

        # Update video status
        video.status = "processed"
        db.session.commit()

        # ── Compute overall result from timeline data ──────────────────────
        if timeline:
            highest          = max(timeline, key=lambda x: x['confidence'])
            final_label      = highest['anomaly_type']
            final_confidence = highest['confidence']
            alert_required   = True
        else:
            from ai_services.video_prediction_service import predict_video
            full_result      = predict_video(file_path, frame_skip=5, max_frames=32)
            final_label      = full_result['label']
            final_confidence = full_result['confidence']
            alert_required   = final_label != 'NormalVideos'

        # Build summary
        total_duration   = sum(t['end_time'] - t['start_time'] for t in timeline)
        highest_severity = max(
            [determine_severity(t['confidence'], t['anomaly_type']) for t in timeline],
            key=lambda s: {"Low": 0, "Medium": 1, "High": 2}.get(s, 0)
        ) if timeline else "Low"

        return jsonify({
            "success":          True,
            "message":          "Video classified with timeline",
            "video_id":         video.video_id,
            "final_label":      final_label,
            "final_confidence": final_confidence,
            "alert_required":   alert_required,
            "timeline":         [t.to_dict() for t in timeline_records],
            "alerts": [{
                "alert_id": a.alert_id,
                "message":  a.message,
                "severity": a.severity,
                "status":   a.status
            } for a in alerts],
            "summary": {
                "total_anomalies":        len(timeline),
                "total_anomaly_duration": round(total_duration, 2),
                "highest_severity":       highest_severity,
                "video_duration":         get_video_duration(file_path)
            }
        }), 200

    except Exception as e:
        db.session.rollback()
        logger.error(f"Classification error: {str(e)}\n{traceback.format_exc()}")
        try:
            if 'video' in locals():
                video.status = "failed"
                db.session.commit()
        except Exception:
            db.session.rollback()
        return jsonify({
            "success": False,
            "message": "Classification failed",
            "error":   str(e) if app.config.get('DEBUG', False) else "Internal processing error"
        }), 500


@app.route('/api/videos/<int:video_id>/timeline/summary', methods=['GET'])
@jwt_required()
def get_video_timeline_summary(video_id):
    """Get summary statistics for video timeline."""
    try:
        user_id = int(get_jwt_identity())
        video   = Video.query.filter_by(video_id=video_id, user_id=user_id).first()
        if not video:
            return jsonify({"success": False, "message": "Video not found"}), 404

        timeline = VideoAnomalyTimeline.query.filter_by(video_id=video_id).all()

        anomaly_types      = {}
        total_duration     = 0
        highest_confidence = 0
        highest_severity   = "Low"

        for t in timeline:
            anomaly_types[t.anomaly_type] = anomaly_types.get(t.anomaly_type, 0) + 1
            total_duration += (t.end_time - t.start_time)
            if t.confidence > highest_confidence:
                highest_confidence = t.confidence
                highest_severity   = determine_severity(t.confidence, t.anomaly_type)

        return jsonify({
            "success":  True,
            "video_id": video_id,
            "summary": {
                "total_anomalies":        len(timeline),
                "unique_types":           len(anomaly_types),
                "anomaly_breakdown":      anomaly_types,
                "total_anomaly_duration": round(total_duration, 2),
                "highest_confidence":     round(highest_confidence, 4),
                "highest_severity":       highest_severity,
            }
        }), 200

    except Exception as e:
        logger.error(f"Summary error: {e}")
        return jsonify({"success": False, "message": "Failed to fetch summary"}), 500


@app.route("/api/classify-live", methods=["POST"])
@jwt_required()
def classify_live_clip() -> Tuple[Dict[str, Any], int]:
    """
    Classify a manually uploaded live stream clip using ViT + I3D/R3D Fusion.
    Also updates latest_live_classification for real-time polling.
    Note: Automatic classification is handled by the background thread.
    This endpoint is kept for manual/triggered clip uploads.
    """
    file_path = None
    try:
        user_id = int(get_jwt_identity())

        if "video" not in request.files:
            return jsonify({"success": False, "message": "No live clip provided"}), 400

        file      = request.files["video"]
        filename  = secure_filename(file.filename or "live_clip.mp4")
        file_path = os.path.join(app.config['LIVE_CLIPS_FOLDER'], filename)
        file.save(file_path)

        logger.info(f"Live clip received from user {user_id}: {filename}")

        if i3d_service is None or fusion_service is None:
            raise RuntimeError("AI services not initialized")

        # ── Run predictions ───────────────────────────────────────────────
        frames        = extract_sampled_rgb_frames(file_path, num_frames=32, frame_size=224)
        vit_result    = predict_video_from_frames(frames, max_frames=16)
        i3d_result    = i3d_service.predict_frames(frames)
        fusion_result = fusion_service.fuse_predictions(vit_result, i3d_result)

        final_label      = fusion_result["final_label"]
        final_confidence = fusion_result["final_confidence"]
        alert_required   = fusion_result["alert_required"]

        # Manual live clips also belong to the current live stream session.
        # Save the anomaly timestamp as a child detection, not as a separate Alert card.
        live_detection = None
        alert_data = None
        severity   = "Low"

        if alert_required:
            severity = determine_severity(final_confidence, final_label)
            live_detection = save_live_stream_detection(
                anomaly_type=final_label,
                confidence=final_confidence,
                severity=severity,
                frame_timestamp=get_current_timestamp(),
            )

            if live_detection:
                alert_data = {
                    "stream_id": live_detection["stream_id"],
                    "detection_id": live_detection["detection_id"],
                    "message": f"Live stream alert: {final_label} detected",
                    "severity": severity,
                    "status": "logged"
                }

        # Update shared classification state for polling
        with classification_lock:
            latest_live_classification.update({
                "result":         final_label,
                "confidence":     final_confidence,
                "timestamp":      get_current_timestamp(),
                "alert_required": alert_required,
                "severity":       severity
            })

        response_data = {
            "success":          True,
            "message":          "Live clip classified successfully",
            "final_label":      final_label,
            "final_confidence": final_confidence,
            "alert_required":   alert_required,
            "severity":         severity,
            "timestamp":        get_current_timestamp(),
            "detection_id":     live_detection["detection_id"] if live_detection else None,
            "stream_id":        live_detection["stream_id"] if live_detection else current_live_stream_id,
            "vit_prediction":   vit_result,
            "i3d_prediction":   i3d_result,
            "fusion_result":    fusion_result,
            "alert":            alert_data,
            "popup_data": {
                "title":              "Detection Result",
                "label":              final_label,
                "confidence_percent": round(final_confidence * 100, 2),
                "is_anomaly":         final_label != "NormalVideos",
                "severity":           severity,
                "timestamp":          get_current_timestamp(),
                "message":            f"{final_label} detected with {final_confidence:.1%} confidence"
            }
        }

        logger.info(f"Live classification complete: {final_label} ({final_confidence:.2f})")
        return jsonify(response_data), 200

    except Exception as e:
        db.session.rollback()
        logger.error(f"Live classification error: {str(e)}\n{traceback.format_exc()}")
        return jsonify({
            "success": False,
            "message": "Live classification failed",
            "error":   str(e) if app.config.get('DEBUG', False) else "Internal processing error"
        }), 500

    finally:
        # Always clean up the uploaded clip
        if file_path and os.path.exists(file_path):
            try:
                os.remove(file_path)
                logger.debug(f"Cleaned up live clip: {file_path}")
            except Exception as e:
                logger.warning(f"Failed to cleanup live clip: {str(e)}")


# =============================================================================
# LIVE CLASSIFICATION STATUS ENDPOINTS
# =============================================================================

@app.route("/api/live-classification", methods=["GET"])
@jwt_required(optional=True)
def get_live_classification() -> Tuple[Dict[str, Any], int]:
    """
    Poll endpoint for the React frontend — returns the latest classification result.

    popup_data.show_popup is True only ONCE per unique detection timestamp,
    so the frontend alert popup fires exactly once per anomaly event, not
    on every poll cycle.
    """
    global last_broadcast_timestamp

    try:
        # Thread-safe read of latest classification
        with classification_lock:
            current = latest_live_classification.copy()

        is_high_alert  = current.get('alert_required', False) and current.get('severity') == 'High'
        alert_required = current.get('alert_required', False)
        current_ts     = current.get('timestamp')

        # show_popup fires only once per unique timestamp (not every 3s poll)
        show_popup = (
            alert_required and
            current_ts is not None and
            current_ts != last_broadcast_timestamp
        )

        # Lock this timestamp so subsequent polls don't re-trigger the popup
        if show_popup:
            last_broadcast_timestamp = current_ts

        response = {
            "success": True,
            "data": {
                "result":         current.get('result', 'NormalVideos'),
                "confidence":     current.get('confidence', 0.0),
                "timestamp":      current_ts,
                "alert_required": alert_required,
                "severity":       current.get('severity', 'Low'),
                "is_high_alert":  is_high_alert,
                "stable_label":   current.get('stable_label', 'Normal'),
                "raw_label":      current.get('raw_label', 'NormalVideos'),
                "raw_confidence": current.get('raw_confidence', 0.0),
                "consecutive_anomaly_count": current.get('consecutive_anomaly_count', 0),
            },
            "popup_data": {
                "show_popup":         show_popup,
                "title":              "⚠️ HIGH ALERT" if is_high_alert else "Anomaly Detected",
                "label":              current.get('result', 'NormalVideos'),
                "confidence_percent": round(current.get('confidence', 0.0) * 100, 2),
                "severity":           current.get('severity', 'Low'),
                "timestamp":          current_ts,
                "beep_required":      is_high_alert and show_popup,
                "message": (
                    f"{current.get('result', 'Unknown')} detected "
                    f"with {current.get('confidence', 0.0):.1%} confidence"
                )
            }
        }

        return jsonify(response), 200

    except Exception as e:
        logger.error(f"Live classification fetch error: {str(e)}")
        return jsonify({
            "success": False,
            "message": "Failed to fetch live classification"
        }), 500


@app.route("/api/live-classification/history", methods=["GET"])
@jwt_required()
def get_live_classification_history() -> Tuple[Dict[str, Any], int]:
    """Get recent live-stream detections saved under stream sessions."""
    try:
        detections = (
            db.session.query(LiveStreamDetection, LiveStreamSession)
            .join(LiveStreamSession, LiveStreamDetection.stream_id == LiveStreamSession.stream_id)
            .order_by(LiveStreamDetection.detected_at.desc())
            .limit(50)
            .all()
        )

        result = []
        for detection, stream_session in detections:
            result.append({
                "detection_id": detection.detection_id,
                "stream_id": detection.stream_id,
                "anomaly_type": detection.anomaly_type,
                "confidence": detection.confidence,
                "severity": detection.severity,
                "detected_at": detection.detected_at.isoformat() if detection.detected_at else None,
                "frame_timestamp": detection.frame_timestamp,
                "stream_status": stream_session.status,
            })

        return jsonify({
            "success": True,
            "count": len(result),
            "data": result
        }), 200

    except Exception as e:
        logger.error(f"Live history fetch error: {str(e)}")
        return jsonify({
            "success": False,
            "message": "Failed to fetch live classification history"
        }), 500


@app.route("/api/live/sessions", methods=["GET"])
@jwt_required()
def get_live_sessions() -> Tuple[Dict[str, Any], int]:
    """
    Return one card-level record per live stream.
    Frontend should show these as stream cards, then open detections inside them.
    """
    try:
        sessions = (
            LiveStreamSession.query
            .filter(LiveStreamSession.is_archived == False)
            .order_by(LiveStreamSession.started_at.desc())
            .all()
        )

        result = []
        for session in sessions:
            result.append({
                "stream_id": session.stream_id,
                "source": "stream_session",
                "source_label": "STREAM",
                "title": "Live Stream Session",
                "started_at": session.started_at.isoformat() if session.started_at else None,
                "ended_at": session.ended_at.isoformat() if session.ended_at else None,
                "status": session.status,
                "total_detections": session.total_detections or 0,
                "is_archived": session.is_archived,
            })

        return jsonify({
            "success": True,
            "count": len(result),
            "data": result
        }), 200

    except Exception as e:
        logger.error(f"Get live sessions error: {str(e)}")
        return jsonify({
            "success": False,
            "message": "Failed to retrieve live stream sessions"
        }), 500


@app.route("/api/live/sessions/<int:stream_id>/detections", methods=["GET"])
@jwt_required()
def get_live_session_detections(stream_id: int) -> Tuple[Dict[str, Any], int]:
    """Return all timestamped anomaly detections inside one live stream session."""
    try:
        stream_session = LiveStreamSession.query.get(stream_id)
        if not stream_session:
            return jsonify({"success": False, "message": "Live stream session not found"}), 404

        detections = (
            LiveStreamDetection.query
            .filter_by(stream_id=stream_id)
            .order_by(LiveStreamDetection.detected_at.asc())
            .all()
        )

        result = []
        for detection in detections:
            result.append({
                "detection_id": detection.detection_id,
                "stream_id": detection.stream_id,
                "anomaly_type": detection.anomaly_type,
                "confidence": detection.confidence,
                "severity": detection.severity,
                "detected_at": detection.detected_at.isoformat() if detection.detected_at else None,
                "frame_timestamp": detection.frame_timestamp,
            })

        return jsonify({
            "success": True,
            "stream": {
                "stream_id": stream_session.stream_id,
                "started_at": stream_session.started_at.isoformat() if stream_session.started_at else None,
                "ended_at": stream_session.ended_at.isoformat() if stream_session.ended_at else None,
                "status": stream_session.status,
                "total_detections": stream_session.total_detections or 0,
            },
            "count": len(result),
            "data": result
        }), 200

    except Exception as e:
        logger.error(f"Get live session detections error: {str(e)}")
        return jsonify({
            "success": False,
            "message": "Failed to retrieve live stream detections"
        }), 500


# =============================================================================
# BACKGROUND ANALYSIS CONTROL ENDPOINTS
# =============================================================================

@app.route("/api/live-analysis/start", methods=["POST"])
@jwt_required(optional=True)
def start_live_analysis() -> Tuple[Dict[str, Any], int]:
    logger.info(f"[LIVE-START] Called. Active={background_analysis_active}, Thread alive={background_analysis_thread.is_alive() if background_analysis_thread else 'None'}")
    """
    Start the background analysis thread.
    Called by the Node.js stream server after FFmpeg starts successfully.
    """
    start_background_analysis()
    return jsonify({
        "success": True,
        "message": "Background analysis started"
    }), 200


@app.route("/api/live-analysis/stop", methods=["POST"])
@jwt_required(optional=True)
def stop_live_analysis() -> Tuple[Dict[str, Any], int]:
    """
    Stop the background analysis thread and reset classification state.
    Called by the Node.js stream server when the stream disconnects.
    """
    stop_background_analysis()
    return jsonify({
        "success": True,
        "message": "Background analysis stopped"
    }), 200


# =============================================================================
# ALERT MANAGEMENT ENDPOINTS
# =============================================================================

@app.route('/api/alerts', methods=['GET'])
@jwt_required()
def get_alerts() -> Tuple[Dict[str, Any], int]:
    """
    Get active manual-upload alerts for the authenticated user.
    Live stream detections are now returned from /api/live/sessions instead.
    """
    try:
        from sqlalchemy import or_

        user_id = int(get_jwt_identity())

        alerts = (
        db.session.query(Alert, DetectionEvent, Video)
        .join(DetectionEvent, Alert.event_id == DetectionEvent.event_id)
        .outerjoin(Video, DetectionEvent.video_id == Video.video_id)
        .filter(Video.user_id == user_id)
        .filter(Alert.status.in_(["New", "active", "unread"]))
        .filter(Alert.is_archived == False)
        .order_by(Alert.created_at.desc())
        .all()
)

        result = []
        for alert, event, video in alerts:
            result.append({
                "alert_id":     alert.alert_id,
                "filename":     video.filename if video else "Live Stream",
                "source":       "manual" if video else "stream",
                "source_label": "MANUAL" if video else "STREAM",
                "message":      alert.message,
                "severity":     alert.severity,
                "status":       alert.status,
                "anomaly_type": event.anomaly_type,
                "confidence":   event.confidence,
                "created_at":   alert.created_at.isoformat() if alert.created_at else None
            })

        return jsonify({
            "success": True,
            "count":   len(result),
            "data":    result
        }), 200

    except Exception as e:
        logger.error(f"Get alerts error: {str(e)}")
        return jsonify({
            "success": False,
            "message": "Failed to retrieve alerts"
        }), 500

@app.route('/api/alerts/archived', methods=['GET'])
@jwt_required()
def get_archived_alerts() -> Tuple[Dict[str, Any], int]:
    """Get archived/reviewed alerts for the authenticated user."""
    try:
        user_id = int(get_jwt_identity())

        alerts = (
            db.session.query(Alert, DetectionEvent, Video)
            .join(DetectionEvent, Alert.event_id == DetectionEvent.event_id)
            .outerjoin(Video, DetectionEvent.video_id == Video.video_id)
            .filter(Video.user_id == user_id)
            .filter(Alert.status.in_(["archived", "reviewed"]))
            .order_by(Alert.created_at.desc())
            .all()
        )

        result = []
        for alert, event, video in alerts:
            result.append({
                "alert_id":     alert.alert_id,
                "filename":     video.filename if video else "Live Stream",
                "message":      alert.message,
                "severity":     alert.severity,
                "status":       alert.status,
                "anomaly_type": event.anomaly_type,
                "confidence":   event.confidence,
                "created_at":   alert.created_at.isoformat() if alert.created_at else None
            })

        return jsonify({
            "success": True,
            "count":   len(result),
            "data":    result
        }), 200

    except Exception as e:
        logger.error(f"Get archived alerts error: {str(e)}")
        return jsonify({
            "success": False,
            "message": "Failed to retrieve archived alerts"
        }), 500


@app.route('/api/alerts/<int:alert_id>/review', methods=['PUT'])
@jwt_required()
def review_alert(alert_id: int) -> Tuple[Dict[str, Any], int]:
    """Mark an alert as reviewed."""
    try:
        user_id = int(get_jwt_identity())

        alert_data = (
            db.session.query(Alert, DetectionEvent, Video)
            .join(DetectionEvent, Alert.event_id == DetectionEvent.event_id)
            .outerjoin(Video, DetectionEvent.video_id == Video.video_id)
            .filter(Alert.alert_id == alert_id)
            .filter(Video.user_id == user_id)
            .first()
        )

        if not alert_data:
            return jsonify({
                "success": False,
                "message": "Alert not found or access denied"
            }), 404

        alert, event, video = alert_data
        alert.status = "reviewed"
        db.session.commit()

        logger.info(f"Alert {alert_id} reviewed by user {user_id}")

        return jsonify({
            "success":  True,
            "message":  "Alert reviewed successfully",
            "alert_id": alert.alert_id,
            "status":   alert.status
        }), 200

    except Exception as e:
        db.session.rollback()
        logger.error(f"Review alert error: {str(e)}")
        return jsonify({
            "success": False,
            "message": "Failed to review alert"
        }), 500


# =============================================================================
# DETECTION ENDPOINTS
# =============================================================================

@app.route('/api/detections', methods=['GET'])
@jwt_required()
def get_detections() -> Tuple[Dict[str, Any], int]:
    """Get all detection events for the authenticated user."""
    try:
        user_id = int(get_jwt_identity())

        detections = (
            db.session.query(DetectionEvent, Video)
            .join(Video, DetectionEvent.video_id == Video.video_id)
            .filter(Video.user_id == user_id)
            .order_by(DetectionEvent.detected_at.desc())
            .all()
        )

        result = []
        for event, video in detections:
            result.append({
                "event_id":     event.event_id,
                "filename":     video.filename,
                "anomaly_type": event.anomaly_type,
                "confidence":   event.confidence,
                "detected_at":  event.detected_at.isoformat() if event.detected_at else None
            })

        return jsonify({
            "success": True,
            "count":   len(result),
            "data":    result
        }), 200

    except Exception as e:
        logger.error(f"Get detections error: {str(e)}")
        return jsonify({
            "success": False,
            "message": "Failed to retrieve detections"
        }), 500


# =============================================================================
# REPORT GENERATION ENDPOINTS
# =============================================================================


@app.route('/api/alerts/archive-today', methods=['POST'])
@jwt_required()
def archive_today_alerts():
    try:
        from sqlalchemy import or_, func
        from datetime import date

        user_id = int(get_jwt_identity())
        today = date.today()

        alerts = (
            db.session.query(Alert, DetectionEvent, Video)
            .join(DetectionEvent, Alert.event_id == DetectionEvent.event_id)
            .outerjoin(Video, DetectionEvent.video_id == Video.video_id)
            .filter(func.date(Alert.created_at) == today)
            .filter(Alert.status.in_(["New", "active", "unread"]))
            .filter(Alert.is_archived == False)
            .filter(Video.user_id == user_id)
            .order_by(Alert.created_at.desc())
            .all()
        )

        live_sessions = (
            LiveStreamSession.query
            .filter(func.date(LiveStreamSession.started_at) == today)
            .filter(LiveStreamSession.is_archived == False)
            .order_by(LiveStreamSession.started_at.desc())
            .all()
        )

        if not alerts and not live_sessions:
            return jsonify({
                "success": False,
                "message": "No active alerts found for today"
            }), 404

        stream_count = 0
        manual_count = 0
        high_count = 0
        medium_count = 0
        low_count = 0

        for alert, event, video in alerts:
            alert.status = "archived"
            alert.is_archived = True

            severity = (alert.severity or "").lower()

            if severity == "high":
                high_count += 1
            elif severity == "medium":
                medium_count += 1
            else:
                low_count += 1

            if video:
                manual_count += 1
            else:
                stream_count += 1

        # Archive live stream sessions as one stream log, while counting every child detection.
        for stream_session in live_sessions:
            stream_session.is_archived = True
            if stream_session.status == "active":
                stream_session.status = "completed"
                stream_session.ended_at = datetime.now(timezone.utc)

            detections = LiveStreamDetection.query.filter_by(stream_id=stream_session.stream_id).all()
            stream_count += len(detections)

            for detection in detections:
                severity = (detection.severity or "").lower()
                if severity == "high":
                    high_count += 1
                elif severity == "medium":
                    medium_count += 1
                else:
                    low_count += 1

        archive = AlertArchive(
            user_id=user_id,
            archive_date=today,
            total_alerts=len(alerts) + stream_count,
            high_count=high_count,
            medium_count=medium_count,
            low_count=low_count,
            stream_alerts=stream_count,
            manual_alerts=manual_count,
            pdf_path=None
        )

        db.session.add(archive)
        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Today logs archived successfully",
            "archive": {
                "archive_id": archive.archive_id,
                "archive_date": archive.archive_date.isoformat(),
                "total_alerts": archive.total_alerts,
                "high_count": archive.high_count,
                "medium_count": archive.medium_count,
                "low_count": archive.low_count,
                "stream_alerts": archive.stream_alerts,
                "manual_alerts": archive.manual_alerts,
                "created_at": archive.created_at.isoformat() if archive.created_at else None
            }
        }), 200

    except Exception as e:
        db.session.rollback()
        logger.error(f"Archive today error: {str(e)}", exc_info=True)
        return jsonify({
            "success": False,
            "message": "Failed to archive today logs",
            "error": str(e)
        }), 500
@app.route('/api/alerts/archives', methods=['GET'])
@jwt_required()
def get_alert_archives():
    try:
        user_id = int(get_jwt_identity())

        archives = (
            AlertArchive.query
            .filter_by(user_id=user_id)
            .order_by(AlertArchive.archive_date.desc())
            .all()
        )

        result = []
        for archive in archives:
            result.append({
                "archive_id": archive.archive_id,
                "archive_date": archive.archive_date.isoformat() if archive.archive_date else None,
                "total_alerts": archive.total_alerts,
                "high_count": archive.high_count,
                "medium_count": archive.medium_count,
                "low_count": archive.low_count,
                "stream_alerts": archive.stream_alerts,
                "manual_alerts": archive.manual_alerts,
                "created_at": archive.created_at.isoformat() if archive.created_at else None
            })

        return jsonify({
            "success": True,
            "count": len(result),
            "data": result
        }), 200

    except Exception as e:
        logger.error(f"Get alert archives error: {str(e)}")
        return jsonify({
            "success": False,
            "message": "Failed to retrieve alert archives"
        }), 500

@app.route('/api/reports/detections', methods=['GET'])
@jwt_required()
def detection_report() -> Tuple[Dict[str, Any], int]:
    """Generate a JSON detection report for the authenticated user."""
    try:
        user_id = int(get_jwt_identity())

        detections = (
            db.session.query(DetectionEvent, Video)
            .join(Video, DetectionEvent.video_id == Video.video_id)
            .filter(Video.user_id == user_id)
            .order_by(DetectionEvent.detected_at.desc())
            .all()
        )

        report = []
        for event, video in detections:
            report.append({
                "event_id":     event.event_id,
                "filename":     video.filename,
                "file_path":    video.file_path,
                "status":       video.status,
                "anomaly_type": event.anomaly_type,
                "confidence":   round(float(event.confidence) * 100, 2),
                "detected_at":  event.detected_at.isoformat() if event.detected_at else None,
                "frame_time":   event.frame_time
            })

        return jsonify({
            "success":       True,
            "report_title":  "IntelliSight Detection Report",
            "total_events":  len(report),
            "generated_at":  get_current_timestamp(),
            "data":          report
        }), 200

    except Exception as e:
        logger.error(f"Detection report error: {str(e)}")
        return jsonify({
            "success": False,
            "message": "Failed to generate detection report"
        }), 500


@app.route('/api/reports/detections/pdf', methods=['GET'])
@jwt_required()
def detection_report_pdf() -> Any:
    """Generate a PDF detection report for the authenticated user."""
    try:
        user_id = int(get_jwt_identity())

        detections = (
            db.session.query(DetectionEvent, Video)
            .join(Video, DetectionEvent.video_id == Video.video_id)
            .filter(Video.user_id == user_id)
            .order_by(DetectionEvent.detected_at.desc())
            .all()
        )

        buffer = BytesIO()
        pdf    = canvas.Canvas(buffer, pagesize=letter)

        width, height = letter
        y = height - 50

        pdf.setFont("Helvetica-Bold", 18)
        pdf.drawString(50, y, "IntelliSight Detection Report")
        y -= 30

        pdf.setFont("Helvetica", 10)
        pdf.drawString(50, y, f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        y -= 20
        pdf.drawString(50, y, f"Total Events: {len(detections)}")
        y -= 30

        for event, video in detections:
            if y < 100:
                pdf.showPage()
                y = height - 50
                pdf.setFont("Helvetica-Bold", 16)
                pdf.drawString(50, y, "IntelliSight Detection Report")
                y -= 30

            pdf.setFont("Helvetica-Bold", 11)
            pdf.drawString(50, y, f"Event ID: {event.event_id}")
            y -= 16

            pdf.setFont("Helvetica", 10)
            pdf.drawString(50, y, f"File: {video.filename}")
            y -= 14
            pdf.drawString(50, y, f"Anomaly Type: {event.anomaly_type}")
            y -= 14
            pdf.drawString(50, y, f"Confidence: {round(float(event.confidence) * 100, 2)}%")
            y -= 14
            pdf.drawString(50, y, f"Detected At: {event.detected_at}")
            y -= 14
            pdf.drawString(50, y, f"Status: {video.status}")
            y -= 25

            pdf.line(50, y, 550, y)
            y -= 20

        pdf.save()
        buffer.seek(0)

        return send_file(
            buffer,
            as_attachment=True,
            download_name=f"intellisight_detection_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf",
            mimetype="application/pdf"
        )

    except Exception as e:
        logger.error(f"PDF report error: {str(e)}\n{traceback.format_exc()}")
        return jsonify({
            "success": False,
            "message": "Failed to generate PDF report"
        }), 500

@app.route('/api/alerts/archive/<int:archive_id>/pdf', methods=['GET'])
@jwt_required()
def download_archive_pdf(archive_id):
    try:
        user_id = int(get_jwt_identity())

        archive = AlertArchive.query.filter_by(
            archive_id=archive_id,
            user_id=user_id
        ).first()

        if not archive:
            return jsonify({
                "success": False,
                "message": "Archive not found"
            }), 404

        buffer = BytesIO()
        pdf = canvas.Canvas(buffer, pagesize=letter)

        width, height = letter
        y = height - 60

        # ===========================
        # HEADER
        # ===========================
        pdf.setTitle("IntelliSight Daily Archive Report")

        pdf.setFont("Helvetica-Bold", 22)
        pdf.drawString(50, y, "IntelliSight")
        y -= 25

        pdf.setFont("Helvetica-Bold", 16)
        pdf.drawString(50, y, "Daily Alert Archive Report")

        y -= 40

        pdf.line(50, y, 550, y)
        y -= 30

        # ===========================
        # REPORT INFORMATION
        # ===========================
        pdf.setFont("Helvetica-Bold", 13)
        pdf.drawString(50, y, "Report Information")

        y -= 25

        pdf.setFont("Helvetica", 11)

        pdf.drawString(70, y, f"Archive Date : {archive.archive_date}")
        y -= 20

        pdf.drawString(
            70,
            y,
            f"Generated On : {datetime.now().strftime('%d-%m-%Y %I:%M:%S %p')}"
        )

        y -= 35

        pdf.line(50, y, 550, y)
        y -= 30

        # ===========================
        # SUMMARY
        # ===========================
        pdf.setFont("Helvetica-Bold", 13)
        pdf.drawString(50, y, "Archive Summary")

        y -= 25

        pdf.setFont("Helvetica", 12)

        summary = [
            ("Total Alerts", archive.total_alerts),
            ("High Severity Alerts", archive.high_count),
            ("Medium Severity Alerts", archive.medium_count),
            ("Low Severity Alerts", archive.low_count),
            ("Live Stream Alerts", archive.stream_alerts),
            ("Manual Upload Alerts", archive.manual_alerts),
        ]

        for label, value in summary:
            pdf.drawString(70, y, f"{label}")
            pdf.drawRightString(500, y, str(value))
            y -= 24

        y -= 10

        pdf.line(50, y, 550, y)

        y -= 35

        # ===========================
        # FOOTER
        # ===========================
        pdf.setFont("Helvetica-Oblique", 10)

        pdf.drawString(
            50,
            y,
            "Generated automatically by IntelliSight AI-Assisted Surveillance System."
        )

        pdf.save()
        buffer.seek(0)

        return send_file(
            buffer,
            as_attachment=True,
            download_name=f"IntelliSight_Archive_{archive.archive_date}.pdf",
            mimetype="application/pdf"
        )

    except Exception as e:
        logger.error(f"Archive PDF error: {str(e)}", exc_info=True)

        return jsonify({
            "success": False,
            "message": "Failed to generate archive PDF",
            "error": str(e)
        }), 500

# =============================================================================
# SYSTEM ENDPOINTS
# =============================================================================

@app.route('/health', methods=['GET'])
def health_check() -> Tuple[Dict[str, Any], int]:
    """Health check endpoint for monitoring."""
    health_status = {
        "status":    "healthy",
        "timestamp": get_current_timestamp(),
        "services": {
            "database":  "unknown",
            "ai_vit":    "unknown",
            "ai_i3d":    "unknown",
            "ai_fusion": "unknown"
        }
    }

    try:
        from sqlalchemy import text
        db.session.execute(text("SELECT 1"))
        health_status["services"]["database"] = "healthy"
    except Exception as e:
        health_status["services"]["database"] = f"unhealthy: {str(e)}"
        health_status["status"] = "degraded"

    health_status["services"]["ai_i3d"]    = "healthy" if i3d_service    else "unavailable"
    health_status["services"]["ai_fusion"] = "healthy" if fusion_service else "unavailable"
    health_status["services"]["ai_vit"]    = "healthy"

    # Include background analysis status
    health_status["background_analysis"] = "running" if background_analysis_active else "stopped"

    status_code = 200 if health_status["status"] == "healthy" else 503
    return jsonify(health_status), status_code


@app.route('/api/system/cleanup', methods=['POST'])
@jwt_required()
def trigger_cleanup() -> Tuple[Dict[str, Any], int]:
    """Trigger manual cleanup of temporary files."""
    try:
        cleanup_temp_files(app.config['UPLOAD_FOLDER'],     max_age_hours=24)
        cleanup_temp_files(app.config['LIVE_CLIPS_FOLDER'], max_age_hours=1)

        return jsonify({
            "success": True,
            "message": "Cleanup completed successfully"
        }), 200

    except Exception as e:
        logger.error(f"Cleanup error: {str(e)}")
        return jsonify({
            "success": False,
            "message": "Cleanup failed"
        }), 500


# =============================================================================
# FRONTEND SERVING (Production)
# =============================================================================

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_frontend(path: str) -> Any:
    """Serve the React frontend build files."""
    if path and os.path.exists(os.path.join("frontend/build", path)):
        return send_from_directory('frontend/build', path)
    return send_from_directory('frontend/build', 'index.html')


# =============================================================================
# APPLICATION ENTRY POINT
# =============================================================================

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)