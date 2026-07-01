# IntelliSight

## AI-Assisted Video Surveillance System for Public Safety

> **Note:** Replace the image paths below with your actual screenshots
> (e.g. `docs/images/...`).

```{=html}
<p align="center">
```
![Python](https://img.shields.io/badge/Python-3.10+-blue?logo=python)
![Flask](https://img.shields.io/badge/Flask-Backend-black?logo=flask)
![React
Native](https://img.shields.io/badge/React_Native-Expo-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-blue?logo=typescript)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Database-blue?logo=postgresql)
![PyTorch](https://img.shields.io/badge/PyTorch-AI-red?logo=pytorch)
![Docker](https://img.shields.io/badge/Docker-Containerized-2496ED?logo=docker)
![AWS](https://img.shields.io/badge/AWS-Cloud-orange?logo=amazonaws)

```{=html}
</p>
```

------------------------------------------------------------------------

# Overview

IntelliSight is an AI-powered surveillance platform developed as a Final
Year Project to automatically detect abnormal events from uploaded
videos and live surveillance streams. The system combines deep learning,
computer vision, cloud deployment, and a modern web interface to assist
security personnel in identifying suspicious activities in real time.

It supports: - AI-powered video anomaly detection - Live surveillance -
RTSP/IP camera integration - Demo live stream - Alert generation - Alert
archiving - Detection history - PDF reports - Cloud deployment on AWS -
Dockerized architecture

------------------------------------------------------------------------

# Screenshots

## Splash Screen

![Splash](docs/images/splash.png)

## Live Surveillance

![Live](docs/images/stream-details.png)

## Alert Popup

![Alert](docs/images/high-alert.png)

------------------------------------------------------------------------

# Features

## Authentication

-   Secure user registration
-   Login using JWT authentication
-   Protected APIs

## AI Video Analysis

-   Upload surveillance videos
-   Automatic anomaly detection
-   Confidence score
-   Severity prediction
-   Detection timeline

## Live Surveillance

Supports: - Demo Video - Mobile IP Camera - RTSP/IP Camera

## Alert System

-   Real-time alert popup
-   Alert acknowledgement
-   Archive alerts
-   Detection history

## Reports

-   Detection reports
-   Alert reports
-   PDF export

------------------------------------------------------------------------

# AI Models

-   Vision Transformer (ViT)
-   I3D / R3D Temporal Model
-   Fusion-based prediction pipeline

Supported classes: - Normal - Fighting - Shooting - Road Accidents -
Burglary

------------------------------------------------------------------------

# Technology Stack

### Frontend

-   React Native
-   Expo
-   TypeScript
-   React Navigation
-   Axios
-   HLS.js

### Backend

-   Flask
-   Python
-   SQLAlchemy
-   Flask JWT
-   Gunicorn

### AI

-   PyTorch
-   timm
-   OpenCV

### Live Streaming

-   Node.js
-   Express
-   FFmpeg
-   HLS

### Database

-   PostgreSQL

### Deployment

-   Docker
-   Docker Compose
-   AWS EC2
-   Nginx
-   HTTPS

------------------------------------------------------------------------

# Architecture

``` text
Camera / Video
      |
Preprocessing
      |
+-------------+
| ViT | I3D   |
+-------------+
      |
 Fusion
      |
Prediction
      |
Alerts + Database
      |
Frontend Dashboard
```

------------------------------------------------------------------------

# Project Structure

``` text
IntelliSight/
├── backend/
├── frontend/
├── live-server/
├── docker-compose.yml
├── README.md
└── docs/images/
```

------------------------------------------------------------------------

# Running Locally

## Prerequisites

-   Python 3.10+
-   Node.js 18+
-   PostgreSQL
-   FFmpeg
-   Git

## Clone Repository

``` bash
git clone https://github.com/YOUR_USERNAME/IntelliSight.git
cd IntelliSight
```

## Backend

``` bash
cd backend
pip install -r requirements.txt
python app.py
```

Backend runs on:

    http://localhost:5000

## Frontend

``` bash
cd frontend
npm install
npm start
```

or

``` bash
npm run web
```

Frontend:

    http://localhost:3000

## Live Server

``` bash
cd live-server
npm install
node server.js
```

Live Server:

    http://localhost:4000

## PostgreSQL

Ensure PostgreSQL is running and create a database named:

    intellisight

After starting all services, you can:

-   Register users
-   Login
-   Upload videos
-   Connect live cameras
-   Detect anomalies
-   View alerts
-   Archive alerts
-   Generate reports

------------------------------------------------------------------------

# Cloud Deployment

IntelliSight has also been successfully deployed on the cloud using a
fully containerized architecture.

Deployment includes:

-   AWS EC2
-   Docker & Docker Compose
-   Flask Backend
-   React Native (Expo Web) Frontend
-   PostgreSQL
-   Node.js Live Streaming Server
-   Gunicorn
-   Nginx Reverse Proxy
-   HTTPS Secure Access

The cloud deployment allows secure remote access while supporting
real-time surveillance and AI inference.

------------------------------------------------------------------------

# Workflow

``` text
Input Video / Live Camera
        |
Frame Extraction
        |
Preprocessing
        |
ViT + I3D
        |
Fusion
        |
Prediction
        |
Alert Generation
        |
Database Storage
        |
Dashboard
```

------------------------------------------------------------------------

# API Overview

  Method   Endpoint                  Description
  -------- ------------------------- -------------------
  POST     /api/auth/register        Register
  POST     /api/auth/login           Login
  POST     /api/classify             Analyze video
  GET      /api/detections           Detection history
  GET      /api/alerts               Alerts
  POST     /api/alerts/{id}/review   Archive alert
  GET      /api/reports/detections   Reports
  GET      /health                   Health check

------------------------------------------------------------------------

# Future Improvements

-   Improve ViT accuracy
-   Multi-camera support
-   Email/SMS notifications
-   Real-time object tracking
-   Face recognition integration
-   Admin analytics
-   Mobile push notifications

------------------------------------------------------------------------

# Contributors

**Muhammad Mubeen** - Backend - AI Integration - Database - Deployment

**Rohaan Jaffar** - Frontend - Testing - Documentation

**Supervisor:** Asif Ahsan

------------------------------------------------------------------------

# License

This project was developed for academic purposes as a BSCS Final Year
Project.
