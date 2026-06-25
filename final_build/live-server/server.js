/**
 * ============================================================
 * IntelliSight Live Stream Server
 * ============================================================
 *
 * PURPOSE:
 *   Accepts a camera source, converts it to HLS format using
 *   FFmpeg, serves the HLS stream to the React Native frontend,
 *   and notifies clients via WebSocket when new segments arrive.
 *
 * SUPPORTED STREAM MODES:
 *   1. local       → plays demo video (videos/test.mp4) on loop
 *   2. mobile-cam  → connects to phone IP Webcam app via HTTP MJPEG
 *   3. ip-camera   → connects to real CCTV camera via RTSP
 *
 * ARCHITECTURE:
 *   Camera/Phone/Video
 *        ↓
 *      FFmpeg  (converts any source → HLS .m3u8 + .ts segments)
 *        ↓
 *   Node HTTP Server  (serves .m3u8 and .ts files to frontend)
 *        ↓
 *   WebSocket  (notifies frontend in real time when stream starts/stops)
 *        ↓
 *   React Native Frontend  (plays stream using HLS.js or expo-av)
 *
 * ============================================================
 */

const http = require("http");
const fs = require("fs");
const WebSocket = require("ws");
const path = require("path");
const { spawn } = require("child_process");

// ─────────────────────────────────────────────────────────────
// CONFIGURATION
// Change PC_IP to your laptop's IP address on the local network.
// Change FFMPEG_PATH to where FFmpeg is installed on your machine.
// ─────────────────────────────────────────────────────────────
const PORT = 4000;
const PC_IP = "192.168.100.12";

const FFMPEG_PATH =
    "C:\\Users\\MUBEEN\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe";

// Where HLS segments and playlist will be written
const HLS_DIR = path.join(__dirname, "videos", "ipcam");
const HLS_OUTPUT = path.join(HLS_DIR, "index.m3u8");

// Demo video path — used when mode = "local"
const LOCAL_VIDEO_PATH = path.join(__dirname, "videos", "test.mp4");

// ─────────────────────────────────────────────────────────────
// LIVE AI CONFIGURATION
// Sends short live clips to Flask AI backend for ViT + I3D fusion.
// ─────────────────────────────────────────────────────────────
const AI_BACKEND_URL = "http://192.168.100.12:5000/api/classify-live";

// Paste a valid JWT token here for demo testing through environment variable.
// PowerShell example:
// $env:AI_AUTH_TOKEN="YOUR_JWT_TOKEN_HERE"
const AI_AUTH_TOKEN = process.env.AI_AUTH_TOKEN || "";

const LIVE_AI_CLIP_DIR = path.join(__dirname, "videos", "live_ai_clips");
const LIVE_AI_INTERVAL_MS = 10000;
const LIVE_AI_SEGMENT_COUNT = 3;

if (!fs.existsSync(LIVE_AI_CLIP_DIR)) {
    fs.mkdirSync(LIVE_AI_CLIP_DIR, { recursive: true });
}

// ─────────────────────────────────────────────────────────────
// SERVER STATE
// These variables track what is currently happening on the server.
// ─────────────────────────────────────────────────────────────

/**
 * currentMode: which source is active
 * "local" | "mobile-cam" | "ip-camera"
 */
let currentMode = "local";

/**
 * currentCameraUrl: the stream URL being used (for mobile-cam and ip-camera)
 * Empty string when mode is "local"
 */
let currentCameraUrl = "";

/** ffmpegProcess: reference to the running FFmpeg child process */
let ffmpegProcess = null;

/** isStreaming: true when FFmpeg is running and producing HLS output */
let isStreaming = false;

/** clients: set of connected WebSocket clients to broadcast status to */
let clients = new Set();

/** liveAiTimer: interval timer for live AI processing */
let liveAiTimer = null;

/** liveAiBusy: prevents multiple AI requests from running at same time */
let liveAiBusy = false;

/** lastProcessedSegment: avoids processing same HLS segment repeatedly */
let lastProcessedSegment = "";

// Create HLS output folder if it does not exist
if (!fs.existsSync(HLS_DIR)) {
    fs.mkdirSync(HLS_DIR, { recursive: true });
    console.log("Created HLS directory:", HLS_DIR);
}

// ─────────────────────────────────────────────────────────────
// UTILITY: cleanHlsFolder
// Deletes old .m3u8 and .ts files before starting a new stream.
// This prevents the frontend from loading stale segments from
// a previous session which would cause playback errors.
// ─────────────────────────────────────────────────────────────
function cleanHlsFolder() {
    try {
        const files = fs.readdirSync(HLS_DIR);
        let deleted = 0;

        files.forEach((file) => {
            if (file.endsWith(".ts") || file.endsWith(".m3u8")) {
                fs.unlinkSync(path.join(HLS_DIR, file));
                deleted++;
            }
        });

        console.log(`[HLS] Cleaned ${deleted} old segment(s)`);
    } catch (err) {
        // Non-fatal — log and continue
        console.warn("[HLS] Clean warning:", err.message);
    }
}

// ─────────────────────────────────────────────────────────────
// UTILITY: stopFFmpeg
// Gracefully terminates the running FFmpeg process.
// Always call this before starting a new stream to avoid
// multiple FFmpeg processes running simultaneously.
// ─────────────────────────────────────────────────────────────
function stopFFmpeg() {
    stopLiveAiProcessing();

    if (ffmpegProcess) {
        console.log("[FFmpeg] Stopping existing process...");
        ffmpegProcess.kill("SIGTERM");
        ffmpegProcess = null;
    }
    isStreaming = false;
}

// ─────────────────────────────────────────────────────────────
// UTILITY: broadcastStatus
// Sends the current server state to all connected WebSocket
// clients so the frontend can update its UI in real time.
// ─────────────────────────────────────────────────────────────
function broadcastStatus() {
    const message = JSON.stringify({
        type: "status",
        isStreaming,
        mode: currentMode,
        streamUrl: `http://${PC_IP}:${PORT}/index.m3u8`,
    });

    clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// ─────────────────────────────────────────────────────────────
// UTILITY: buildRtspUrl
// Constructs an RTSP URL from individual camera credentials.
// Used when the user provides an IP address instead of a
// full RTSP URL.
//
// Most IP camera brands (Hikvision, Dahua, Reolink, TP-Link)
// follow the Hikvision-style URL format by default:
//   rtsp://user:pass@ip:554/Streaming/Channels/101
//
// Channel format: channel=1, subtype=0 (main stream) → "101"
//                 channel=1, subtype=1 (sub stream)  → "102"
// ─────────────────────────────────────────────────────────────
function buildRtspUrl(ip, username = "admin", password = "", channel = 1) {
    const channelCode = `${channel}01`;
    return `rtsp://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${ip}:554/Streaming/Channels/${channelCode}`;
}

// ─────────────────────────────────────────────────────────────
// UTILITY: getLatestHlsSegments
// Reads the latest .ts files from the HLS folder.
// These files are generated by FFmpeg and represent live video chunks.
// ─────────────────────────────────────────────────────────────
function getLatestHlsSegments(count = LIVE_AI_SEGMENT_COUNT) {
    try {
        const files = fs.readdirSync(HLS_DIR)
            .filter((file) => file.endsWith(".ts"))
            .map((file) => {
                const filePath = path.join(HLS_DIR, file);
                return {
                    name: file,
                    path: filePath,
                    time: fs.statSync(filePath).mtimeMs,
                };
            })
            .sort((a, b) => a.time - b.time);

        return files.slice(-count);
    } catch (err) {
        console.warn("[Live AI] Failed to read HLS segments:", err.message);
        return [];
    }
}

// ─────────────────────────────────────────────────────────────
// UTILITY: createClipFromSegments
// Combines recent HLS .ts segments into one short .mp4 clip.
// This clip is then sent to Flask /api/classify-live.
// ─────────────────────────────────────────────────────────────
function createClipFromSegments(segments, outputPath) {
    return new Promise((resolve, reject) => {
        if (!segments || segments.length === 0) {
            reject(new Error("No HLS segments available for AI clip."));
            return;
        }

        const concatFilePath = path.join(LIVE_AI_CLIP_DIR, "concat_list.txt");

        const concatContent = segments
            .map((segment) => `file '${segment.path.replace(/\\/g, "/")}'`)
            .join("\n");

        fs.writeFileSync(concatFilePath, concatContent);

        const args = [
            "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", concatFilePath,
            "-c", "copy",
            outputPath,
        ];

        const clipProcess = spawn(FFMPEG_PATH, args, { windowsHide: true });

        clipProcess.stderr.on("data", (data) => {
            const msg = data.toString().trim();
            if (msg) console.log(`[Live AI FFmpeg] ${msg}`);
        });

        clipProcess.on("error", (err) => {
            reject(new Error("Failed to create AI clip: " + err.message));
        });

        clipProcess.on("close", (code) => {
            if (code === 0 && fs.existsSync(outputPath)) {
                resolve(outputPath);
            } else {
                reject(new Error(`AI clip FFmpeg exited with code ${code}`));
            }
        });
    });
}

// ─────────────────────────────────────────────────────────────
// UTILITY: sendClipToAiBackend
// Sends the generated live clip to Flask backend.
// Flask then runs ViT + I3D + Fusion and stores the latest result.
// ─────────────────────────────────────────────────────────────
async function sendClipToAiBackend(clipPath) {
    if (!AI_AUTH_TOKEN) {
        console.warn("[Live AI] Missing AI_AUTH_TOKEN. Skipping live AI request.");
        return;
    }

    try {
        const buffer = fs.readFileSync(clipPath);
        const blob = new Blob([buffer], { type: "video/mp4" });

        const formData = new FormData();
        formData.append("video", blob, path.basename(clipPath));

        const response = await fetch(AI_BACKEND_URL, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${AI_AUTH_TOKEN}`,
            },
            body: formData,
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || data.message || `HTTP ${response.status}`);
        }

        console.log("[Live AI] Result:", {
            label: data.final_label,
            confidence: data.final_confidence,
            alert: data.alert_required,
        });
    } catch (err) {
        console.error("[Live AI] Backend request failed:", err.message);
    }
}

// ─────────────────────────────────────────────────────────────
// CORE: processLiveAiClip
// Takes the latest HLS segments, creates a short clip,
// and sends it to the Flask AI backend.
// ─────────────────────────────────────────────────────────────
async function processLiveAiClip() {
    if (!isStreaming || liveAiBusy) return;

    liveAiBusy = true;

    try {
        const segments = getLatestHlsSegments();

        if (segments.length < LIVE_AI_SEGMENT_COUNT) {
            console.log("[Live AI] Waiting for enough HLS segments...");
            return;
        }

        const newestSegment = segments[segments.length - 1].name;

        if (newestSegment === lastProcessedSegment) {
            console.log("[Live AI] No new segment to process yet.");
            return;
        }

        lastProcessedSegment = newestSegment;

        const clipName = `live_clip_${Date.now()}.mp4`;
        const clipPath = path.join(LIVE_AI_CLIP_DIR, clipName);

        console.log("[Live AI] Creating clip from segments:", segments.map((s) => s.name));

        await createClipFromSegments(segments, clipPath);
        await sendClipToAiBackend(clipPath);

        // Cleanup generated clip after sending to backend
        fs.unlink(clipPath, (err) => {
            if (err) console.warn("[Live AI] Clip cleanup warning:", err.message);
        });
    } catch (err) {
        console.error("[Live AI] Processing failed:", err.message);
    } finally {
        liveAiBusy = false;
    }
}

// ─────────────────────────────────────────────────────────────
// UTILITY: startLiveAiProcessing
// Starts periodic live AI processing after stream starts.
// ─────────────────────────────────────────────────────────────
function startLiveAiProcessing() {
    stopLiveAiProcessing();

    console.log("[Live AI] Starting live AI processing...");

    liveAiTimer = setInterval(() => {
        processLiveAiClip();
    }, LIVE_AI_INTERVAL_MS);
}

// ─────────────────────────────────────────────────────────────
// UTILITY: stopLiveAiProcessing
// Stops periodic AI processing when stream stops.
// ─────────────────────────────────────────────────────────────
function stopLiveAiProcessing() {
    if (liveAiTimer) {
        clearInterval(liveAiTimer);
        liveAiTimer = null;
    }

    liveAiBusy = false;
    lastProcessedSegment = "";
}

// ─────────────────────────────────────────────────────────────
// CORE: startFFmpeg
// The main function that launches FFmpeg with the correct
// arguments for each stream mode.
//
// Modes:
//   "local"      → loop demo video (videos/test.mp4)
//   "mobile-cam" → read MJPEG stream from phone (IP Webcam app)
//   "ip-camera"  → read RTSP stream from real IP camera
//
// All modes output to the same HLS folder so the frontend
// always reads from the same URL: /index.m3u8
// ─────────────────────────────────────────────────────────────
function startFFmpeg(mode, cameraUrl = "") {
    stopFFmpeg();
    cleanHlsFolder();

    currentMode = mode;
    currentCameraUrl = cameraUrl;

    let inputArgs = [];

    if (mode === "local") {
        if (!fs.existsSync(LOCAL_VIDEO_PATH)) {
            throw new Error(
                `Demo video not found. Please add a video at: ${LOCAL_VIDEO_PATH}`
            );
        }

        console.log("[FFmpeg] Mode: local →", LOCAL_VIDEO_PATH);

        inputArgs = [
            "-re",
            "-stream_loop", "-1",
            "-i", LOCAL_VIDEO_PATH,
        ];

    } else if (mode === "mobile-cam") {
        if (!cameraUrl) {
            throw new Error(
                "Mobile camera URL is required. Example: http://192.168.100.21:8080/video"
            );
        }

        console.log("[FFmpeg] Mode: mobile-cam →", cameraUrl);

        inputArgs = [
            "-fflags", "nobuffer+genpts",
            "-flags", "low_delay",
            "-i", cameraUrl,
        ];

    } else if (mode === "ip-camera") {
        if (!cameraUrl) {
            throw new Error(
                "IP camera RTSP URL is required. Example: rtsp://admin:pass@192.168.1.64:554/stream1"
            );
        }

        console.log("[FFmpeg] Mode: ip-camera →", cameraUrl);

        inputArgs = [
            "-rtsp_transport", "tcp",
            "-fflags", "nobuffer",
            "-i", cameraUrl,
        ];

    } else {
        throw new Error(
            `Unknown mode: "${mode}". Valid modes: local | mobile-cam | ip-camera`
        );
    }

    const ffmpegArgs = [
        "-loglevel", "warning",
        ...inputArgs,
        "-an",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-tune", "zerolatency",
        ...(mode === "mobile-cam" ? ["-vf", "fps=10"] : []),
        "-g", "20",
        "-hls_time", "2",
        "-hls_list_size", "10",
        "-hls_delete_threshold", "6",
        "-hls_flags", "delete_segments",
        "-hls_segment_filename", path.join(HLS_DIR, "index%d.ts"),
        HLS_OUTPUT,
    ];

    console.log("[FFmpeg] Starting with args:", ffmpegArgs.join(" "));

    ffmpegProcess = spawn(FFMPEG_PATH, ffmpegArgs, {
        windowsHide: true,
    });

    isStreaming = true;
    broadcastStatus();

    startLiveAiProcessing();

    ffmpegProcess.stderr.on("data", (data) => {
        const msg = data.toString().trim();
        if (msg) console.log(`[FFmpeg] ${msg}`);
    });

    ffmpegProcess.on("error", (err) => {
        console.error("[FFmpeg] Failed to spawn:", err.message);
        console.error("[FFmpeg] Check that FFMPEG_PATH is correct:", FFMPEG_PATH);
        stopLiveAiProcessing();
        isStreaming = false;
        broadcastStatus();
    });

    ffmpegProcess.on("close", (code) => {
        console.log(`[FFmpeg] Process exited with code ${code}`);

        if (code !== 0 && code !== null) {
            console.error("[FFmpeg] Unexpected exit. Possible causes:");
            console.error("  - Camera disconnected or unreachable");
            console.error("  - Wrong stream URL or credentials");
            console.error("  - Network issue on LAN");
        }

        stopLiveAiProcessing();
        isStreaming = false;
        ffmpegProcess = null;
        broadcastStatus();
    });
}

// ─────────────────────────────────────────────────────────────
// UTILITY: sendJson
// Sends a JSON response with CORS headers.
// All API responses go through this helper.
// ─────────────────────────────────────────────────────────────
function sendJson(response, statusCode, data) {
    response.writeHead(statusCode, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers": "Content-Type",
    });
    response.end(JSON.stringify(data));
}

// ─────────────────────────────────────────────────────────────
// UTILITY: parseBody
// Reads and parses the JSON body from a POST request.
// Returns an empty object if body is empty.
// ─────────────────────────────────────────────────────────────
function parseBody(request) {
    return new Promise((resolve, reject) => {
        let body = "";

        request.on("data", (chunk) => { body += chunk.toString(); });

        request.on("end", () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (err) {
                reject(new Error("Invalid JSON in request body"));
            }
        });

        request.on("error", (err) => {
            reject(new Error("Error reading request body: " + err.message));
        });
    });
}

// ─────────────────────────────────────────────────────────────
// HTTP SERVER
// Handles all API requests from the React Native frontend.
//
// API ENDPOINTS:
//   GET  /           → health check
//   GET  /status     → current stream state
//   POST /connect    → start a stream (see body format below)
//   POST /disconnect → stop the current stream
//   GET  /index.m3u8 → HLS playlist file
//   GET  /index*.ts  → HLS video segments
// ─────────────────────────────────────────────────────────────
const server = http.createServer(async (request, response) => {
    console.log(`[HTTP] ${request.method} ${request.url}`);

    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": 2592000,
    };

    const parsedUrl = new URL(request.url, `http://${request.headers.host}`);
    const pathname = parsedUrl.pathname;

    if (request.method === "OPTIONS") {
        response.writeHead(204, corsHeaders);
        response.end();
        return;
    }

    if (pathname === "/" && request.method === "GET") {
        response.writeHead(200, {
            "Content-Type": "text/plain",
            "Access-Control-Allow-Origin": "*",
        });
        response.end("IntelliSight Live Server Running ✓");
        return;
    }

    if (pathname === "/status" && request.method === "GET") {
        sendJson(response, 200, {
            isStreaming,
            mode: currentMode,
            streamUrl: `http://${PC_IP}:${PORT}/index.m3u8`,
        });
        return;
    }

    if (pathname === "/connect" && request.method === "POST") {
        try {
            const body = await parseBody(request);
            console.log("[CONNECT] Request body:", body);

            const mode = body.mode || "local";
            let cameraUrl = "";

            if (mode === "mobile-cam") {
                cameraUrl = body.streamUrl || body.url || "";

                if (!cameraUrl) {
                    throw new Error(
                        'mobile-cam mode requires "streamUrl". ' +
                        'Example: "http://192.168.100.21:8080/video"'
                    );
                }

            } else if (mode === "ip-camera") {
                if (body.streamUrl || body.rtspUrl) {
                    cameraUrl = body.streamUrl || body.rtspUrl;
                } else if (body.ip) {
                    cameraUrl = buildRtspUrl(
                        body.ip,
                        body.username || "admin",
                        body.password || "",
                        body.channel || 1
                    );
                    console.log("[CONNECT] Built RTSP URL:", cameraUrl);
                } else {
                    throw new Error(
                        'ip-camera mode requires either "streamUrl" (full RTSP URL) ' +
                        'or "ip" (camera IP address). ' +
                        'Example: { "ip": "192.168.1.64", "username": "admin", "password": "pass" }'
                    );
                }

            } else if (mode !== "local") {
                throw new Error(
                    `Unknown mode: "${mode}". Valid values: local | mobile-cam | ip-camera`
                );
            }

            startFFmpeg(mode, cameraUrl);

            sendJson(response, 200, {
                success: true,
                message: "Stream started successfully",
                mode,
                cameraUrl: cameraUrl || null,
                streamUrl: `http://${PC_IP}:${PORT}/index.m3u8`,
            });

        } catch (err) {
            console.error("[CONNECT] Error:", err.message);
            sendJson(response, 400, {
                success: false,
                message: err.message,
            });
        }

        return;
    }

    if (pathname === "/disconnect" && request.method === "POST") {
        stopFFmpeg();
        cleanHlsFolder();

        sendJson(response, 200, {
            success: true,
            message: "Stream stopped successfully",
        });

        broadcastStatus();
        return;
    }

    if (pathname.endsWith(".m3u8")) {
        Object.assign(corsHeaders, {
            "Content-Type": "application/vnd.apple.mpegurl",
            "Cache-Control": "no-store, no-cache",
        });
    } else if (pathname.endsWith(".ts")) {
        Object.assign(corsHeaders, {
            "Content-Type": "video/MP2T",
            "Cache-Control": "no-store",
        });
    }

    const requestedFile = pathname.replace(/^\/+/, "");
    const filePath = path.join(HLS_DIR, requestedFile);

    if (!filePath.startsWith(HLS_DIR)) {
        response.writeHead(403, corsHeaders);
        response.end("Forbidden");
        return;
    }

    fs.readFile(filePath, (err, content) => {
        if (err) {
            response.writeHead(404, corsHeaders);
            response.end("File not found");
            return;
        }

        response.writeHead(200, corsHeaders);
        response.end(content);
    });
});

// ─────────────────────────────────────────────────────────────
// WEBSOCKET SERVER
// Shares the same port as the HTTP server.
// Frontend connects once and receives real-time status updates
// whenever the stream starts, stops, or a new segment is ready.
// ─────────────────────────────────────────────────────────────
const wss = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
    console.log("[WS] New client connected");
    clients.add(ws);

    ws.send(JSON.stringify({
        type: "status",
        isStreaming,
        mode: currentMode,
        streamUrl: `http://${PC_IP}:${PORT}/index.m3u8`,
    }));

    ws.on("close", () => {
        console.log("[WS] Client disconnected");
        clients.delete(ws);
    });

    ws.on("error", (err) => {
        console.warn("[WS] Client error:", err.message);
        clients.delete(ws);
    });
});

// ─────────────────────────────────────────────────────────────
// HLS FOLDER WATCHER
// Watches for new .ts segment files being written by FFmpeg.
// Notifies all WebSocket clients when a new segment is ready
// so the frontend knows to refresh the playlist.
// ─────────────────────────────────────────────────────────────
fs.watch(HLS_DIR, (eventType, filename) => {
    if (filename && filename.endsWith(".ts") && eventType === "rename") {
        const message = JSON.stringify({
            type: "segment",
            segment: filename,
            streamUrl: `http://${PC_IP}:${PORT}/index.m3u8`,
        });

        clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }
});

// ─────────────────────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────────────────────
server.listen(PORT, "0.0.0.0", () => {
    console.log("=".repeat(55));
    console.log("  IntelliSight Live Server");
    console.log("=".repeat(55));
    console.log(`  Health:    http://${PC_IP}:${PORT}/`);
    console.log(`  Status:    http://${PC_IP}:${PORT}/status`);
    console.log(`  Stream:    http://${PC_IP}:${PORT}/index.m3u8`);
    console.log(`  WebSocket: ws://${PC_IP}:${PORT}`);
    console.log("=".repeat(55));
    console.log("  Modes available:");
    console.log("    local      → demo video (videos/test.mp4)");
    console.log("    mobile-cam → phone IP Webcam app (MJPEG)");
    console.log("    ip-camera  → real CCTV camera (RTSP)");
    console.log("=".repeat(55));
});