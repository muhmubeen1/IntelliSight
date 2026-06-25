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
    const channelCode = `${channel}01`; // e.g. channel 1 main = "101"
    return `rtsp://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${ip}:554/Streaming/Channels/${channelCode}`;
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
    // Stop any existing stream first
    stopFFmpeg();

    // Clear old HLS segments so frontend gets a fresh stream
    cleanHlsFolder();

    currentMode = mode;
    currentCameraUrl = cameraUrl;

    // ── Build FFmpeg input arguments based on mode ────────────
    let inputArgs = [];

    if (mode === "local") {
        // ── MODE: Local demo video ────────────────────────────
        // Plays the test video in an infinite loop.
        // -re: read input at native frame rate (real-time speed)
        // -stream_loop -1: loop the video indefinitely
        if (!fs.existsSync(LOCAL_VIDEO_PATH)) {
            throw new Error(
                `Demo video not found. Please add a video at: ${LOCAL_VIDEO_PATH}`
            );
        }

        console.log("[FFmpeg] Mode: local →", LOCAL_VIDEO_PATH);

        inputArgs = [
            "-re",                  // Read at real-time speed
            "-stream_loop", "-1",   // Loop forever
            "-i", LOCAL_VIDEO_PATH, // Input file
        ];

    } else if (mode === "mobile-cam") {
        // ── MODE: Mobile camera via IP Webcam app ─────────────
        // IP Webcam (Android) streams MJPEG over HTTP.
        // URL format: http://PHONE_IP:8080/video
        //
        // -fflags nobuffer: reduce input buffering for lower latency
        // -flags low_delay: enable low-delay mode
        // No -rtsp_transport needed — this is HTTP, not RTSP
        if (!cameraUrl) {
            throw new Error(
                "Mobile camera URL is required. Example: http://192.168.100.21:8080/video"
            );
        }

        console.log("[FFmpeg] Mode: mobile-cam →", cameraUrl);

        inputArgs = [
            "-fflags", "nobuffer+genpts", // No buffering, generate timestamps
            "-flags", "low_delay",       // Low latency mode
            "-i", cameraUrl,         // HTTP MJPEG stream from phone
        ];

    } else if (mode === "ip-camera") {
        // ── MODE: Real IP camera via RTSP ─────────────────────
        // Professional CCTV cameras stream via RTSP protocol.
        // URL format: rtsp://user:pass@IP:554/Streaming/Channels/101
        //
        // -rtsp_transport tcp: use TCP instead of UDP for reliability
        //   on LAN cables (UDP can drop packets causing video glitches)
        if (!cameraUrl) {
            throw new Error(
                "IP camera RTSP URL is required. Example: rtsp://admin:pass@192.168.1.64:554/stream1"
            );
        }

        console.log("[FFmpeg] Mode: ip-camera →", cameraUrl);

        inputArgs = [
            "-rtsp_transport", "tcp",     // TCP is more stable on LAN
            "-fflags", "nobuffer",// Reduce latency
            "-i", cameraUrl, // RTSP stream from IP camera
        ];

    } else {
        throw new Error(
            `Unknown mode: "${mode}". Valid modes: local | mobile-cam | ip-camera`
        );
    }

    // ── Build complete FFmpeg argument list ───────────────────
    const ffmpegArgs = [
        // Show detailed logs for debugging
        "-loglevel", "warning",

        // Input arguments (built above based on mode)
        ...inputArgs,

        // ── Output settings ───────────────────────────────────

        // Disable audio — we only need video for surveillance
        "-an",

        // Re-encode video to H.264 for maximum browser compatibility
        // libx264: widely supported H.264 encoder
        // ultrafast: fastest encoding preset, ideal for live streaming
        // zerolatency: tuning for low-latency streaming (no B-frames)
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-tune", "zerolatency",

        // Force 10fps for mobile-cam mode to handle slow MJPEG streams
        // For local/ip-camera this is removed to keep native frame rate
        ...(mode === "mobile-cam" ? ["-vf", "fps=10"] : []),

        // Keyframe every 20 frames — needed for HLS segment boundaries
        "-g", "20",

        // ── HLS output settings ───────────────────────────────
        // hls_time 2:          each segment is 2 seconds long
        // hls_list_size 10:    keep last 10 segments in playlist
        // hls_delete_threshold 6: delete segments older than 6 from list
        // hls_flags delete_segments: auto-delete old .ts files from disk
        "-hls_time", "2",
        "-hls_list_size", "10",
        "-hls_delete_threshold", "6",
        "-hls_flags", "delete_segments",

        // Segment file naming: index0.ts, index1.ts, index2.ts ...
        "-hls_segment_filename", path.join(HLS_DIR, "index%d.ts"),

        // Output playlist file
        HLS_OUTPUT,
    ];

    console.log("[FFmpeg] Starting with args:", ffmpegArgs.join(" "));

    // Spawn FFmpeg as a child process
    ffmpegProcess = spawn(FFMPEG_PATH, ffmpegArgs, {
        windowsHide: true, // Hide FFmpeg window on Windows
    });

    isStreaming = true;
    broadcastStatus(); // Notify all WebSocket clients

    // ── FFmpeg log output ─────────────────────────────────────
    // FFmpeg writes all logs to stderr (even non-error output)
    ffmpegProcess.stderr.on("data", (data) => {
        const msg = data.toString().trim();
        if (msg) console.log(`[FFmpeg] ${msg}`);
    });

    // ── FFmpeg error handling ─────────────────────────────────
    ffmpegProcess.on("error", (err) => {
        console.error("[FFmpeg] Failed to spawn:", err.message);
        console.error("[FFmpeg] Check that FFMPEG_PATH is correct:", FFMPEG_PATH);
        isStreaming = false;
        broadcastStatus();
    });

    // ── FFmpeg exit handling ──────────────────────────────────
    ffmpegProcess.on("close", (code) => {
        console.log(`[FFmpeg] Process exited with code ${code}`);

        if (code !== 0 && code !== null) {
            console.error("[FFmpeg] Unexpected exit. Possible causes:");
            console.error("  - Camera disconnected or unreachable");
            console.error("  - Wrong stream URL or credentials");
            console.error("  - Network issue on LAN");
        }

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

    // CORS headers for all responses
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": 2592000,
    };

    const parsedUrl = new URL(request.url, `http://${request.headers.host}`);
    const pathname = parsedUrl.pathname;

    // ── Handle CORS preflight requests ────────────────────────
    if (request.method === "OPTIONS") {
        response.writeHead(204, corsHeaders);
        response.end();
        return;
    }

    // ── GET / — Health check ──────────────────────────────────
    if (pathname === "/" && request.method === "GET") {
        response.writeHead(200, {
            "Content-Type": "text/plain",
            "Access-Control-Allow-Origin": "*",
        });
        response.end("IntelliSight Live Server Running ✓");
        return;
    }

    // ── GET /status — Current stream state ───────────────────
    // Frontend calls this on mount to restore stream state
    // after app reload or reconnect.
    if (pathname === "/status" && request.method === "GET") {
        sendJson(response, 200, {
            isStreaming,
            mode: currentMode,
            streamUrl: `http://${PC_IP}:${PORT}/index.m3u8`,
        });
        return;
    }

    // ── POST /connect — Start a stream ────────────────────────
    //
    // Request body format:
    //
    // 1. Demo video (loop test.mp4):
    //    { "mode": "local" }
    //
    // 2. Mobile camera (IP Webcam app on phone):
    //    { "mode": "mobile-cam", "streamUrl": "http://192.168.100.21:8080/video" }
    //
    // 3. IP camera with full RTSP URL (you know the URL):
    //    { "mode": "ip-camera", "streamUrl": "rtsp://admin:pass@192.168.1.64:554/stream1" }
    //
    // 4. IP camera with just IP address (URL is auto-built):
    //    { "mode": "ip-camera", "ip": "192.168.1.64", "username": "admin", "password": "pass" }
    //
    if (pathname === "/connect" && request.method === "POST") {
        try {
            const body = await parseBody(request);
            console.log("[CONNECT] Request body:", body);

            const mode = body.mode || "local";
            let cameraUrl = "";

            if (mode === "mobile-cam") {
                // ── Mobile cam: expect streamUrl ──────────────
                // IP Webcam app streams at: http://PHONE_IP:8080/video
                cameraUrl = body.streamUrl || body.url || "";

                if (!cameraUrl) {
                    throw new Error(
                        'mobile-cam mode requires "streamUrl". ' +
                        'Example: "http://192.168.100.21:8080/video"'
                    );
                }

            } else if (mode === "ip-camera") {
                // ── IP camera: accept full URL or build from IP ─
                if (body.streamUrl || body.rtspUrl) {
                    // User provided the full RTSP URL directly
                    cameraUrl = body.streamUrl || body.rtspUrl;
                } else if (body.ip) {
                    // Build RTSP URL from individual fields
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

            // Start FFmpeg with the resolved mode and URL
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

    // ── POST /disconnect — Stop the current stream ────────────
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

    // ── GET /index.m3u8 and /index*.ts — Serve HLS files ─────
    // The frontend HLS player requests these files to play the stream.
    // m3u8: playlist file listing available segments
    // ts:   actual video data chunks (2 seconds each)
    if (pathname.endsWith(".m3u8")) {
        Object.assign(corsHeaders, {
            "Content-Type": "application/vnd.apple.mpegurl",
            "Cache-Control": "no-store, no-cache", // Always fetch fresh playlist
        });
    } else if (pathname.endsWith(".ts")) {
        Object.assign(corsHeaders, {
            "Content-Type": "video/MP2T",
            "Cache-Control": "no-store",
        });
    }

    const requestedFile = pathname.replace(/^\/+/, "");
    const filePath = path.join(HLS_DIR, requestedFile);

    // Security: prevent directory traversal (e.g. /../../../etc/passwd)
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

    // Send current state immediately on connect
    // so frontend can restore UI without an extra HTTP call
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