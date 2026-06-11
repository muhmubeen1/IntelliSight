from flask import Flask, request, jsonify, send_from_directory
from models import db, User, Role, UserRole, Video, DetectionEvent, Alert
import tensorflow as tf
from tensorflow.keras import models
from tensorflow.keras.utils import img_to_array 
from tensorflow.keras.applications.mobilenet_v2 import preprocess_input, MobileNetV2
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import Dense, GlobalAveragePooling2D
import numpy as np
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash
import cv2
import os
import threading
import time
from flask_cors import CORS
from dotenv import load_dotenv
from flask import send_file
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from io import BytesIO


# --- NEW AUTH & DB IMPORTS ---
from flask_migrate import Migrate
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity
from models import db, User, Role, UserRole
from ai_services.ai_pipeline import run_ai_pipeline

# Load environment variables from .env
load_dotenv()

app = Flask(__name__)
CORS(app)
CORS(app, resources={r"/*": {"origins": "*"}})
app.config['PROPAGATE_EXCEPTIONS'] = True

# --- NEW DB & JWT CONFIGURATION ---
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['JWT_SECRET_KEY'] = os.getenv('JWT_SECRET_KEY')

# Initialize DB and Migrate
db.init_app(app)
migrate = Migrate(app, db)
jwt = JWTManager(app)

# Configure upload folder
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app.config['UPLOAD_FOLDER'] = os.path.join(BASE_DIR, 'uploads')
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# Load trained model (Placeholder MobileNetV2)
base_model = MobileNetV2(weights="imagenet", include_top=False, input_shape=(224, 224, 3))
model = Sequential([
    base_model,
    GlobalAveragePooling2D(),
    Dense(1, activation="sigmoid")
])

# Configuration
HLS_SEGMENTS_DIR = os.path.join(BASE_DIR, "..", "stream_server", "videos", "ipcam")
FRAME_PROCESS_INTERVAL = 2  

# Global variables for live classification
latest_classification = {
    'result': 'NormalVideos',
    'confidence': 0.0,
    'timestamp': time.time()
}

class_titles = ['Abuse', 'Arrest', 'Arson', 'Assault', 'Burglary',
                'Explosion', 'Fighting', 'NormalVideos', 'RoadAccident',
                'Robbery', 'Shooting', 'Shoplifting', 'Stealing', 'Vandalism',]

def preprocess_frame(frame):
    frame = cv2.resize(frame, (64, 64)) 
    img_array = img_to_array(frame)
    img_array = np.expand_dims(img_array, axis=0) 
    img_array = preprocess_input(img_array) 
    return img_array

def process_latest_frame():
    try:
        if not os.path.exists(HLS_SEGMENTS_DIR):
            return None
            
        ts_files = [f for f in os.listdir(HLS_SEGMENTS_DIR) if f.endswith('.ts')]
        if not ts_files:
            return None

        latest_ts = max(ts_files, key=lambda x: os.path.getctime(os.path.join(HLS_SEGMENTS_DIR, x)))
        ts_path = os.path.join(HLS_SEGMENTS_DIR, latest_ts)

        cap = cv2.VideoCapture(ts_path)
        last_frame = None
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            last_frame = frame
        cap.release()

        if last_frame is not None:
            processed_frame = preprocess_frame(last_frame)
            prediction = model.predict(processed_frame)
            predicted_class_idx = np.argmax(prediction, axis=1)[0]
            confidence = float(prediction[0][predicted_class_idx])
            
            return {
                'result': class_titles[predicted_class_idx],
                'confidence': confidence,
                'timestamp': time.time()
            }
    except Exception as e:
        print(f"Error processing frame: {str(e)}")
        return None

def background_processor():
    while True:
        try:
            result = process_latest_frame()
            if result:
                global latest_classification
                latest_classification = result
                print(f"New classification: {result['result']} (confidence: {result['confidence']:.2f})")
        except Exception as e:
            print(f"Error in background processor: {str(e)}")
        time.sleep(FRAME_PROCESS_INTERVAL)

# Start background processing thread
processing_thread = threading.Thread(target=background_processor, daemon=True)
processing_thread.start()



# ==========================================
# AUTHENTICATION ENDPOINTS
# ==========================================

@app.route('/api/auth/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data or not data.get('email') or not data.get('password'):
        return jsonify({"msg": "Missing email or password"}), 400

    if User.query.filter_by(email=data.get('email')).first():
        return jsonify({"msg": "Email already exists"}), 400

    hashed_password = generate_password_hash(data.get('password'), method='pbkdf2:sha256')
    
    new_user = User(
        full_name=data.get('full_name', 'Unknown User'),
        email=data.get('email'),
        password_hash=hashed_password
    )
    db.session.add(new_user)
    db.session.commit()
    
    return jsonify({"msg": "User created successfully"}), 201

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json()
    user = User.query.filter_by(email=data.get('email')).first()

    if not user or not check_password_hash(user.password_hash, data.get('password')):
        return jsonify({"msg": "Invalid email or password"}), 401

    if user.status != 'active':
        return jsonify({"msg": "Account is deactivated"}), 403

    access_token = create_access_token(identity=str(user.user_id))
    return jsonify(access_token=access_token), 200

@app.route('/api/alerts/<int:alert_id>/review', methods=['PUT'])
@jwt_required()
def review_alert(alert_id):
    user_id = int(get_jwt_identity())

    alert_data = db.session.query(Alert, DetectionEvent, Video)\
        .join(DetectionEvent, Alert.event_id == DetectionEvent.event_id)\
        .join(Video, DetectionEvent.video_id == Video.video_id)\
        .filter(Alert.alert_id == alert_id)\
        .filter(Video.user_id == user_id)\
        .first()

    if not alert_data:
        return jsonify({"msg": "Alert not found"}), 404

    alert, event, video = alert_data

    alert.status = "reviewed"
    db.session.commit()

    return jsonify({
        "msg": "Alert reviewed successfully",
        "alert_id": alert.alert_id,
        "status": alert.status
    }), 200
    
    
@app.route('/api/reports/detections', methods=['GET'])
@jwt_required()
def detection_report():
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
            "detected_at": event.detected_at.isoformat(),
            "frame_time": event.frame_time
        })

    return jsonify({
        "report_title": "IntelliSight Detection Report",
        "total_events": len(report),
        "data": report
    }), 200

@app.route('/api/reports/detections/pdf', methods=['GET'])
@jwt_required()
def detection_report_pdf():
    user_id = int(get_jwt_identity())

    detections = db.session.query(DetectionEvent, Video)\
        .join(Video, DetectionEvent.video_id == Video.video_id)\
        .filter(Video.user_id == user_id)\
        .order_by(DetectionEvent.detected_at.desc())\
        .all()

    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=letter)

    width, height = letter
    y = height - 50

    pdf.setFont("Helvetica-Bold", 18)
    pdf.drawString(50, y, "IntelliSight Detection Report")

    y -= 30
    pdf.setFont("Helvetica", 10)
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
        download_name="intellisight_detection_report.pdf",
        mimetype="application/pdf"
    )

# ==========================================
# Detection ENDPOINTS
# ==========================================

@app.route('/api/detections', methods=['GET'])
@jwt_required()
def get_detections():
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
            "detected_at": event.detected_at.isoformat()
        })

    return jsonify(result), 200


@app.route('/api/alerts', methods=['GET'])
@jwt_required()
def get_alerts():
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
            "filename": video.filename,
            "message": alert.message,
            "severity": alert.severity,
            "status": alert.status,
            "anomaly_type": event.anomaly_type,
            "confidence": event.confidence,
            "created_at": alert.created_at.isoformat()
        })

    return jsonify(result), 200


@app.route('/api/alerts/archived', methods=['GET'])
@jwt_required()
def get_archived_alerts():
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
            "filename": video.filename,
            "message": alert.message,
            "severity": alert.severity,
            "status": alert.status,
            "anomaly_type": event.anomaly_type,
            "confidence": event.confidence,
            "created_at": alert.created_at.isoformat()
        })

    return jsonify(result), 200

# ==========================================
# MACHINE LEARNING ENDPOINTS
# ==========================================

@app.route('/health')
def health_check():
    return jsonify({'status': 'OK'})

@app.route('/live-classification')
def get_live_classification():
    return jsonify(latest_classification)

# PROTECTED ROUTE: Requires a valid JWT token to upload and classify
# PROTECTED ROUTE: Requires a valid JWT token to upload and classify
@app.route('/api/classify', methods=['POST'])
@jwt_required()
def classify():
    print(">>> /classify hit, files received:", list(request.files.keys()))

    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400

        user_id = int(get_jwt_identity())

        file = request.files['file']
        filename = secure_filename(file.filename)
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)

        new_video = Video(
            user_id=user_id,
            filename=filename,
            file_path=file_path,
            status="processing"
        )
        db.session.add(new_video)
        db.session.commit()

        # REAL AI PIPELINE
        ai_result = run_ai_pipeline(file_path)

        label = ai_result["label"]
        confidence = ai_result["confidence"]
        alert_required = ai_result["alert_required"]

        new_video.status = "processed"

        new_event = DetectionEvent(
            video_id=new_video.video_id,
            anomaly_type=label,
            confidence=confidence,
            source_type="upload"
        )
        db.session.add(new_event)
        db.session.commit()

        alert_created = False
        alert_id = None

        if alert_required:
            new_alert = Alert(
                event_id=new_event.event_id,
                message=f"{label} detected in uploaded file: {filename}",
                severity="high" if confidence >= 0.75 else "medium",
                status="unread"
            )
            db.session.add(new_alert)
            db.session.commit()

            alert_created = True
            alert_id = new_alert.alert_id

        global latest_classification
        latest_classification = {
            "label": label,
            "confidence": confidence,
            "video_id": new_video.video_id,
            "event_id": new_event.event_id,
            "alert_id": alert_id,
            "alert_created": alert_created,
            "i3d_prediction": ai_result["i3d_prediction"],
            "vit_prediction": ai_result["vit_prediction"],
            "fusion_result": ai_result
        }

        print(f"[INFO] AI Result: {ai_result}")

        return jsonify({
            "result": label,
            "label": label,
            "confidence": confidence,
            "video_id": new_video.video_id,
            "event_id": new_event.event_id,
            "alert_id": alert_id,
            "alert_created": alert_created,
            "alert_required": alert_required,
            "i3d_prediction": ai_result["i3d_prediction"],
            "vit_prediction": ai_result["vit_prediction"],
            "fusion_result": ai_result
        }), 200

    except Exception as e:
        db.session.rollback()
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    
# Serve React frontend
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_frontend(path):
    if path != "" and os.path.exists("frontend/build/" + path):
        return send_from_directory('frontend/build', path)
    else:
        return send_from_directory('frontend/build', 'index.html')

if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True, port=5000)