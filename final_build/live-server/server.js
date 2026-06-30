/**
 * ============================================================
 * IntelliSight Live Stream Server
 * ============================================================
 *
 * Responsibilities:
 *   1. Accept camera connect/disconnect requests from frontend
 *   2. Run FFmpeg to convert camera feed → HLS segments
 *   3. Serve HLS files to the React frontend player
 *   4. Notify Flask to start/stop its background AI analysis thread
 *   5. Broadcast stream status to WebSocket clients
 *
 * AI analysis is handled entirely by Flask's background thread.
 * This server just signals Flask when to start and stop.
 */

const http = require("http");
const fs = require("fs");
const WebSocket = require("ws");
const path = require("path");
const { spawn } = require("child_process");
const { URL } = require("url");

// =============================================================================
// CONFIGURATION
// =============================================================================

const PORT = 4000;
const PC_IP = "192.168.100.12";

const FFMPEG_PATH =
    "C:\\Users\\MUBEEN\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe";

// Flask AI backend base URL — used only for start/stop signals
const FLASK_URL = "http://127.0.0.1:5000";

// HLS output folder
const HLS_DIR = path.join(__dirname, "videos", "ipcam");
const HLS_OUTPUT = path.join(HLS_DIR, "index.m3u8");

// Demo video path
const LOCAL_VIDEO_PATH = path.join(__dirname, "videos", "test.mp4");

// Demo class video paths
const DEMO_VIDEO_PATHS = {
    normal: path.join(__dirname, "videos", "demos", "normal.mp4"),
    fighting: path.join(__dirname, "videos", "demos", "fighting.mp4"),
    shooting: path.join(__dirname, "videos", "demos", "shooting.mp4"),
    roadaccident: path.join(__dirname, "videos", "demos", "roadaccident.mp4"),
    burglary: path.join(__dirname, "videos", "demos", "burglary.mp4"),
};

// Ensure HLS folder exists
if (!fs.existsSync(HLS_DIR)) {
    fs.mkdirSync(HLS_DIR, { recursive: true });
    console.log("[INIT] Created HLS directory:", HLS_DIR);
}

// =============================================================================
// SERVER STATE
// =============================================================================

let currentMode = "local";
let currentCameraUrl = "";
let currentCameraName = "Demo Camera";
let streamStartTime = null;
let ffmpegProcess = null;
let isStreaming = false;
const clients = new Set();

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function logWithTimestamp(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const metaStr = Object.keys(meta).length > 0 ? JSON.stringify(meta) : "";
    console.log(`[${timestamp}] [${level}] ${message} ${metaStr}`);
}

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
        logWithTimestamp("INFO", `[HLS] Cleaned ${deleted} old segment(s)`);
    } catch (err) {
        console.warn("[HLS] Clean warning:", err.message);
    }
}

function broadcastStatus() {
    const message = JSON.stringify({
        type: "status",
        isStreaming,
        mode: currentMode,
        cameraName: currentCameraName,
        streamUrl: `http://${PC_IP}:${PORT}/index.m3u8`,
        streamStartTime,
    });
    clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(message);
            } catch (err) {
                console.warn("[WS] Failed to send:", err.message);
                clients.delete(client);
            }
        }
    });
}

function buildRtspUrl(ip, username = "admin", password = "", channel = 1) {
    const channelCode = `${channel}01`;
    return `rtsp://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${ip}:554/Streaming/Channels/${channelCode}`;
}

// =============================================================================
// FLASK NOTIFICATION HELPERS
// =============================================================================

function notifyFlaskStart() {
    const options = {
        hostname: "127.0.0.1",
        port: 5000,
        path: "/api/live-analysis/start",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": 0 },
    };

    const req = http.request(options, (res) => {
        logWithTimestamp("INFO", `[FLASK] Analysis start notified — HTTP ${res.statusCode}`);
    });

    req.on("error", (err) => {
        console.warn("[FLASK] Could not notify start:", err.message);
    });

    req.end();
}

function notifyFlaskStop() {
    const options = {
        hostname: "127.0.0.1",
        port: 5000,
        path: "/api/live-analysis/stop",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": 0 },
    };

    const req = http.request(options, (res) => {
        logWithTimestamp("INFO", `[FLASK] Analysis stop notified — HTTP ${res.statusCode}`);
    });

    req.on("error", (err) => {
        console.warn("[FLASK] Could not notify stop:", err.message);
    });

    req.end();
}

// =============================================================================
// FFMPEG LIFECYCLE
// =============================================================================

function stopFFmpeg() {
    if (isStreaming) {
        notifyFlaskStop();
    }

    if (ffmpegProcess) {
        logWithTimestamp("INFO", "[FFmpeg] Stopping existing process...");
        const pid = ffmpegProcess.pid;
        ffmpegProcess.kill("SIGTERM");

        setTimeout(() => {
            try {
                process.kill(pid, 0);
                logWithTimestamp("WARN", `[FFmpeg] PID ${pid} still alive — forcing SIGKILL`);
                process.kill(pid, "SIGKILL");
            } catch (e) {
                // Already exited
            }
        }, 3000);

        ffmpegProcess = null;
    }

    isStreaming = false;
    streamStartTime = null;
}

function startFFmpeg(mode, cameraUrl = "", cameraName = "Camera") {
    stopFFmpeg();
    cleanHlsFolder();

    currentMode = mode;
    currentCameraUrl = cameraUrl;
    currentCameraName = cameraName;
    streamStartTime = new Date().toISOString();

    let inputArgs = [];

    if (mode === "local") {
        const demoType = cameraUrl || "normal";
        const selectedVideoPath = DEMO_VIDEO_PATHS[demoType] || LOCAL_VIDEO_PATH;

        if (!fs.existsSync(selectedVideoPath)) {
            throw new Error(`Demo video not found at: ${selectedVideoPath}`);
        }

        logWithTimestamp("INFO", "[FFmpeg] Mode: local demo", {
            demoType,
            path: selectedVideoPath,
        });

        inputArgs = ["-re", "-stream_loop", "-1", "-i", selectedVideoPath];

    } else if (mode === "mobile-cam") {
        if (!cameraUrl) throw new Error("Mobile camera URL is required.");
        logWithTimestamp("INFO", "[FFmpeg] Mode: mobile-cam", { url: cameraUrl });
        inputArgs = ["-fflags", "nobuffer+genpts", "-flags", "low_delay", "-i", cameraUrl];

    } else if (mode === "ip-camera") {
        if (!cameraUrl) throw new Error("IP camera RTSP URL is required.");
        logWithTimestamp("INFO", "[FFmpeg] Mode: ip-camera", { url: cameraUrl });
        inputArgs = ["-rtsp_transport", "tcp", "-fflags", "nobuffer", "-i", cameraUrl];

    } else {
        throw new Error(`Unknown mode: "${mode}"`);
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

    logWithTimestamp("INFO", "[FFmpeg] Spawning process...");
    ffmpegProcess = spawn(FFMPEG_PATH, ffmpegArgs, { windowsHide: true });
    isStreaming = true;
    broadcastStatus();

    ffmpegProcess.stderr.on("data", (data) => {
        const msg = data.toString().trim();
        if (msg) console.log(`[FFmpeg] ${msg}`);
    });

    ffmpegProcess.on("error", (err) => {
        console.error("[FFmpeg] Failed to spawn:", err.message);
        isStreaming = false;
        broadcastStatus();
        notifyFlaskStop();
    });

    ffmpegProcess.on("close", (code) => {
        logWithTimestamp("INFO", "[FFmpeg] Process exited", { code });
        isStreaming = false;
        ffmpegProcess = null;
        broadcastStatus();
        notifyFlaskStop();
    });

    setTimeout(() => {
        notifyFlaskStart();
    }, 4000);
}

// =============================================================================
// HTTP SERVER
// =============================================================================

function sendJson(response, statusCode, data) {
    response.writeHead(statusCode, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    response.end(JSON.stringify(data));
}

function parseBody(request) {
    return new Promise((resolve, reject) => {
        let body = "";
        request.on("data", (chunk) => { body += chunk.toString(); });
        request.on("end", () => {
            try { resolve(body ? JSON.parse(body) : {}); }
            catch (err) { reject(new Error("Invalid JSON")); }
        });
        request.on("error", (err) => reject(err));
    });
}

const server = http.createServer(async (request, response) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [HTTP] ${request.method} ${request.url}`);

    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
        response.writeHead(200, { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" });
        response.end("IntelliSight Live Server Running ✓");
        return;
    }

    if (pathname === "/status" && request.method === "GET") {
        sendJson(response, 200, {
            isStreaming,
            mode: currentMode,
            cameraName: currentCameraName,
            streamUrl: `http://${PC_IP}:${PORT}/index.m3u8`,
            streamStartTime,
        });
        return;
    }

    if (pathname === "/connect" && request.method === "POST") {
        try {
            const body = await parseBody(request);
            const mode = body.mode || "local";
            const cameraName = body.cameraName || "Camera";

            logWithTimestamp("INFO", "[CONNECT] Request received", { mode, cameraName });

            let cameraUrl = "";

            if (mode === "local") {
                cameraUrl = body.demoType || "normal";

            } else if (mode === "mobile-cam") {
                cameraUrl = body.streamUrl || body.url || "";
                if (!cameraUrl) throw new Error('mobile-cam mode requires "streamUrl"');

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
                    throw new Error('ip-camera mode requires "streamUrl" or "ip"');
                }

            } else {
                throw new Error(`Unknown mode: "${mode}"`);
            }

            startFFmpeg(mode, cameraUrl, cameraName);

            sendJson(response, 200, {
                success: true,
                message: "Stream started successfully",
                mode,
                cameraUrl: cameraUrl || null,
                streamUrl: `http://${PC_IP}:${PORT}/index.m3u8`,
            });

        } catch (err) {
            logWithTimestamp("ERROR", "[CONNECT] Error", { message: err.message });
            sendJson(response, 400, { success: false, message: err.message });
        }
        return;
    }

    if (pathname === "/disconnect" && request.method === "POST") {
        stopFFmpeg();
        cleanHlsFolder();
        sendJson(response, 200, { success: true, message: "Stream stopped successfully" });
        broadcastStatus();
        return;
    }

    const fileHeaders = { ...corsHeaders };

    if (pathname.endsWith(".m3u8")) {
        fileHeaders["Content-Type"] = "application/vnd.apple.mpegurl";
        fileHeaders["Cache-Control"] = "no-store, no-cache";
    } else if (pathname.endsWith(".ts")) {
        fileHeaders["Content-Type"] = "video/MP2T";
        fileHeaders["Cache-Control"] = "no-store";
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
        response.writeHead(200, fileHeaders);
        response.end(content);
    });
});

// =============================================================================
// WEBSOCKET SERVER
// =============================================================================

const wss = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
    logWithTimestamp("INFO", "[WS] New client connected");
    clients.add(ws);

    ws.send(JSON.stringify({
        type: "status",
        isStreaming,
        mode: currentMode,
        cameraName: currentCameraName,
        streamUrl: `http://${PC_IP}:${PORT}/index.m3u8`,
        streamStartTime,
    }));

    ws.on("close", () => { clients.delete(ws); });
    ws.on("error", (err) => {
        console.warn("[WS] Error:", err.message);
        clients.delete(ws);
    });
});

// =============================================================================
// HLS FOLDER WATCHER — broadcasts new segment events to WebSocket clients
// =============================================================================

fs.watch(HLS_DIR, (eventType, filename) => {
    if (filename && filename.endsWith(".ts") && eventType === "rename") {
        const message = JSON.stringify({
            type: "segment",
            segment: filename,
            streamUrl: `http://${PC_IP}:${PORT}/index.m3u8`,
        });
        clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                try { client.send(message); } catch (e) { /* ignore */ }
            }
        });
    }
});

// =============================================================================
// START SERVER
// =============================================================================

server.listen(PORT, "0.0.0.0", () => {
    console.log("=".repeat(60));
    console.log("  IntelliSight Live Server");
    console.log("=".repeat(60));
    console.log(`  Health:    http://${PC_IP}:${PORT}/`);
    console.log(`  Status:    http://${PC_IP}:${PORT}/status`);
    console.log(`  Stream:    http://${PC_IP}:${PORT}/index.m3u8`);
    console.log(`  WebSocket: ws://${PC_IP}:${PORT}`);
    console.log("=".repeat(60));
    console.log(`  Flask:     ${FLASK_URL}`);
    console.log("=".repeat(60));
});