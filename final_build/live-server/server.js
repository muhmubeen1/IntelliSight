const http = require("http");
const fs = require("fs");
const WebSocket = require("ws");
const path = require("path");
const { spawn } = require("child_process");

const PORT = 4000;
const PC_IP = "192.168.100.12";

// Full path of FFmpeg installed on your system
const FFMPEG_PATH =
    "C:\\Users\\MUBEEN\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe";

// HLS output folder
const HLS_DIR = path.join(__dirname, "videos", "ipcam");
const HLS_OUTPUT = path.join(HLS_DIR, "index.m3u8");

// Local demo video path
const LOCAL_VIDEO_PATH = path.join(__dirname, "videos", "test.mp4");

// OBS Virtual Camera device name
const OBS_CAMERA_NAME = "OBS Virtual Camera";

let currentMode = "local";
let ffmpegProcess = null;
let isStreaming = false;
let clients = new Set();

// Create HLS folder if missing
if (!fs.existsSync(HLS_DIR)) {
    fs.mkdirSync(HLS_DIR, { recursive: true });
}

/*
  Remove old .m3u8 and .ts files before starting a new stream.
  This prevents browser/frontend from loading old HLS segments.
*/
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

/*
  Stop existing FFmpeg process before starting another stream.
*/
function stopFFmpeg() {
    if (ffmpegProcess) {
        console.log("Stopping existing FFmpeg process...");
        ffmpegProcess.kill("SIGTERM");
        ffmpegProcess = null;
    }

    isStreaming = false;
}

/*
  Send current stream status to all WebSocket clients.
*/
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

/*
  Main FFmpeg starter.

  Supported modes:
  1. local  -> videos/test.mp4
  2. obs    -> OBS Virtual Camera
  3. rtsp   -> RTSP stream if needed later
*/
function startFFmpeg(mode, cameraUrl = "") {
    stopFFmpeg();
    cleanHlsFolder();

    currentMode = mode;

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
    } else if (mode === "obs" || mode === "rtsp") {
        /*
          IMPORTANT:
          For OBS Virtual Camera, do NOT add streamUrl after this.
          Your old code had extra streamUrl values, which broke FFmpeg.
        */
        inputArgs = [
            "-f",
            "dshow",
            "-rtbufsize",
            "100M",
            "-i",
            `video=${OBS_CAMERA_NAME}`,
        ];
    } else if (mode === "direct-rtsp") {
        if (!cameraUrl) {
            throw new Error("RTSP URL is empty.");
        }

        inputArgs = [
            "-rtsp_transport",
            "tcp",
            "-i",
            cameraUrl,
        ];
    } else {
        throw new Error("Invalid mode. Use local, obs, rtsp, or direct-rtsp.");
    }

    const ffmpegArgs = [
        "-loglevel",
        "verbose",

        ...inputArgs,

        // Disable audio
        "-an",

        // Encode video for HLS
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-tune",
        "zerolatency",

        // HLS output settings
        "-f",
        "hls",
        "-hls_time",
        "1",
        "-hls_list_size",
        "5",
        "-hls_flags",
        "delete_segments+append_list",

        // Force segment naming
        "-hls_segment_filename",
        path.join(HLS_DIR, "index%d.ts"),

        HLS_OUTPUT,
    ];

    console.log("Starting FFmpeg in mode:", mode);
    console.log("FFmpeg Command:", FFMPEG_PATH, ffmpegArgs.join(" "));

    ffmpegProcess = spawn(FFMPEG_PATH, ffmpegArgs, {
        windowsHide: true,
    });

    isStreaming = true;
    broadcastStatus();

    ffmpegProcess.stderr.on("data", (data) => {
        console.log(`FFmpeg: ${data.toString()}`);
    });

    ffmpegProcess.on("error", (err) => {
        console.error("FFmpeg spawn error:", err.message);
        isStreaming = false;
        broadcastStatus();
    });

    ffmpegProcess.on("close", (code) => {
        console.log(`FFmpeg exited with code ${code}`);
        isStreaming = false;
        broadcastStatus();
    });
}

/*
  JSON response helper
*/
function sendJson(response, statusCode, data) {
    response.writeHead(statusCode, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers": "Content-Type",
    });

    response.end(JSON.stringify(data));
}

/*
  Read POST JSON body
*/
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

const server = http.createServer(async (request, response) => {
    console.log("REQUEST:", request.method, request.url);

    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": 2592000,
    };

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
            streamUrl: `http://${PC_IP}:${PORT}/index.m3u8`,
        });
        return;
    }

    /*
      Connect stream.
  
      For OBS workflow, frontend can send:
      {
        "mode": "obs"
      }
  
      Even if frontend sends rtsp mode, this code currently uses OBS camera
      for rtsp mode also, because we are now testing OBS Virtual Camera.
    */
    if (pathname === "/connect" && request.method === "POST") {
        try {
            const body = await parseBody(request);
            console.log("CONNECT BODY:", body);

            const mode = body.mode || "obs";
            const cameraUrl =
                body.rtspUrl ||
                body.cameraUrl ||
                body.cameraIp ||
                body.ipAddress ||
                body.ip ||
                body.url ||
                body.streamUrl ||
                "";

            startFFmpeg(mode, cameraUrl);

            sendJson(response, 200, {
                message: "Stream started successfully",
                mode,
                streamUrl: `http://${PC_IP}:${PORT}/index.m3u8`,
            });
        } catch (err) {
            console.log("CONNECT ERROR:", err.message);
            sendJson(response, 400, { message: err.message });
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

    /*
      Serve HLS files:
      /index.m3u8
      /index0.ts
      /index1.ts
      etc.
    */
    if (pathname.endsWith(".m3u8")) {
        headers["Content-Type"] = "application/vnd.apple.mpegurl";
        headers["Cache-Control"] = "no-store";
    } else if (pathname.endsWith(".ts")) {
        headers["Content-Type"] = "video/MP2T";
        headers["Cache-Control"] = "no-store";
    }

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

const wss = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
    console.log("New WebSocket client connected");

    clients.add(ws);

    ws.send(
        JSON.stringify({
            type: "status",
            isStreaming,
            mode: currentMode,
            streamUrl: `http://${PC_IP}:${PORT}/index.m3u8`,
        })
    );

    ws.on("close", () => {
        console.log("WebSocket client disconnected");
        clients.delete(ws);
    });
});

/*
  Notify frontend when new HLS segments are created.
*/
fs.watch(HLS_DIR, (eventType, filename) => {
    if (filename && filename.endsWith(".ts")) {
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

server.listen(PORT, "0.0.0.0", () => {
    console.log(`IntelliSight Live Server running on PORT ${PORT}`);
    console.log(`Health: http://${PC_IP}:${PORT}/`);
    console.log(`Status: http://${PC_IP}:${PORT}/status`);
    console.log(`Stream: http://${PC_IP}:${PORT}/index.m3u8`);
    console.log(`WebSocket: ws://${PC_IP}:${PORT}`);
});