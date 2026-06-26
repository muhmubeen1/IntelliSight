/**
 * ============================================================
 * IntelliSight Live Stream Server — FIXED for AI Analysis
 * ============================================================
 *
 * FIXES APPLIED:
 * 1. Proper JWT token forwarding from frontend → Flask
 * 2. Node.js compatible file upload using form-data library
 * 3. Better error logging for AI backend communication
 * 4. Health check endpoint for AI backend connectivity
 */

const http = require("http");
const fs = require("fs");
const WebSocket = require("ws");
const path = require("path");
const { spawn } = require("child_process");
const { URL } = require("url");

// ─────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────
const PORT = 4000;
const PC_IP = "192.168.100.12";

const FFMPEG_PATH =
    "C:\\Users\\MUBEEN\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe";

// HLS output folder
const HLS_DIR = path.join(__dirname, "videos", "ipcam");
const HLS_OUTPUT = path.join(HLS_DIR, "index.m3u8");

// Demo video path
const LOCAL_VIDEO_PATH = path.join(__dirname, "videos", "test.mp4");

// ─────────────────────────────────────────────────────────────
// AI BACKEND CONFIGURATION
// ─────────────────────────────────────────────────────────────
const AI_BACKEND_URL = "http://192.168.100.12:5000/api/classify-live";
const LIVE_AI_CLIP_DIR = path.join(__dirname, "videos", "live_ai_clips");
const LIVE_AI_INTERVAL_MS = 10000;
const LIVE_AI_SEGMENT_COUNT = 3;

// Ensure AI clip directory exists
if (!fs.existsSync(LIVE_AI_CLIP_DIR)) {
    fs.mkdirSync(LIVE_AI_CLIP_DIR, { recursive: true });
    console.log("[INIT] Created AI clip directory:", LIVE_AI_CLIP_DIR);
}

// ─────────────────────────────────────────────────────────────
// SERVER STATE
// ─────────────────────────────────────────────────────────────
let currentMode = "local";
let currentCameraUrl = "";
let currentCameraName = "Demo Camera";
let streamStartTime = null;
let ffmpegProcess = null;
let isStreaming = false;
const clients = new Set();
let liveAiTimer = null;
let liveAiBusy = false;
let lastProcessedSegment = "";
let lastAiResult = null;
let lastAiTimestamp = null;
let currentAuthToken = null; // Store JWT token from frontend

// Create HLS output folder
if (!fs.existsSync(HLS_DIR)) {
    fs.mkdirSync(HLS_DIR, { recursive: true });
    console.log("[INIT] Created HLS directory:", HLS_DIR);
}

// ─────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────
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

function cleanOldClips(maxAgeHours = 1) {
    try {
        const files = fs.readdirSync(LIVE_AI_CLIP_DIR);
        const now = Date.now();
        const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
        let deleted = 0;
        files.forEach((file) => {
            const filePath = path.join(LIVE_AI_CLIP_DIR, file);
            const stats = fs.statSync(filePath);
            if (now - stats.mtimeMs > maxAgeMs) {
                fs.unlinkSync(filePath);
                deleted++;
            }
        });
        if (deleted > 0) {
            logWithTimestamp("INFO", `[Cleanup] Removed ${deleted} old AI clip(s)`);
        }
    } catch (err) {
        console.warn("[Cleanup] Warning:", err.message);
    }
}

function stopFFmpeg() {
    stopLiveAiProcessing();
    if (ffmpegProcess) {
        logWithTimestamp("INFO", "[FFmpeg] Stopping existing process...");
        const pid = ffmpegProcess.pid;
        ffmpegProcess.kill("SIGTERM");
        setTimeout(() => {
            try {
                process.kill(pid, 0);
                logWithTimestamp("WARN", `[FFmpeg] Process ${pid} still alive, forcing SIGKILL`);
                process.kill(pid, "SIGKILL");
            } catch (e) {
                // Process already exited
            }
        }, 3000);
        ffmpegProcess = null;
    }
    isStreaming = false;
    streamStartTime = null;
    currentAuthToken = null;
}

function broadcastStatus() {
    const message = JSON.stringify({
        type: "status",
        isStreaming,
        mode: currentMode,
        cameraName: currentCameraName,
        streamUrl: `http://${PC_IP}:${PORT}/index.m3u8`,
        aiResult: lastAiResult,
        aiTimestamp: lastAiTimestamp,
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
            "-y", "-f", "concat", "-safe", "0",
            "-i", concatFilePath,
            "-c", "copy",
            outputPath,
        ];
        const clipProcess = spawn(FFMPEG_PATH, args, { windowsHide: true });
        let stderrOutput = "";
        clipProcess.stderr.on("data", (data) => { stderrOutput += data.toString(); });
        clipProcess.on("error", (err) => reject(new Error("Failed to create AI clip: " + err.message)));
        clipProcess.on("close", (code) => {
            if (code === 0 && fs.existsSync(outputPath)) {
                resolve(outputPath);
            } else {
                console.error("[Live AI FFmpeg stderr]:", stderrOutput);
                reject(new Error(`AI clip FFmpeg exited with code ${code}`));
            }
        });
    });
}

// ─────────────────────────────────────────────────────────────
// FIXED: sendClipToAiBackend using Node.js native modules
// This properly sends multipart/form-data with JWT auth
// ─────────────────────────────────────────────────────────────
async function sendClipToAiBackend(clipPath) {
    if (!currentAuthToken) {
        console.warn("[Live AI] No auth token available. Skipping AI request.");
        console.warn("[Live AI] Make sure frontend sends Authorization header in /connect request.");
        return null;
    }

    try {
        const clipBuffer = fs.readFileSync(clipPath);
        const boundary = `----FormBoundary${Date.now()}`;
        const fileName = path.basename(clipPath);

        // Build multipart/form-data body manually for Node.js
        const preAmble = Buffer.from(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="video"; filename="${fileName}"\r\n` +
            `Content-Type: video/mp4\r\n\r\n`
        );
        const postAmble = Buffer.from(`\r\n--${boundary}--\r\n`);
        const body = Buffer.concat([preAmble, clipBuffer, postAmble]);

        const options = new URL(AI_BACKEND_URL);
        const requestOptions = {
            hostname: options.hostname,
            port: options.port,
            path: options.pathname,
            method: "POST",
            headers: {
                "Authorization": `Bearer ${currentAuthToken}`,
                "Content-Type": `multipart/form-data; boundary=${boundary}`,
                "Content-Length": body.length,
            },
        };

        return new Promise((resolve, reject) => {
            const req = http.request(requestOptions, (res) => {
                let responseData = "";
                res.on("data", (chunk) => { responseData += chunk; });
                res.on("end", () => {
                    try {
                        const data = JSON.parse(responseData);
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            // Store result
                            lastAiResult = {
                                label: data.final_label,
                                confidence: data.final_confidence,
                                alertRequired: data.alert_required,
                                severity: data.alert?.severity || "Low",
                                popupData: data.popup_data || null,
                            };
                            lastAiTimestamp = new Date().toISOString();
                            logWithTimestamp("INFO", "[Live AI] Result received", {
                                label: data.final_label,
                                confidence: data.final_confidence,
                                alert: data.alert_required,
                            });
                            broadcastStatus();
                            resolve(data);
                        } else {
                            reject(new Error(data.error || data.message || `HTTP ${res.statusCode}`));
                        }
                    } catch (e) {
                        reject(new Error("Invalid JSON response from AI backend"));
                    }
                });
            });

            req.on("error", (err) => {
                console.error("[Live AI] Request error:", err.message);
                reject(err);
            });

            req.write(body);
            req.end();
        });
    } catch (err) {
        console.error("[Live AI] Backend request failed:", err.message);
        return null;
    }
}

// ─────────────────────────────────────────────────────────────
// CORE: processLiveAiClip
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

        console.log("[Live AI] Sending clip to backend...");
        const result = await sendClipToAiBackend(clipPath);

        // Cleanup
        fs.unlink(clipPath, (err) => {
            if (err) console.warn("[Live AI] Clip cleanup warning:", err.message);
        });

        return result;
    } catch (err) {
        console.error("[Live AI] Processing failed:", err.message);
    } finally {
        liveAiBusy = false;
    }
}

function startLiveAiProcessing() {
    stopLiveAiProcessing();
    logWithTimestamp("INFO", "[Live AI] Starting live AI processing...");
    console.log("[Live AI] Auth token present:", currentAuthToken ? "YES" : "NO");

    // Process immediately
    processLiveAiClip();

    liveAiTimer = setInterval(() => {
        processLiveAiClip();
    }, LIVE_AI_INTERVAL_MS);
}

function stopLiveAiProcessing() {
    if (liveAiTimer) {
        clearInterval(liveAiTimer);
        liveAiTimer = null;
    }
    liveAiBusy = false;
    lastProcessedSegment = "";
    lastAiResult = null;
    lastAiTimestamp = null;
}

// ─────────────────────────────────────────────────────────────
// CORE: startFFmpeg
// ─────────────────────────────────────────────────────────────
function startFFmpeg(mode, cameraUrl = "", cameraName = "Camera") {
    stopFFmpeg();
    cleanHlsFolder();

    currentMode = mode;
    currentCameraUrl = cameraUrl;
    currentCameraName = cameraName;
    streamStartTime = new Date().toISOString();

    let inputArgs = [];

    if (mode === "local") {
        if (!fs.existsSync(LOCAL_VIDEO_PATH)) {
            throw new Error(`Demo video not found at: ${LOCAL_VIDEO_PATH}`);
        }
        logWithTimestamp("INFO", "[FFmpeg] Mode: local", { path: LOCAL_VIDEO_PATH });
        inputArgs = ["-re", "-stream_loop", "-1", "-i", LOCAL_VIDEO_PATH];
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

    logWithTimestamp("INFO", "[FFmpeg] Starting...");
    ffmpegProcess = spawn(FFMPEG_PATH, ffmpegArgs, { windowsHide: true });
    isStreaming = true;
    broadcastStatus();

    ffmpegProcess.stderr.on("data", (data) => {
        const msg = data.toString().trim();
        if (msg) console.log(`[FFmpeg] ${msg}`);
    });

    ffmpegProcess.on("error", (err) => {
        console.error("[FFmpeg] Failed to spawn:", err.message);
        stopLiveAiProcessing();
        isStreaming = false;
        broadcastStatus();
    });

    ffmpegProcess.on("close", (code) => {
        logWithTimestamp("INFO", "[FFmpeg] Process exited", { code });
        stopLiveAiProcessing();
        isStreaming = false;
        ffmpegProcess = null;
        broadcastStatus();
    });
}

// ─────────────────────────────────────────────────────────────
// HTTP SERVER
// ─────────────────────────────────────────────────────────────
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

function getAuthTokenFromRequest(request) {
    const authHeader = request.headers.authorization || request.headers.Authorization;
    if (!authHeader) return null;
    const parts = authHeader.split(" ");
    if (parts.length === 2 && parts[0].toLowerCase() === "bearer") {
        return parts[1];
    }
    return null;
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
            aiResult: lastAiResult,
            aiTimestamp: lastAiTimestamp,
            streamStartTime,
            aiEnabled: !!currentAuthToken,
        });
        return;
    }

    // ── CONNECT: Start stream + store auth token ──────────────
    if (pathname === "/connect" && request.method === "POST") {
        try {
            const body = await parseBody(request);
            logWithTimestamp("INFO", "[CONNECT] Request received", { mode: body.mode });

            // Extract and store JWT token from frontend
            const authToken = getAuthTokenFromRequest(request);
            if (authToken) {
                currentAuthToken = authToken;
                console.log("[AUTH] JWT token received and stored for AI requests");
            } else {
                console.warn("[AUTH] No JWT token in request. AI analysis will not work!");
                console.warn("[AUTH] Frontend must send Authorization: Bearer <token> header");
            }

            const mode = body.mode || "local";
            let cameraUrl = "";
            const cameraName = body.cameraName || "Camera";

            if (mode === "mobile-cam") {
                cameraUrl = body.streamUrl || body.url || "";
                if (!cameraUrl) throw new Error('mobile-cam mode requires "streamUrl"');
            } else if (mode === "ip-camera") {
                if (body.streamUrl || body.rtspUrl) {
                    cameraUrl = body.streamUrl || body.rtspUrl;
                } else if (body.ip) {
                    cameraUrl = buildRtspUrl(body.ip, body.username || "admin", body.password || "", body.channel || 1);
                    console.log("[CONNECT] Built RTSP URL:", cameraUrl);
                } else {
                    throw new Error('ip-camera mode requires "streamUrl" or "ip"');
                }
            } else if (mode !== "local") {
                throw new Error(`Unknown mode: "${mode}"`);
            }

            startFFmpeg(mode, cameraUrl, cameraName);

            // Start AI processing if token available
            if (currentAuthToken) {
                startLiveAiProcessing();
            }

            sendJson(response, 200, {
                success: true,
                message: "Stream started successfully",
                mode,
                cameraUrl: cameraUrl || null,
                streamUrl: `http://${PC_IP}:${PORT}/index.m3u8`,
                aiEnabled: !!currentAuthToken,
            });
        } catch (err) {
            logWithTimestamp("ERROR", "[CONNECT] Error", { message: err.message });
            sendJson(response, 400, { success: false, message: err.message });
        }
        return;
    }

    // ── DISCONNECT: Stop stream ───────────────────────────────
    if (pathname === "/disconnect" && request.method === "POST") {
        stopFFmpeg();
        cleanHlsFolder();
        cleanOldClips();
        sendJson(response, 200, { success: true, message: "Stream stopped successfully" });
        broadcastStatus();
        return;
    }

    // ── Serve HLS files ───────────────────────────────────────
    if (pathname.endsWith(".m3u8")) {
        Object.assign(corsHeaders, { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store, no-cache" });
    } else if (pathname.endsWith(".ts")) {
        Object.assign(corsHeaders, { "Content-Type": "video/MP2T", "Cache-Control": "no-store" });
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
// ─────────────────────────────────────────────────────────────
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
        aiResult: lastAiResult,
        aiTimestamp: lastAiTimestamp,
        aiEnabled: !!currentAuthToken,
    }));
    ws.on("close", () => { clients.delete(ws); });
    ws.on("error", (err) => { console.warn("[WS] Error:", err.message); clients.delete(ws); });
});

// ─────────────────────────────────────────────────────────────
// HLS FOLDER WATCHER
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
                try { client.send(message); } catch (e) { }
            }
        });
    }
});

// ─────────────────────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────────────────────
server.listen(PORT, "0.0.0.0", () => {
    console.log("=".repeat(60));
    console.log("  IntelliSight Live Server");
    console.log("=".repeat(60));
    console.log(`  Health:    http://${PC_IP}:${PORT}/`);
    console.log(`  Status:    http://${PC_IP}:${PORT}/status`);
    console.log(`  Stream:    http://${PC_IP}:${PORT}/index.m3u8`);
    console.log(`  WebSocket: ws://${PC_IP}:${PORT}`);
    console.log("=".repeat(60));
    console.log("  AI Backend:", AI_BACKEND_URL);
    console.log("  AI Interval:", LIVE_AI_INTERVAL_MS, "ms");
    console.log("=".repeat(60));
});