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


class Alert(db.Model):
    __tablename__ = 'alert'

    alert_id = db.Column(db.Integer, primary_key=True)
    event_id = db.Column(db.Integer, db.ForeignKey('detection_event.event_id'), nullable=False)
    message = db.Column(db.String(255), nullable=False)
    severity = db.Column(db.String(30), default='medium')
    status = db.Column(db.String(30), default='unread')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    event = db.relationship('DetectionEvent', backref=db.backref('alerts', lazy=True))