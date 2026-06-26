"""
IntelliSight Flask Backend
==========================
AI-Assisted Anomaly Detection System for Public Safety

This module serves as the main Flask application providing:
- Authentication (JWT-based)
- Video upload & classification (ViT + I3D/R3D Fusion)
- Live stream anomaly detection with continuous monitoring
- Alert generation & management
- PDF report generation
- Real-time classification status endpoint

Production Features:
- Comprehensive error handling with structured logging
- Thread-safe background processing for live streams
- Automatic cleanup of temporary files
- Graceful shutdown handling
- Request validation & sanitization
- Database transaction safety
"""

import os
import sys
import time
import threading
import logging
import traceback
from datetime import datetime, timezone
from io import BytesIO
from typing import Optional, Dict, Any, List, Tuple

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
from models import db, User, Role, UserRole, Video, DetectionEvent, Alert

from ai_services.i3d_service import I3DService
from ai_services.fusion_service import FusionService
from ai_services.video_prediction_service import predict_video_from_frames
from ai_services.preprocessing_service import extract_sampled_rgb_frames

# =============================================================================
# CONFIGURATION & SETUP
# =============================================================================

# Load environment variables from .env file
# This keeps sensitive configuration out of source control
load_dotenv()

# Configure structured logging for production monitoring
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('intellisight.log')
    ]
)
logger = logging.getLogger(__name__)

# Initialize Flask application
app = Flask(__name__)

# =============================================================================
# FLASK CONFIGURATION
# =============================================================================

# Database configuration - PostgreSQL via SQLAlchemy
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# JWT configuration for secure authentication
app.config['JWT_SECRET_KEY'] = os.getenv('JWT_SECRET_KEY')
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = False  # Tokens don't expire (mobile app convenience)
app.config['JWT_TOKEN_LOCATION'] = ['headers']
app.config['JWT_HEADER_NAME'] = 'Authorization'
app.config['JWT_HEADER_TYPE'] = 'Bearer'

# Enable exception propagation for debugging (disable in production)
app.config['PROPAGATE_EXCEPTIONS'] = True

# =============================================================================
# EXTENSIONS INITIALIZATION
# =============================================================================

# Initialize database and migration tools
db.init_app(app)
migrate = Migrate(app, db)

# Initialize JWT manager for authentication
jwt = JWTManager(app)

# Configure CORS to allow frontend (React Native/Expo) to communicate
# In production, restrict origins to your actual frontend domains
CORS(app, resources={
    r"/api/*": {
        "origins": "*",  # TODO: Restrict to your frontend URL in production
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        "allow_headers": ["Authorization", "Content-Type"]
    }
})

# =============================================================================
# PATH CONFIGURATION
# =============================================================================

# Base directory of this application
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Upload folders for videos and live stream clips
app.config['UPLOAD_FOLDER'] = os.path.join(BASE_DIR, 'uploads')
app.config['LIVE_CLIPS_FOLDER'] = os.path.join(BASE_DIR, 'live_clips')

# HLS stream segments directory (from Node.js live server)
HLS_SEGMENTS_DIR = os.path.join(BASE_DIR, "..", "stream_server", "videos", "ipcam")

# Create directories if they don't exist
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(app.config['LIVE_CLIPS_FOLDER'], exist_ok=True)

# =============================================================================
# AI SERVICE INITIALIZATION
# =============================================================================

# Initialize AI services for video classification
# I3DService handles spatial-temporal feature extraction
# FusionService combines ViT and I3D predictions for final result
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

# Anomaly class titles supported by the system
# These match the UCF-Crime dataset classes
ANOMALY_CLASSES = [
    'Abuse', 'Arrest', 'Arson', 'Assault', 'Burglary',
    'Explosion', 'Fighting', 'NormalVideos', 'RoadAccident',
    'Robbery', 'Shooting', 'Shoplifting', 'Stealing', 'Vandalism',
]

# Classes that trigger alerts (exclude NormalVideos)
ALERT_CLASSES = [c for c in ANOMALY_CLASSES if c != 'NormalVideos']

# =============================================================================
# THREAD-SAFE LIVE CLASSIFICATION STATE
# =============================================================================

# Thread lock for safe access to shared classification state
classification_lock = threading.Lock()

# Global state for the latest live classification result
# This is updated by the background processor and read by the API endpoint
latest_live_classification: Dict[str, Any] = {
    "result": "NormalVideos",
    "confidence": 0.0,
    "timestamp": None,
    "alert_required": False,
    "severity": "Low"
}



# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

def get_current_timestamp() -> str:
    """
    Returns ISO-formatted UTC timestamp.

    Returns:
        str: ISO 8601 formatted datetime string
    """
    return datetime.now(timezone.utc).isoformat()





def determine_severity(confidence: float, anomaly_type: str) -> str:
    """
    Determine alert severity based on confidence and anomaly type.

    Args:
        confidence: Prediction confidence (0.0 to 1.0)
        anomaly_type: Classified anomaly type

    Returns:
        str: Severity level - "High", "Medium", or "Low"
    """
    if anomaly_type == "NormalVideos":
        return "Low"
    if confidence >= 0.85:
        return "High"
    elif confidence >= 0.70:
        return "Medium"
    return "Low"


def is_alert_required(anomaly_type: str, confidence: float) -> bool:
    """
    Determine if an alert should be generated for a detection.

    Args:
        anomaly_type: Classified anomaly type
        confidence: Prediction confidence

    Returns:
        bool: True if alert should be generated
    """
    return anomaly_type != "NormalVideos" and confidence >= 0.60


def cleanup_temp_files(directory: str, max_age_hours: int = 24) -> None:
    """
    Clean up temporary files older than specified hours.

    Args:
        directory: Path to directory containing temp files
        max_age_hours: Maximum age in hours before deletion
    """
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
    db.session.rollback()  # Rollback any pending database transactions
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
    """
    Register a new user account.

    Request Body:
        - email (str): User's email address
        - password (str): User's password (will be hashed)
        - full_name (str, optional): User's full name

    Returns:
        201: User created successfully
        400: Missing required fields or email already exists
    """
    try:
        data = request.get_json()

        # Validate request data
        if not data or not isinstance(data, dict):
            return jsonify({
                "success": False,
                "message": "Invalid request body. JSON object expected."
            }), 400

        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        full_name = data.get('full_name', 'Unknown User').strip()

        # Validate required fields
        if not email:
            return jsonify({
                "success": False,
                "message": "Email is required"
            }), 400

        if not password or len(password) < 6:
            return jsonify({
                "success": False,
                "message": "Password must be at least 6 characters"
            }), 400

        # Check if email already exists
        existing_user = User.query.filter_by(email=email).first()
        if existing_user:
            return jsonify({
                "success": False,
                "message": "Email already registered"
            }), 400

        # Hash password with PBKDF2-SHA256
        hashed_password = generate_password_hash(password, method='pbkdf2:sha256')

        # Create new user
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
        return jsonify({
            "success": False,
            "message": "Registration failed. Please try again."
        }), 500


@app.route('/api/auth/login', methods=['POST'])
def login() -> Tuple[Dict[str, Any], int]:
    """
    Authenticate user and return JWT access token.

    Request Body:
        - email (str): User's email address
        - password (str): User's password

    Returns:
        200: Login successful with access token
        401: Invalid credentials
        403: Account deactivated
    """
    try:
        data = request.get_json()

        if not data:
            return jsonify({
                "success": False,
                "message": "Invalid request body"
            }), 400

        email = data.get('email', '').strip().lower()
        password = data.get('password', '')

        if not email or not password:
            return jsonify({
                "success": False,
                "message": "Email and password are required"
            }), 400

        # Find user by email
        user = User.query.filter_by(email=email).first()

        if not user:
            return jsonify({
                "success": False,
                "message": "Invalid email or password"
            }), 401

        # Verify password
        if not check_password_hash(user.password_hash, password):
            logger.warning(f"Failed login attempt for: {email}")
            return jsonify({
                "success": False,
                "message": "Invalid email or password"
            }), 401

        # Check account status
        if user.status != 'active':
            return jsonify({
                "success": False,
                "message": "Account is deactivated. Contact support."
            }), 403

        # Generate JWT token (never expires for mobile app convenience)
        access_token = create_access_token(identity=str(user.user_id))

        logger.info(f"User logged in: {email} (ID: {user.user_id})")

        return jsonify({
            "success": True,
            "access_token": access_token,
            "user": {
                "user_id": user.user_id,
                "email": user.email,
                "full_name": user.full_name
            }
        }), 200

    except Exception as e:
        logger.error(f"Login error: {str(e)}\n{traceback.format_exc()}")
        return jsonify({
            "success": False,
            "message": "Login failed. Please try again."
        }), 500


# =============================================================================
# VIDEO CLASSIFICATION ENDPOINTS
# =============================================================================

@app.route("/api/classify", methods=["POST"])
@jwt_required()
def classify_video() -> Tuple[Dict[str, Any], int]:
    """
    Classify an uploaded video file using ViT + I3D/R3D Fusion.

    This endpoint handles video uploads, runs them through the AI pipeline
    (ViT frame-level + I3D temporal fusion), saves detection results,
    and generates alerts for anomalies.

    Headers:
        Authorization: Bearer <JWT_TOKEN>

    Form Data:
        - video: Video file to classify

    Returns:
        200: Classification successful with results
        400: No video file provided
        500: Classification processing error
    """
    file_path = None
    try:
        # Get authenticated user ID from JWT
        user_id = int(get_jwt_identity())

        # Validate file upload
        if "video" not in request.files:
            return jsonify({
                "success": False,
                "message": "No video file provided"
            }), 400

        file = request.files["video"]

        if file.filename == "":
            return jsonify({
                "success": False,
                "message": "Empty filename"
            }), 400

        # Secure filename to prevent path traversal attacks
        filename = secure_filename(file.filename)
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)

        logger.info(f"Video uploaded: {filename} by user {user_id}")

        # Save video record to database
        video = Video(
            user_id=user_id,
            filename=filename,
            file_path=file_path,
            status="processing"
        )
        db.session.add(video)
        db.session.commit()
        frames = extract_sampled_rgb_frames(file_path, num_frames=32, frame_size=224)

        # Validate AI services are available
        if i3d_service is None or fusion_service is None:
            raise RuntimeError("AI services not initialized")

        # Run ViT prediction (frame-level analysis)
        logger.info(f"Running ViT prediction on {filename}")
        vit_result = predict_video_from_frames(frames, max_frames=32)

        # Run I3D/R3D prediction (temporal analysis)
        logger.info(f"Running I3D prediction on {filename}")
        i3d_result = i3d_service.predict_frames(frames)

        # Fuse predictions for final result
        logger.info(f"Fusing predictions for {filename}")
        fusion_result = fusion_service.fuse_predictions(vit_result, i3d_result)

        final_label = fusion_result["final_label"]
        final_confidence = fusion_result["final_confidence"]
        alert_required = fusion_result["alert_required"]

        # Update video status
        video.status = "processed"

        # Save detection event
        detection = DetectionEvent(
            video_id=video.video_id,
            anomaly_type=final_label,
            confidence=final_confidence
        )
        db.session.add(detection)
        db.session.commit()

        # Generate alert if anomaly detected
        alert_data = None
        if alert_required:
            severity = determine_severity(final_confidence, final_label)

            alert = Alert(
                event_id=detection.event_id,
                message=f"{final_label} detected with confidence {final_confidence:.2%}",
                severity=severity,
                status="New"
            )
            db.session.add(alert)
            db.session.commit()

            alert_data = {
                "alert_id": alert.alert_id,
                "message": alert.message,
                "severity": alert.severity,
                "status": alert.status
            }

            logger.warning(
                f"Alert generated: {final_label} ({final_confidence:.2f}) "
                f"for user {user_id}"
            )

        logger.info(f"Classification complete: {final_label} ({final_confidence:.2f})")

        return jsonify({
            "success": True,
            "message": "Video classified successfully",
            "video_id": video.video_id,
            "detection_id": detection.event_id,
            "final_label": final_label,
            "final_confidence": final_confidence,
            "alert_required": alert_required,
            "vit_prediction": vit_result,
            "i3d_prediction": i3d_result,
            "fusion_result": fusion_result,
            "alert": alert_data
        }), 200

    except Exception as e:
        db.session.rollback()
        logger.error(f"Classification error: {str(e)}\n{traceback.format_exc()}")

        # Update video status to failed if record exists
        try:
            if 'video' in locals():
                video.status = "failed"
                db.session.commit()
        except:
            db.session.rollback()

        return jsonify({
            "success": False,
            "message": "Classification failed",
            "error": str(e) if app.config['DEBUG'] else "Internal processing error"
        }), 500

    finally:
        # Cleanup: Remove uploaded file after processing to save disk space
        # Keep the file if you need it for archives/review
        # if file_path and os.path.exists(file_path):
        #     os.remove(file_path)
        pass


@app.route("/api/classify-live", methods=["POST"])
@jwt_required()
def classify_live_clip() -> Tuple[Dict[str, Any], int]:
    """
    Classify a live stream clip using ViT + I3D/R3D Fusion.

    Similar to classify_video but optimized for live stream clips.
    Does not require a video_id since live streams aren't pre-uploaded.

    Headers:
        Authorization: Bearer <JWT_TOKEN>

    Form Data:
        - video: Live clip file to classify

    Returns:
        200: Classification successful with results and popup data
        400: No clip provided
        500: Classification processing error
    """
    file_path = None
    try:
        user_id = int(get_jwt_identity())

        if "video" not in request.files:
            return jsonify({
                "success": False,
                "message": "No live clip provided"
            }), 400

        file = request.files["video"]
        filename = secure_filename(file.filename or "live_clip.mp4")
        file_path = os.path.join(app.config['LIVE_CLIPS_FOLDER'], filename)
        file.save(file_path)

        logger.info(f"Live clip received from user {user_id}: {filename}")

        # Validate AI services
        if i3d_service is None or fusion_service is None:
            raise RuntimeError("AI services not initialized")

        # Run predictions with optimized parameters for live clips
        frames = extract_sampled_rgb_frames(file_path, num_frames=32, frame_size=224)

        vit_result = predict_video_from_frames(frames, max_frames=16)
        i3d_result = i3d_service.predict_frames(frames)
        fusion_result = fusion_service.fuse_predictions(vit_result, i3d_result)

        final_label = fusion_result["final_label"]
        final_confidence = fusion_result["final_confidence"]
        alert_required = fusion_result["alert_required"]

        # Save detection event (no video_id for live streams)
        detection = DetectionEvent(
            video_id=None,
            anomaly_type=final_label,
            confidence=final_confidence
        )
        db.session.add(detection)
        db.session.commit()

        # Generate alert and determine severity
        alert_data = None
        severity = "Low"

        if alert_required:
            severity = determine_severity(final_confidence, final_label)

            alert = Alert(
                event_id=detection.event_id,
                message=f"Live stream alert: {final_label} detected",
                severity=severity,
                status="New"
            )
            db.session.add(alert)
            db.session.commit()

            alert_data = {
                "alert_id": alert.alert_id,
                "message": alert.message,
                "severity": alert.severity,
                "status": alert.status
            }

        # Build response with popup-ready data
        response_data = {
            "success": True,
            "message": "Live clip classified successfully",
            "final_label": final_label,
            "final_confidence": final_confidence,
            "alert_required": alert_required,
            "severity": severity,
            "timestamp": get_current_timestamp(),
            "detection_id": detection.event_id,
            "vit_prediction": vit_result,
            "i3d_prediction": i3d_result,
            "fusion_result": fusion_result,
            "alert": alert_data,
            # Popup-specific fields for frontend
            "popup_data": {
                "title": "Detection Result",
                "label": final_label,
                "confidence_percent": round(final_confidence * 100, 2),
                "is_anomaly": final_label != "NormalVideos",
                "severity": severity,
                "timestamp": get_current_timestamp(),
                "message": f"{final_label} detected with {final_confidence:.1%} confidence"
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
            "error": str(e) if app.config['DEBUG'] else "Internal processing error"
        }), 500

    finally:
        # Cleanup live clip after processing
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
    Get the latest live classification result.

    This endpoint returns the most recent anomaly detection from the
    background HLS processor. It's polled by the frontend to show
    real-time detection status.

    The JWT is optional here - if provided, user-specific context
    can be added. If not provided, generic status is returned.

    Returns:
        200: Current classification status with popup-ready data
    """
    try:
        # Thread-safe read of latest classification
        with classification_lock:
            current = latest_live_classification.copy()

        # Determine if this is a new/high-priority alert
        is_high_alert = (
            current.get('alert_required', False) and 
            current.get('severity') == 'High'
        )

        response = {
            "success": True,
            "data": {
                "result": current.get('result', 'NormalVideos'),
                "confidence": current.get('confidence', 0.0),
                "timestamp": current.get('timestamp'),
                "alert_required": current.get('alert_required', False),
                "severity": current.get('severity', 'Low'),
                "is_high_alert": is_high_alert
            },
            # Popup data for immediate frontend display
            "popup_data": {
                "show_popup": current.get('alert_required', False),
                "title": "Anomaly Detected!" if is_high_alert else "Detection Alert",
                "label": current.get('result', 'NormalVideos'),
                "confidence_percent": round(current.get('confidence', 0.0) * 100, 2),
                "severity": current.get('severity', 'Low'),
                "timestamp": current.get('timestamp'),
                "beep_required": is_high_alert,
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
    """
    Get historical live classification results from database.

    Returns detection events that originated from live streams
    (where video_id is NULL).

    Headers:
        Authorization: Bearer <JWT_TOKEN>

    Returns:
        200: List of live detection events
    """
    try:
        user_id = int(get_jwt_identity())

        # Get live detections (video_id is None for live streams)
        detections = DetectionEvent.query.filter_by(video_id=None)\
            .order_by(DetectionEvent.detected_at.desc())\
            .limit(50)\
            .all()

        result = []
        for event in detections:
            # Get associated alert if any
            alert = Alert.query.filter_by(event_id=event.event_id).first()

            result.append({
                "event_id": event.event_id,
                "anomaly_type": event.anomaly_type,
                "confidence": event.confidence,
                "detected_at": event.detected_at.isoformat() if event.detected_at else None,
                "alert": {
                    "severity": alert.severity,
                    "status": alert.status,
                    "message": alert.message
                } if alert else None
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


# =============================================================================
# ALERT MANAGEMENT ENDPOINTS
# =============================================================================

@app.route('/api/alerts', methods=['GET'])
@jwt_required()
def get_alerts() -> Tuple[Dict[str, Any], int]:
    """
    Get all active alerts for the authenticated user.

    Headers:
        Authorization: Bearer <JWT_TOKEN>

    Returns:
        200: List of alerts with detection details
    """
    try:
        user_id = int(get_jwt_identity())

        alerts = db.session.query(Alert, DetectionEvent, Video)\
            .join(DetectionEvent, Alert.event_id == DetectionEvent.event_id)\
            .join(Video, DetectionEvent.video_id == Video.video_id)\
            .filter(Video.user_id == user_id)\
            .order_by(Alert.created_at.desc())\
            .all()

        result = []
        for alert, event, video in alerts:
            result.append({
                "alert_id": alert.alert_id,
                "filename": video.filename if video else "Live Stream",
                "message": alert.message,
                "severity": alert.severity,
                "status": alert.status,
                "anomaly_type": event.anomaly_type,
                "confidence": event.confidence,
                "created_at": alert.created_at.isoformat() if alert.created_at else None
            })

        return jsonify({
            "success": True,
            "count": len(result),
            "data": result
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
    """
    Get archived/reviewed alerts for the authenticated user.

    Returns:
        200: List of archived alerts
    """
    try:
        user_id = int(get_jwt_identity())

        alerts = db.session.query(Alert, DetectionEvent, Video)\
            .join(DetectionEvent, Alert.event_id == DetectionEvent.event_id)\
            .join(Video, DetectionEvent.video_id == Video.video_id)\
            .filter(Video.user_id == user_id)\
            .filter(Alert.status.in_(["archived", "reviewed"]))\
            .order_by(Alert.created_at.desc())\
            .all()

        result = []
        for alert, event, video in alerts:
            result.append({
                "alert_id": alert.alert_id,
                "filename": video.filename if video else "Live Stream",
                "message": alert.message,
                "severity": alert.severity,
                "status": alert.status,
                "anomaly_type": event.anomaly_type,
                "confidence": event.confidence,
                "created_at": alert.created_at.isoformat() if alert.created_at else None
            })

        return jsonify({
            "success": True,
            "count": len(result),
            "data": result
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
    """
    Mark an alert as reviewed.

    Args:
        alert_id: ID of the alert to review

    Returns:
        200: Alert reviewed successfully
        404: Alert not found or unauthorized
    """
    try:
        user_id = int(get_jwt_identity())

        # Verify alert belongs to user
        alert_data = db.session.query(Alert, DetectionEvent, Video)\
            .join(DetectionEvent, Alert.event_id == DetectionEvent.event_id)\
            .join(Video, DetectionEvent.video_id == Video.video_id)\
            .filter(Alert.alert_id == alert_id)\
            .filter(Video.user_id == user_id)\
            .first()

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
            "success": True,
            "message": "Alert reviewed successfully",
            "alert_id": alert.alert_id,
            "status": alert.status
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
    """
    Get all detection events for the authenticated user.

    Returns:
        200: List of detection events
    """
    try:
        user_id = int(get_jwt_identity())

        detections = db.session.query(DetectionEvent, Video)\
            .join(Video, DetectionEvent.video_id == Video.video_id)\
            .filter(Video.user_id == user_id)\
            .order_by(DetectionEvent.detected_at.desc())\
            .all()

        result = []
        for event, video in detections:
            result.append({
                "event_id": event.event_id,
                "filename": video.filename,
                "anomaly_type": event.anomaly_type,
                "confidence": event.confidence,
                "detected_at": event.detected_at.isoformat() if event.detected_at else None
            })

        return jsonify({
            "success": True,
            "count": len(result),
            "data": result
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

@app.route('/api/reports/detections', methods=['GET'])
@jwt_required()
def detection_report() -> Tuple[Dict[str, Any], int]:
    """
    Generate a JSON detection report for the authenticated user.

    Returns:
        200: Detection report with statistics
    """
    try:
        user_id = int(get_jwt_identity())

        detections = db.session.query(DetectionEvent, Video)\
            .join(Video, DetectionEvent.video_id == Video.video_id)\
            .filter(Video.user_id == user_id)\
            .order_by(DetectionEvent.detected_at.desc())\
            .all()

        report = []
        for event, video in detections:
            report.append({
                "event_id": event.event_id,
                "filename": video.filename,
                "file_path": video.file_path,
                "status": video.status,
                "anomaly_type": event.anomaly_type,
                "confidence": round(float(event.confidence) * 100, 2),
                "detected_at": event.detected_at.isoformat() if event.detected_at else None,
                "frame_time": event.frame_time
            })

        return jsonify({
            "success": True,
            "report_title": "IntelliSight Detection Report",
            "total_events": len(report),
            "generated_at": get_current_timestamp(),
            "data": report
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
    """
    Generate a PDF detection report for the authenticated user.

    Returns:
        200: PDF file download
    """
    try:
        user_id = int(get_jwt_identity())

        detections = db.session.query(DetectionEvent, Video)\
            .join(Video, DetectionEvent.video_id == Video.video_id)\
            .filter(Video.user_id == user_id)\
            .order_by(DetectionEvent.detected_at.desc())\
            .all()

        # Create PDF in memory
        buffer = BytesIO()
        pdf = canvas.Canvas(buffer, pagesize=letter)

        width, height = letter
        y = height - 50

        # Header
        pdf.setFont("Helvetica-Bold", 18)
        pdf.drawString(50, y, "IntelliSight Detection Report")
        y -= 30

        pdf.setFont("Helvetica", 10)
        pdf.drawString(50, y, f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        y -= 20
        pdf.drawString(50, y, f"Total Events: {len(detections)}")
        y -= 30

        # Detection entries
        for event, video in detections:
            # Page break if needed
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


# =============================================================================
# SYSTEM ENDPOINTS
# =============================================================================

@app.route('/health', methods=['GET'])
def health_check() -> Tuple[Dict[str, Any], int]:
    """
    Health check endpoint for monitoring.

    Returns:
        200: System status and component health
    """
    health_status = {
        "status": "healthy",
        "timestamp": get_current_timestamp(),
        "services": {
            "database": "unknown",
            "ai_vit": "unknown",
            "ai_i3d": "unknown",
            "ai_fusion": "unknown"
        }
    }

    # Check database connectivity
    try:
        from sqlalchemy import text
        db.session.execute(text("SELECT 1"))
        health_status["services"]["database"] = "healthy"
    except Exception as e:
        health_status["services"]["database"] = f"unhealthy: {str(e)}"
        health_status["status"] = "degraded"

    # Check AI services
    health_status["services"]["ai_i3d"] = "healthy" if i3d_service else "unavailable"
    health_status["services"]["ai_fusion"] = "healthy" if fusion_service else "unavailable"
    health_status["services"]["ai_vit"] = "healthy"  # predict_video is a function

    status_code = 200 if health_status["status"] == "healthy" else 503
    return jsonify(health_status), status_code


@app.route('/api/system/cleanup', methods=['POST'])
@jwt_required()
def trigger_cleanup() -> Tuple[Dict[str, Any], int]:
    """
    Trigger manual cleanup of temporary files.

    Returns:
        200: Cleanup status
    """
    try:
        cleanup_temp_files(app.config['UPLOAD_FOLDER'], max_age_hours=24)
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
    """
    Serve the React frontend build files.

    In production, this serves the built React application.
    """
    if path and os.path.exists(os.path.join("frontend/build", path)):
        return send_from_directory('frontend/build', path)
    return send_from_directory('frontend/build', 'index.html')


# =============================================================================
# APPLICATION ENTRY POINT
# =============================================================================

if __name__ == '__main__':
    # Development server - DO NOT USE IN PRODUCTION
    # Use gunicorn or uwsgi for production deployment
    app.run(host='0.0.0.0', port=5000, debug=True)