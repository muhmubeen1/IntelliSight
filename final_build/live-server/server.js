// ===============================
// IntelliSight Live Streaming Server
// Supports:
// 1. Local demo video streaming
// 2. RTSP IP camera streaming
// 3. HLS output for browser/mobile app
// 4. WebSocket updates for frontend
// ===============================

const http = require("http");
const fs = require("fs");
const WebSocket = require("ws");
const path = require("path");
const { spawn } = require("child_process");

const PORT = 4000;

// Full FFmpeg path on your Windows system
const FFMPEG_PATH =
    "C:\\Users\\MUBEEN\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe";

// Folder where HLS files will be generated
const HLS_DIR = path.join(__dirname, "videos", "ipcam");

// Main HLS playlist file
const HLS_OUTPUT = path.join(HLS_DIR, "index.m3u8");

// Local demo video path
const LOCAL_VIDEO_PATH = path.join(__dirname, "videos", "test.mp4");

// Current stream state
let currentMode = "local";
let currentRtspUrl = "";
let ffmpegProcess = null;
let isStreaming = false;

// Create HLS folder if it does not exist
if (!fs.existsSync(HLS_DIR)) {
    fs.mkdirSync(HLS_DIR, { recursive: true });
}

// ===============================
// Clean old HLS files
// Deletes previous .m3u8 and .ts files
// ===============================

function cleanHlsFolder() {
    try {
        const files = fs.readdirSync(HLS_DIR);

        files.forEach((file) => {
            if (file.endsWith(".ts") || file.endsWith(".m3u8")) {
                fs.unlinkSync(path.join(HLS_DIR, file));
            }
        });

        console.log("Old HLS files cleaned");
    } catch (err) {
        console.log("Clean error:", err.message);
    }
}

// ===============================
// Broadcast status to all WebSocket clients
// ===============================

function broadcastStatus() {
    const message = JSON.stringify({
        type: "status",
        isStreaming,
        mode: currentMode,

        // IMPORTANT:
        // Frontend should use PC IP instead of localhost.
        // This is still kept as localhost for server-side status.
        streamUrl: `http://localhost:${PORT}/index.m3u8`,
    });

    clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// ===============================
// Stop FFmpeg stream
// ===============================

function stopFFmpeg() {
    if (ffmpegProcess) {
        console.log("Stopping existing FFmpeg process...");
        ffmpegProcess.kill("SIGTERM");
        ffmpegProcess = null;
    }

    isStreaming = false;
}

// ===============================
// Start FFmpeg stream
// mode = local or rtsp
// rtspUrl = camera URL if mode is rtsp
// ===============================

function startFFmpeg(mode, rtspUrl) {
    stopFFmpeg();
    cleanHlsFolder();

    currentMode = mode;
    currentRtspUrl = rtspUrl || "";

    let inputArgs = [];

    if (mode === "local") {
        if (!fs.existsSync(LOCAL_VIDEO_PATH)) {
            throw new Error("Local test video not found. Put video at videos/test.mp4");
        }

        inputArgs = [
            "-re",
            "-stream_loop",
            "-1",
            "-i",
            LOCAL_VIDEO_PATH,
        ];
    } else if (mode === "rtsp") {
        if (!rtspUrl) {
            throw new Error("RTSP URL is required");
        }

        inputArgs = [
            "-rtsp_transport",
            "tcp",
            "-i",
            rtspUrl,
        ];
    } else {
        throw new Error("Invalid mode. Use local or rtsp");
    }

    const ffmpegArgs = [
        ...inputArgs,

        "-c:v",
        "libx264",

        "-preset",
        "veryfast",

        "-tune",
        "zerolatency",

        "-f",
        "hls",

        "-hls_time",
        "2",

        "-hls_list_size",
        "5",

        "-hls_flags",
        "delete_segments",

        HLS_OUTPUT,
    ];

    console.log("Starting FFmpeg in mode:", mode);

    ffmpegProcess = spawn(FFMPEG_PATH, ffmpegArgs);
    isStreaming = true;

    ffmpegProcess.stderr.on("data", (data) => {
        console.log(`FFmpeg: ${data}`);
    });

    ffmpegProcess.on("error", (err) => {
        console.error("FFmpeg error:", err.message);
        isStreaming = false;
        broadcastStatus();
    });

    ffmpegProcess.on("close", (code) => {
        console.log(`FFmpeg exited with code ${code}`);
        isStreaming = false;
        broadcastStatus();
    });

    broadcastStatus();
}

// ===============================
// Send JSON response
// ===============================

function sendJson(response, statusCode, data) {
    response.writeHead(statusCode, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers": "Content-Type",
    });

    response.end(JSON.stringify(data));
}

// ===============================
// Parse JSON body from POST request
// ===============================

function parseBody(request) {
    return new Promise((resolve, reject) => {
        let body = "";

        request.on("data", (chunk) => {
            body += chunk.toString();
        });

        request.on("end", () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (err) {
                reject(err);
            }
        });
    });
}

// ===============================
// HTTP Server
// Handles:
// GET /
// GET /status
// POST /connect
// POST /disconnect
// GET /index.m3u8
// GET /.ts files
// ===============================

const server = http.createServer(async (request, response) => {
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": 2592000,
    };

    // ===============================
    // IMPORTANT FIX:
    // request.url may contain query params:
    // /index.m3u8?t=123
    // /index.m3u8?check=123
    //
    // If we use request.url directly, Node tries to find:
    // index.m3u8?t=123
    //
    // That file does not exist, so server returns 404.
    //
    // pathname removes query params and gives only:
    // /index.m3u8
    // ===============================
    const parsedUrl = new URL(request.url, `http://${request.headers.host}`);
    const pathname = parsedUrl.pathname;

    if (request.method === "OPTIONS") {
        response.writeHead(204, headers);
        response.end();
        return;
    }

    if (pathname === "/") {
        response.writeHead(200, {
            "Content-Type": "text/plain",
            "Access-Control-Allow-Origin": "*",
        });

        response.end("IntelliSight Live Server Running");
        return;
    }

    if (pathname === "/status" && request.method === "GET") {
        sendJson(response, 200, {
            isStreaming,
            mode: currentMode,
            streamUrl: `http://localhost:${PORT}/index.m3u8`,
        });

        return;
    }

    if (pathname === "/connect" && request.method === "POST") {
        try {
            const body = await parseBody(request);

            const mode = body.mode || "local";
            const rtspUrl = body.rtspUrl || "";

            startFFmpeg(mode, rtspUrl);

            sendJson(response, 200, {
                message: "Stream started successfully",
                mode,
                streamUrl: `http://localhost:${PORT}/index.m3u8`,
            });
        } catch (err) {
            sendJson(response, 400, {
                message: err.message,
            });
        }

        return;
    }

    if (pathname === "/disconnect" && request.method === "POST") {
        stopFFmpeg();
        cleanHlsFolder();

        sendJson(response, 200, {
            message: "Stream stopped successfully",
        });

        broadcastStatus();
        return;
    }

    if (pathname.endsWith(".m3u8")) {
        headers["Content-Type"] = "application/vnd.apple.mpegurl";
    } else if (pathname.endsWith(".ts")) {
        headers["Content-Type"] = "video/MP2T";
    }

    // ===============================
    // Serve HLS files from:
    // live-server/videos/ipcam
    //
    // Browser requests:
    // /index.m3u8
    // /index0.ts
    //
    // We remove the first slash so:
    // /index.m3u8 -> index.m3u8
    //
    // Final file path becomes:
    // live-server/videos/ipcam/index.m3u8
    // ===============================
    const requestedFile = pathname.replace(/^\/+/, "");
    const filePath = path.join(HLS_DIR, requestedFile);

    fs.readFile(filePath, (error, content) => {
        if (error) {
            response.writeHead(404, headers);
            response.end("File not found");
            return;
        }

        response.writeHead(200, headers);
        response.end(content);
    });
});

// ===============================
// WebSocket Server
// Sends status and segment updates to frontend
// ===============================

const wss = new WebSocket.Server({ server });
const clients = new Set();

wss.on("connection", (ws) => {
    console.log("New WebSocket client connected");

    clients.add(ws);

    ws.send(JSON.stringify({
        type: "status",
        isStreaming,
        mode: currentMode,
        streamUrl: `http://localhost:${PORT}/index.m3u8`,
    }));

    ws.on("close", () => {
        console.log("WebSocket client disconnected");
        clients.delete(ws);
    });
});

// ===============================
// Watch HLS folder for new .ts segments
// Sends update to frontend whenever new segment is created
// ===============================

fs.watch(HLS_DIR, (eventType, filename) => {
    if (filename && filename.endsWith(".ts")) {
        const message = JSON.stringify({
            type: "segment",
            segment: filename,
            streamUrl: `http://localhost:${PORT}/index.m3u8`,
        });

        clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }
});

// ===============================
// Start server
// ===============================

server.listen(PORT, () => {
    console.log(`IntelliSight Live Server running on PORT ${PORT}`);
    console.log(`Health: http://localhost:${PORT}/`);
    console.log(`Status: http://localhost:${PORT}/status`);
    console.log(`Stream: http://localhost:${PORT}/index.m3u8`);
    console.log(`WebSocket: ws://localhost:${PORT}`);
});