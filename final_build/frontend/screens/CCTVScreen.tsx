/**
 * ============================================================
 * CCTVScreen.tsx — IntelliSight Live Surveillance Screen
 * ============================================================
 *
 * PURPOSE:
 *   Displays a live camera feed from one of three sources:
 *     1. Demo video  (local test.mp4 on the server)
 *     2. Mobile cam  (phone running IP Webcam app)
 *     3. IP camera   (real CCTV camera on the LAN)
 *
 *   Also shows real-time AI classification results overlaid
 *   on the video feed (anomaly detection from Python backend).
 *
 * UI DESIGN: unchanged from original
 * LOGIC:     rewritten for production reliability
 * ============================================================
 */

import { Ionicons } from "@expo/vector-icons";
import { AVPlaybackStatus, ResizeMode, Video } from "expo-av";
import Hls from "hls.js";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { getLiveStreamStatus } from "../api";
import { CAMERAS } from "../config/streams";

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

/** Python AI inference server */
const API_URL = "http://192.168.100.12:5000";

/** Node.js live stream server */
const LIVE_SERVER_URL = "http://192.168.100.12:4000";

// UI colors — unchanged from original
const NEON_GREEN = "#10B952";
const DARK_BG = "#050705";
const MUTED_GREEN = "#8A9A8D";
const ALERT_RED = "#ff3333";

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

/**
 * StreamMode defines which camera source the user has selected.
 *
 *   local      → loop the demo video (test.mp4) stored on the server
 *   mobile-cam → connect to phone running IP Webcam app via HTTP MJPEG
 *   ip-camera  → connect to real CCTV camera via RTSP on the LAN
 */
type StreamMode = "local" | "mobile-cam" | "ip-camera";

// ─────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────
export default function CCTVScreen() {

  // ── Camera node selection (the grid at the bottom) ─────────
  const [selectedCamera, setSelectedCamera] = useState(1);

  // ── Loading / error state ───────────────────────────────────
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Stream state ────────────────────────────────────────────
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamUrl, setStreamUrl] = useState(`${LIVE_SERVER_URL}/index.m3u8`);

  // ── Modal (connect camera dialog) ──────────────────────────
  const [modalVisible, setModalVisible] = useState(false);

  // ── Form fields inside the modal ───────────────────────────
  const [cameraName, setCameraName] = useState("Main Entrance Camera");

  /**
   * mode: which source the user selected in the modal
   * Defaults to "local" so demo works out of the box.
   */
  const [mode, setMode] = useState<StreamMode>("local");

  /**
   * mobileStreamUrl: URL entered by the user for mobile-cam mode
   * Example: http://192.168.100.21:8080/video
   */
  const [mobileStreamUrl, setMobileStreamUrl] = useState(
    "http://192.168.100.21:8080/video"
  );

  /**
   * ipAddress: camera IP entered by the user for ip-camera mode
   * Example: 192.168.1.64
   */
  const [ipAddress, setIpAddress] = useState("");
  const [ipUsername, setIpUsername] = useState("admin");
  const [ipPassword, setIpPassword] = useState("");

  // ── AI classification result overlay ───────────────────────
  const [classification, setClassification] = useState<{
    result: string;
    confidence: number;
    timestamp: number;
  } | null>(null);

  // ── Video player refs ───────────────────────────────────────
  const videoRef = useRef<Video>(null);
  const webVideoRef = useRef<HTMLVideoElement | null>(null);

  // ── Pulse animation for the LIVE/OFFLINE dot ───────────────
  const pulseAnim = useSharedValue(1);

  useEffect(() => {
    pulseAnim.value = withRepeat(
      withTiming(0.2, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, []);

  const animatedPulseStyle = useAnimatedStyle(() => ({
    opacity: pulseAnim.value,
  }));

  // ─────────────────────────────────────────────────────────────
  // ON MOUNT: check server status
  // Restores the streaming state if the app was reloaded while
  // the server was already streaming.
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    checkStatus();
  }, []);

  const checkStatus = async () => {
    try {
      const data = await getLiveStreamStatus();

      setIsStreaming(data.isStreaming || false);

      // Restore mode from server state
      if (data.mode === "mobile-cam") setMode("mobile-cam");
      else if (data.mode === "ip-camera") setMode("ip-camera");
      else setMode("local");

      if (data.streamUrl) {
        // Replace localhost with actual server IP in case server
        // returned a localhost URL (happens in some configs)
        setStreamUrl(data.streamUrl.replace("localhost", "192.168.100.12"));
      } else {
        setStreamUrl(`${LIVE_SERVER_URL}/index.m3u8`);
      }

      setError(null);
    } catch {
      setIsStreaming(false);
      setError("Live server not reachable.");
    }
  };

  // ─────────────────────────────────────────────────────────────
  // HLS PLAYER SETUP (web only)
  // Sets up HLS.js when running on web platform.
  // HLS.js handles the playlist polling and segment loading.
  // On native (iOS/Android), expo-av handles HLS natively.
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (!isStreaming || !streamUrl || !webVideoRef.current) return;

    const video = webVideoRef.current;

    if (Hls.isSupported()) {
      const hls = new Hls({
        lowLatencyMode: true,
        enableWorker: true,
      });

      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play()
          .then(() => { setError(null); setIsLoading(false); })
          .catch(() => {
            setError("NO SIGNAL: Browser blocked autoplay. Click play.");
            setIsLoading(false);
          });
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return; // ignore non-fatal errors

        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          // Network errors are often temporary — try to recover
          hls.startLoad();
          return;
        }

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
          return;
        }

        // Fatal unrecoverable error
        setError("NO SIGNAL: HLS playback failed.");
        setIsLoading(false);
        hls.destroy();
      });

      // Cleanup HLS instance when component unmounts or stream changes
      return () => { hls.destroy(); };
    }

    // Fallback for Safari — supports HLS natively
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = streamUrl;
      video.play()
        .then(() => { setError(null); setIsLoading(false); })
        .catch(() => {
          setError("NO SIGNAL: Browser blocked autoplay.");
          setIsLoading(false);
        });
    }
  }, [isStreaming, streamUrl]);

  // ─────────────────────────────────────────────────────────────
  // waitForPlaylist
  // After calling /connect, FFmpeg needs a few seconds to start
  // generating HLS segments. This function polls the m3u8 URL
  // until it responds with 200 OK, then the frontend starts playing.
  //
  // retries: how many times to check before giving up
  // delay:   milliseconds between each check
  // ─────────────────────────────────────────────────────────────
  const waitForPlaylist = async (
    url: string,
    retries = 30,
    delay = 1000
  ): Promise<boolean> => {
    for (let i = 0; i < retries; i++) {
      try {
        // Add cache-busting param so browser doesn't cache 404 response
        const res = await fetch(`${url}?t=${Date.now()}`, { method: "GET" });
        if (res.ok) return true;
      } catch {
        // Server not ready yet — keep waiting
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    return false; // Timed out
  };

  // ─────────────────────────────────────────────────────────────
  // handleConnectCamera
  // Called when user taps CONNECT in the modal.
  // Builds the correct request body based on the selected mode
  // and sends it to the server's /connect endpoint.
  // ─────────────────────────────────────────────────────────────
  const handleConnectCamera = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // ── Build request body based on selected mode ───────────
      let requestBody: Record<string, string> = { mode };

      if (mode === "mobile-cam") {
        // Send the phone's stream URL
        if (!mobileStreamUrl.trim()) {
          throw new Error("Please enter the phone camera URL.");
        }
        requestBody.streamUrl = mobileStreamUrl.trim();

      } else if (mode === "ip-camera") {
        // Send camera IP (server builds the RTSP URL)
        // OR send a full RTSP URL directly if user entered one
        if (!ipAddress.trim()) {
          throw new Error("Please enter the camera IP address.");
        }

        if (ipAddress.startsWith("rtsp://")) {
          // User entered a full RTSP URL
          requestBody.streamUrl = ipAddress.trim();
        } else {
          // User entered just an IP — server will build the RTSP URL
          requestBody.ip = ipAddress.trim();
          requestBody.username = ipUsername.trim() || "admin";
          requestBody.password = ipPassword.trim();
        }
      }
      // For "local" mode, no extra fields needed

      console.log("[CONNECT] Sending request:", requestBody);

      // ── Call server /connect endpoint ───────────────────────
      const response = await fetch(`${LIVE_SERVER_URL}/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();
      console.log("[CONNECT] Response:", data);

      if (!response.ok) {
        throw new Error(data.message || "Camera connect failed.");
      }

      // Close modal immediately — show loading state on video
      setModalVisible(false);

      const liveUrl = `${LIVE_SERVER_URL}/index.m3u8`;

      // ── Wait for FFmpeg to generate the first HLS segments ──
      // FFmpeg needs 2-4 seconds to start writing .ts files.
      // We poll until the playlist file exists on the server.
      const playlistReady = await waitForPlaylist(liveUrl);

      if (!playlistReady) {
        setIsStreaming(false);
        setError("NO SIGNAL: Stream did not start in time. Check camera connection.");
        return;
      }

      // Stream is ready — update URL with cache buster and start playback
      setStreamUrl(`${liveUrl}?t=${Date.now()}`);
      setIsStreaming(true);
      setError(null);

    } catch (err: any) {
      console.error("[CONNECT] Error:", err);
      setIsStreaming(false);
      setError(err?.message || "Failed to connect camera.");
    } finally {
      setIsLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // disconnectCamera
  // Stops the stream by calling /disconnect on the server.
  // Also clears the video player on the frontend.
  // ─────────────────────────────────────────────────────────────
  const disconnectCamera = async () => {
    try {
      setIsLoading(true);
      setError(null);

      await fetch(`${LIVE_SERVER_URL}/disconnect`, { method: "POST" });

      // Clear native video player
      if (videoRef.current) {
        await videoRef.current.unloadAsync();
      }

      // Clear web video player
      if (webVideoRef.current) {
        webVideoRef.current.pause();
        webVideoRef.current.removeAttribute("src");
        webVideoRef.current.load();
      }

      setIsStreaming(false);
      setError("NO SIGNAL: Stream disconnected.");

    } catch (err: any) {
      setError(err?.toString() || "Failed to disconnect stream.");
    } finally {
      setIsLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // AI Classification polling
  // Fetches the latest anomaly detection result from the Python
  // backend every 2 seconds and shows it overlaid on the video.
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const fetchClassification = async () => {
      try {
        const response = await fetch(`${API_URL}/live-classification`);
        const data = await response.json();
        setClassification(data);
      } catch {
        // Silently ignore — AI server may not be running yet
      }
    };

    fetchClassification();
    const interval = setInterval(fetchClassification, 2000);
    return () => clearInterval(interval);
  }, []);

  const isAnomaly = classification && classification.result !== "NormalVideos";

  // ─────────────────────────────────────────────────────────────
  // switchCamera
  // Switches the selected camera node in the grid.
  // Only switches to active cameras.
  // ─────────────────────────────────────────────────────────────
  const switchCamera = (cameraId: number) => {
    const camera = CAMERAS.find((cam) => cam.id === cameraId);
    if (!camera || !camera.active) return;

    setSelectedCamera(cameraId);
    setIsLoading(true);
    setError(null);
  };

  // ─────────────────────────────────────────────────────────────
  // RENDER
  // UI is identical to the original design.
  // ─────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>

      {/* ── Header ─────────────────────────────────────────── */}
      <View style={styles.header}>
        <Ionicons name="radio" size={32} color={NEON_GREEN} style={styles.neonGlow} />
        <Text style={styles.headerTitle}>LIVE SURVEILLANCE</Text>
        <Text style={styles.headerSubtitle}>NODE: CAM-0{selectedCamera}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20 }}>

        {/* ── Top action buttons ──────────────────────────── */}
        <View style={styles.topActionRow}>
          <TouchableOpacity
            style={styles.connectCameraButton}
            onPress={() => setModalVisible(true)}
          >
            <Ionicons name="add-circle" size={20} color="#000" />
            <Text style={styles.connectCameraText}>CONNECT CAMERA</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.stopButton} onPress={disconnectCamera}>
            <Ionicons name="stop-circle" size={20} color={ALERT_RED} />
            <Text style={styles.stopButtonText}>STOP</Text>
          </TouchableOpacity>
        </View>

        {/* ── Video player ────────────────────────────────── */}
        <View style={[styles.videoWrapper, isAnomaly && { borderColor: ALERT_RED }]}>

          {/* Web platform: use <video> tag with HLS.js */}
          {isStreaming && Platform.OS === "web" && (
            <video
              ref={webVideoRef}
              style={{ width: "100%", height: "100%", objectFit: "cover", backgroundColor: "#000" }}
              muted
              autoPlay
              playsInline
              controls
            />
          )}

          {/* Native platform: use expo-av Video component */}
          {isStreaming && Platform.OS !== "web" && (
            <Video
              ref={videoRef}
              style={styles.video}
              resizeMode={ResizeMode.COVER}
              shouldPlay
              isMuted
              source={{
                uri: streamUrl,
                overrideFileExtensionAndroid: "m3u8",
              }}
              onError={() => {
                setError("NO SIGNAL: Connection to node lost.");
                setIsLoading(false);
              }}
              onLoad={() => {
                setIsLoading(false);
                setError(null);
              }}
              onPlaybackStatusUpdate={(status: AVPlaybackStatus) => {
                if (!status.isLoaded && status.error) {
                  setError(`FEED ERROR: ${status.error}`);
                } else if (status.isLoaded) {
                  setIsLoading(false);
                }
              }}
            />
          )}

          {/* Loading overlay */}
          {isLoading && !error && (
            <View style={styles.overlayCenter}>
              <ActivityIndicator size="large" color={NEON_GREEN} />
              <Text style={styles.loadingText}>ESTABLISHING CONNECTION...</Text>
            </View>
          )}

          {/* No camera connected overlay */}
          {!isStreaming && !isLoading && (
            <View style={styles.overlayCenter}>
              <Ionicons name="videocam-off" size={42} color={MUTED_GREEN} />
              <Text style={styles.loadingText}>NO CAMERA CONNECTED</Text>
            </View>
          )}

          {/* Error overlay */}
          {error && (
            <View style={styles.overlayCenter}>
              <Ionicons name="warning-outline" size={40} color={ALERT_RED} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* HUD overlays (LIVE dot, classification, brackets) */}
          <View style={StyleSheet.absoluteFillObject} pointerEvents="none">

            {/* LIVE / OFFLINE indicator */}
            <View style={styles.hudTopRight}>
              <Animated.View
                style={[
                  styles.recDot,
                  animatedPulseStyle,
                  !isStreaming && { backgroundColor: MUTED_GREEN },
                ]}
              />
              <Text style={styles.hudText}>{isStreaming ? "LIVE" : "OFFLINE"}</Text>
            </View>

            {/* AI classification result */}
            {classification && !error && !isLoading && isStreaming && (
              <View style={styles.hudBottomLeft}>
                <Text style={[
                  styles.classificationText,
                  isAnomaly ? { color: ALERT_RED } : { color: NEON_GREEN },
                ]}>
                  {isAnomaly
                    ? `⚠️ THREAT: ${classification.result.toUpperCase()}`
                    : "SYSTEM CLEAR"}
                </Text>
                <Text style={styles.confidenceText}>
                  CONFIDENCE: {(classification.confidence * 100).toFixed(1)}%
                </Text>
              </View>
            )}

            {/* Corner brackets */}
            <View style={[styles.bracket, styles.bracketTopLeft, isAnomaly && { borderColor: ALERT_RED }]} />
            <View style={[styles.bracket, styles.bracketTopRight, isAnomaly && { borderColor: ALERT_RED }]} />
            <View style={[styles.bracket, styles.bracketBottomLeft, isAnomaly && { borderColor: ALERT_RED }]} />
            <View style={[styles.bracket, styles.bracketBottomRight, isAnomaly && { borderColor: ALERT_RED }]} />
          </View>
        </View>

        {/* ── Camera node grid ────────────────────────────── */}
        <View style={styles.controlsContainer}>
          <Text style={styles.controlsTitle}>NETWORK NODES</Text>

          <View style={styles.buttonGrid}>
            {CAMERAS.map((camera) => {
              const isSelected = selectedCamera === camera.id;
              return (
                <TouchableOpacity
                  key={camera.id}
                  style={[
                    styles.cameraButton,
                    isSelected && styles.selectedButton,
                    !camera.active && styles.inactiveButton,
                  ]}
                  onPress={() => switchCamera(camera.id)}
                  disabled={!camera.active}
                >
                  <Ionicons
                    name={camera.active ? "videocam" : "videocam-off"}
                    size={20}
                    color={!camera.active ? MUTED_GREEN : isSelected ? "#000" : NEON_GREEN}
                    style={{ marginBottom: 5 }}
                  />
                  <Text style={[
                    styles.buttonText,
                    isSelected && { color: "#000", fontWeight: "900" },
                    !camera.active && styles.inactiveButtonText,
                  ]}>
                    {camera.name.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </ScrollView>

      {/* ── Connect Camera Modal ─────────────────────────────── */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>

            {/* Modal header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>CONNECT CAMERA</Text>
              <TouchableOpacity style={styles.closeButton} onPress={() => setModalVisible(false)}>
                <Ionicons name="close" size={24} color={ALERT_RED} />
              </TouchableOpacity>
            </View>

            {/* Camera name input */}
            <Text style={styles.inputLabel}>CAMERA NAME</Text>
            <TextInput
              style={styles.input}
              placeholder="Main Entrance Camera"
              placeholderTextColor={MUTED_GREEN}
              value={cameraName}
              onChangeText={setCameraName}
            />

            {/* Source type selector */}
            <Text style={styles.inputLabel}>SOURCE TYPE</Text>

            <View style={styles.modeRow}>

              {/* Demo Video button */}
              <TouchableOpacity
                style={[styles.modeButton, mode === "local" && styles.activeModeButton]}
                onPress={() => setMode("local")}
              >
                <Ionicons name="film" size={20} color={mode === "local" ? "#000" : NEON_GREEN} />
                <Text style={[styles.modeText, mode === "local" && styles.activeModeText]}>
                  DEMO VIDEO
                </Text>
              </TouchableOpacity>

              {/* Mobile Camera button */}
              <TouchableOpacity
                style={[styles.modeButton, mode === "mobile-cam" && styles.activeModeButton]}
                onPress={() => setMode("mobile-cam")}
              >
                <Ionicons name="phone-portrait" size={20} color={mode === "mobile-cam" ? "#000" : NEON_GREEN} />
                <Text style={[styles.modeText, mode === "mobile-cam" && styles.activeModeText]}>
                  MOBILE CAM
                </Text>
              </TouchableOpacity>

              {/* IP Camera button */}
              <TouchableOpacity
                style={[styles.modeButton, mode === "ip-camera" && styles.activeModeButton]}
                onPress={() => setMode("ip-camera")}
              >
                <Ionicons name="camera" size={20} color={mode === "ip-camera" ? "#000" : NEON_GREEN} />
                <Text style={[styles.modeText, mode === "ip-camera" && styles.activeModeText]}>
                  IP CAMERA
                </Text>
              </TouchableOpacity>

            </View>

            {/* ── Mobile cam fields ───────────────────────── */}
            {mode === "mobile-cam" && (
              <>
                <Text style={styles.inputLabel}>PHONE STREAM URL</Text>
                <TextInput
                  style={styles.input}
                  placeholder="http://192.168.100.21:8080/video"
                  placeholderTextColor={MUTED_GREEN}
                  value={mobileStreamUrl}
                  onChangeText={setMobileStreamUrl}
                  autoCapitalize="none"
                  keyboardType="url"
                />
                <Text style={styles.hintText}>
                  Install IP Webcam app → Start Server → copy the URL shown
                </Text>
              </>
            )}

            {/* ── IP camera fields ────────────────────────── */}
            {mode === "ip-camera" && (
              <>
                <Text style={styles.inputLabel}>CAMERA IP ADDRESS</Text>
                <TextInput
                  style={styles.input}
                  placeholder="192.168.1.64  or  rtsp://admin:pass@IP:554/stream"
                  placeholderTextColor={MUTED_GREEN}
                  value={ipAddress}
                  onChangeText={setIpAddress}
                  autoCapitalize="none"
                  keyboardType="url"
                />

                <View style={styles.credentialsRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>USERNAME</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="admin"
                      placeholderTextColor={MUTED_GREEN}
                      value={ipUsername}
                      onChangeText={setIpUsername}
                      autoCapitalize="none"
                    />
                  </View>

                  <View style={{ width: 10 }} />

                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>PASSWORD</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="••••••••"
                      placeholderTextColor={MUTED_GREEN}
                      value={ipPassword}
                      onChangeText={setIpPassword}
                      secureTextEntry
                    />
                  </View>
                </View>

                <Text style={styles.hintText}>
                  Connect camera to the same router as this device via LAN cable or Wi-Fi
                </Text>
              </>
            )}

            {/* ── Modal action buttons ─────────────────────── */}
            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => setModalVisible(false)}
              >
                <Ionicons name="arrow-back" size={18} color={MUTED_GREEN} />
                <Text style={styles.backButtonText}>BACK</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalConnectButton}
                onPress={handleConnectCamera}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <>
                    <Ionicons name="play" size={18} color="#000" />
                    <Text style={styles.modalConnectText}>CONNECT</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// STYLES — identical to original, with additions for new fields
// ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: DARK_BG },

  header: {
    padding: 20,
    alignItems: "center",
    backgroundColor: "rgba(16, 185, 82, 0.05)",
    paddingTop: Platform.OS === "ios" ? 60 : 40,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(16, 185, 82, 0.2)",
  },
  neonGlow: {
    textShadowColor: NEON_GREEN,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 2,
    marginTop: 10,
    color: "#fff",
  },
  headerSubtitle: {
    fontSize: 12,
    color: NEON_GREEN,
    letterSpacing: 1,
    marginTop: 5,
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
  },

  topActionRow: { flexDirection: "row", gap: 12, marginBottom: 16 },
  connectCameraButton: {
    flex: 1,
    backgroundColor: NEON_GREEN,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  connectCameraText: { color: "#000", fontWeight: "900", letterSpacing: 1 },
  stopButton: {
    width: 110,
    borderWidth: 1,
    borderColor: ALERT_RED,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  stopButtonText: { color: ALERT_RED, fontWeight: "900" },

  videoWrapper: {
    width: "100%",
    height: 250,
    backgroundColor: "#000",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 82, 0.4)",
    marginBottom: 30,
    overflow: "hidden",
  },
  video: { ...StyleSheet.absoluteFillObject },

  overlayCenter: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.8)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  loadingText: {
    color: NEON_GREEN,
    marginTop: 15,
    fontSize: 12,
    letterSpacing: 2,
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
  },
  errorText: {
    color: ALERT_RED,
    textAlign: "center",
    marginTop: 10,
    fontSize: 14,
    fontWeight: "bold",
    letterSpacing: 1,
  },

  hudTopRight: {
    position: "absolute",
    top: 15,
    right: 15,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  recDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: ALERT_RED,
    marginRight: 6,
  },
  hudText: { color: "#fff", fontSize: 10, fontWeight: "bold", letterSpacing: 1 },

  hudBottomLeft: {
    position: "absolute",
    bottom: 15,
    left: 15,
    backgroundColor: "rgba(0,0,0,0.7)",
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  classificationText: { fontSize: 14, fontWeight: "900", letterSpacing: 1 },
  confidenceText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 10,
    marginTop: 4,
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
  },

  bracket: {
    position: "absolute",
    width: 20,
    height: 20,
    borderColor: "rgba(16, 185, 82, 0.6)",
  },
  bracketTopLeft: { top: 10, left: 10, borderTopWidth: 2, borderLeftWidth: 2 },
  bracketTopRight: { top: 10, right: 10, borderTopWidth: 2, borderRightWidth: 2 },
  bracketBottomLeft: { bottom: 10, left: 10, borderBottomWidth: 2, borderLeftWidth: 2 },
  bracketBottomRight: { bottom: 10, right: 10, borderBottomWidth: 2, borderRightWidth: 2 },

  controlsContainer: {
    backgroundColor: "rgba(16, 185, 82, 0.02)",
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 82, 0.1)",
  },
  controlsTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: MUTED_GREEN,
    letterSpacing: 2,
    marginBottom: 15,
  },
  buttonGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 10,
  },
  cameraButton: {
    flexBasis: "48%",
    backgroundColor: "transparent",
    paddingVertical: 15,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 82, 0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  selectedButton: {
    backgroundColor: NEON_GREEN,
    borderColor: NEON_GREEN,
    shadowColor: NEON_GREEN,
    shadowRadius: 10,
    shadowOpacity: 0.4,
    elevation: 5,
  },
  buttonText: { color: NEON_GREEN, fontSize: 12, fontWeight: "bold", letterSpacing: 1 },
  inactiveButton: {
    borderColor: "rgba(138, 154, 141, 0.2)",
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  inactiveButtonText: { color: MUTED_GREEN },

  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.85)",
    justifyContent: "center",
    padding: 22,
  },
  modalBox: {
    backgroundColor: "#07110a",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(16,185,82,0.5)",
    padding: 20,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
  },
  modalTitle: { color: "#fff", fontSize: 18, fontWeight: "900", letterSpacing: 2 },
  closeButton: { padding: 5 },

  inputLabel: {
    color: MUTED_GREEN,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: "rgba(16,185,82,0.35)",
    borderRadius: 10,
    padding: 13,
    color: "#fff",
    backgroundColor: "#020503",
    marginBottom: 16,
  },

  // Hint text below input fields
  hintText: {
    color: MUTED_GREEN,
    fontSize: 11,
    marginTop: -10,
    marginBottom: 16,
    letterSpacing: 0.5,
  },

  // Username + password side by side
  credentialsRow: { flexDirection: "row" },

  modeRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  modeButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "rgba(16,185,82,0.35)",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  activeModeButton: { backgroundColor: NEON_GREEN, borderColor: NEON_GREEN },
  modeText: { color: NEON_GREEN, marginTop: 6, fontSize: 10, fontWeight: "900" },
  activeModeText: { color: "#000" },

  modalButtonRow: { flexDirection: "row", gap: 12, marginTop: 5 },
  backButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "rgba(138,154,141,0.4)",
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  backButtonText: { color: MUTED_GREEN, fontWeight: "900" },
  modalConnectButton: {
    flex: 1,
    backgroundColor: NEON_GREEN,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  modalConnectText: { color: "#000", fontWeight: "900" },
});