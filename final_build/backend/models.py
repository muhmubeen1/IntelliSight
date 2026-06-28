from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()


class Role(db.Model):
    __tablename__ = 'role'

    role_id = db.Column(db.Integer, primary_key=True)
    role_name = db.Column(db.String(50), unique=True, nullable=False)
    description = db.Column(db.String(255))


class User(db.Model):
    __tablename__ = 'user'

    user_id = db.Column(db.Integer, primary_key=True)
    full_name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    status = db.Column(db.String(20), default='active')


class UserRole(db.Model):
    __tablename__ = 'user_role'

    user_role_id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.user_id'), nullable=False)
    role_id = db.Column(db.Integer, db.ForeignKey('role.role_id'), nullable=False)
    assigned_at = db.Column(db.DateTime, default=datetime.utcnow)

    user = db.relationship('User', backref=db.backref('roles', lazy='dynamic'))
    role = db.relationship('Role', backref=db.backref('users', lazy='dynamic'))


class Video(db.Model):
    __tablename__ = 'video'

    video_id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.user_id'), nullable=False)
    filename = db.Column(db.String(255), nullable=False)
    file_path = db.Column(db.String(500), nullable=False)
    upload_time = db.Column(db.DateTime, default=datetime.utcnow)
    status = db.Column(db.String(30), default='uploaded')

    user = db.relationship('User', backref=db.backref('videos', lazy=True))


class DetectionEvent(db.Model):
    __tablename__ = 'detection_event'

    event_id = db.Column(db.Integer, primary_key=True)
    video_id = db.Column(db.Integer, db.ForeignKey('video.video_id'), nullable=True)
    anomaly_type = db.Column(db.String(100), nullable=False)
    confidence = db.Column(db.Float, nullable=False)
    detected_at = db.Column(db.DateTime, default=datetime.utcnow)
    frame_time = db.Column(db.Float, nullable=True)
    source_type = db.Column(db.String(30), default='upload')

    video = db.relationship('Video', backref=db.backref('detection_events', lazy=True))

class VideoAnomalyTimeline(db.Model):
    __tablename__ = 'video_anomaly_timeline'
    
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    video_id = db.Column(db.Integer, db.ForeignKey('video.video_id'), nullable=False, index=True)
    anomaly_type = db.Column(db.String(50), nullable=False)
    confidence = db.Column(db.Float, nullable=False)
    start_time = db.Column(db.Float, nullable=False)
    end_time = db.Column(db.Float, nullable=False)
    detected_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    video = db.relationship('Video', backref=db.backref('anomaly_timeline', lazy='dynamic', cascade='all, delete-orphan'))
    
    def to_dict(self):
        return {
            'id': self.id,
            'video_id': self.video_id,
            'anomaly_type': self.anomaly_type,
            'confidence': round(self.confidence, 4),
            'start_time': self.start_time,
            'end_time': self.end_time,
            'duration': round(self.end_time - self.start_time, 2),
            'detected_at': self.detected_at.isoformat() if self.detected_at else None
        }


class Alert(db.Model):
    __tablename__ = 'alert'

    alert_id = db.Column(db.Integer, primary_key=True)
    event_id = db.Column(db.Integer, db.ForeignKey('detection_event.event_id'), nullable=True)

    message = db.Column(db.String(255), nullable=False)
    severity = db.Column(db.String(30), default='medium')
    status = db.Column(db.String(30), default='unread')

    # NEW FIELD
    is_archived = db.Column(db.Boolean, default=False, nullable=False)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    event = db.relationship(
        'DetectionEvent',
        backref=db.backref('alerts', lazy=True)
    )
    
class AlertArchive(db.Model):
    __tablename__ = 'alert_archive'

    archive_id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.user_id'), nullable=False)

    archive_date = db.Column(db.Date, nullable=False)

    total_alerts = db.Column(db.Integer, default=0)

    # Existing
    stream_alerts = db.Column(db.Integer, default=0)
    manual_alerts = db.Column(db.Integer, default=0)

    # New statistics
    high_count = db.Column(db.Integer, default=0)
    medium_count = db.Column(db.Integer, default=0)
    low_count = db.Column(db.Integer, default=0)

    # PDF generated later
    pdf_path = db.Column(db.String(500), nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    user = db.relationship(
        'User',
        backref=db.backref('alert_archives', lazy=True)
        
    )




class LiveStreamSession(db.Model):
    __tablename__ = "live_stream_sessions"

    stream_id = db.Column(db.Integer, primary_key=True)
    started_at = db.Column(db.DateTime, default=datetime.utcnow)
    ended_at = db.Column(db.DateTime, nullable=True)
    status = db.Column(db.String(20), default="active")
    total_detections = db.Column(db.Integer, default=0)
    is_archived = db.Column(db.Boolean, default=False)

    detections = db.relationship(
        "LiveStreamDetection",
        backref="stream_session",
        lazy=True,
        cascade="all, delete-orphan"
    )


class LiveStreamDetection(db.Model):
    __tablename__ = "live_stream_detections"

    detection_id = db.Column(db.Integer, primary_key=True)

    stream_id = db.Column(
        db.Integer,
        db.ForeignKey("live_stream_sessions.stream_id"),
        nullable=False
    )

    anomaly_type = db.Column(db.String(100), nullable=False)
    confidence = db.Column(db.Float, nullable=False)
    severity = db.Column(db.String(20), default="medium")

    detected_at = db.Column(db.DateTime, default=datetime.utcnow)
    frame_timestamp = db.Column(db.String(50), nullable=True)