/**
 * ============================================================
 * CCTVScreen.tsx — IntelliSight Live Surveillance Screen
 * ============================================================
 * Fixed: Auto-stream on mount removed, proper details table added
 * Fixed: Live classification polling URL corrected to /api/live-classification
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
  Vibration,
  View,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { getLiveStreamStatus, getToken } from "../api";
import { CAMERAS } from "../config/streams";

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────
const API_URL = "http://192.168.100.12:5000";
const LIVE_SERVER_URL = "http://192.168.100.12:4000";

const NEON_GREEN = "#10B952";
const DARK_BG = "#050705";
const MUTED_GREEN = "#8A9A8D";
const ALERT_RED = "#ff3333";
const ORANGE = "#FFA500";

// Prevent the same live anomaly popup from appearing repeatedly every poll cycle.
// Detections are still saved/logged normally; only popup display is rate-limited.
const POPUP_COOLDOWN_MS = 30000;

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────
type StreamMode = "local" | "mobile-cam" | "ip-camera";
type Severity = "High" | "Medium" | "Low";

interface ClassificationResult {
  result: string;
  confidence: number;
  timestamp: string;
  alert_required: boolean;
  severity: Severity;
  stable_label?: string;
  raw_label?: string;
  raw_confidence?: number;
  consecutive_anomaly_count?: number;
}

interface PopupData {
  show_popup: boolean;
  title: string;
  label: string;
  confidence_percent: number;
  severity: string;
  timestamp: string;
  beep_required: boolean;
  message: string;
}

interface StreamDetails {
  mode: StreamMode;
  cameraName: string;
  streamUrl: string;
  connectedAt: string;
  status: string;
  duration: string;
}

interface DetectionHistoryItem {
  id: string;
  timestamp: string;
  label: string;
  confidence: number;
  severity: Severity;
  status: string;
}

// ─────────────────────────────────────────────────────────────
// HELPER FUNCTIONS (outside component)
// ─────────────────────────────────────────────────────────────

const getStoredToken = async (): Promise<string | null> => {
  try {
    return await getToken();
  } catch {
    return null;
  }
};

const playAlertBeep = (): void => {
  try {
    if (Platform.OS === "web") {
      const AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.5, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
    } else {
      Vibration.vibrate([500, 200, 500]);
    }
  } catch {
    // Silently fail
  }
};

const formatConfidence = (confidence: number): string => {
  if (typeof confidence !== "number" || isNaN(confidence)) return "0.0%";
  return `${(confidence * 100).toFixed(1)}%`;
};

const getCurrentTimestamp = (): string => new Date().toISOString();

const formatDuration = (startTime: string | null): string => {
  if (!startTime) return "00:00:00";
  const diff = Date.now() - new Date(startTime).getTime();
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

const getSeverityColor = (severity: string): string => {
  switch (severity) {
    case "High": return ALERT_RED;
    case "Medium": return ORANGE;
    default: return NEON_GREEN;
  }
};

// ─────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────
export default function CCTVScreen() {
  // ── ALL useState hooks first ──────────────────────────────
  const [selectedCamera, setSelectedCamera] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamUrl, setStreamUrl] = useState(`${LIVE_SERVER_URL}/index.m3u8`);
  const [streamDetails, setStreamDetails] = useState<StreamDetails | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [detailsModalVisible, setDetailsModalVisible] = useState(false);
  const [resultPopupVisible, setResultPopupVisible] = useState(false);
  const [cameraName, setCameraName] = useState("Main Entrance Camera");
  const [mode, setMode] = useState<StreamMode>("local");
  const [mobileStreamUrl, setMobileStreamUrl] = useState("http://192.168.100.21:8080/video");
  const [ipAddress, setIpAddress] = useState("");
  const [ipUsername, setIpUsername] = useState("admin");
  const [ipPassword, setIpPassword] = useState("");
  const [classification, setClassification] = useState<ClassificationResult | null>(null);
  const [popupData, setPopupData] = useState<PopupData | null>(null);
  const [detectionHistory, setDetectionHistory] = useState<DetectionHistoryItem[]>([]);
  const [streamDuration, setStreamDuration] = useState("00:00:00");

  // ── ALL useRef hooks ──────────────────────────────────────
  const hasBeepedRef = useRef<boolean>(false);
  const lastPopupTimestampRef = useRef<string | null>(null);
  const lastPopupByLabelRef = useRef<Record<string, number>>({});
  const videoRef = useRef<Video>(null);
  const webVideoRef = useRef<HTMLVideoElement | null>(null);
  const classificationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const livePollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const authTokenRef = useRef<string | null>(null);
  const streamStartTimeRef = useRef<string | null>(null);

  // ── Reanimated hook ───────────────────────────────────────
  const pulseAnim = useSharedValue(1);
  const animatedPulseStyle = useAnimatedStyle(() => ({
    opacity: pulseAnim.value,
  }));

  // ── ALL useEffect hooks ───────────────────────────────────

  // Effect 1: Pulse animation only
  useEffect(() => {
    pulseAnim.value = withRepeat(
      withTiming(0.2, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, []);

  // Effect 2: Check server status on mount (NO AUTO-CONNECT)
  useEffect(() => {
    checkServerStatus();
    return () => {
      cleanupAllIntervals();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Effect 3: Stream duration timer
  useEffect(() => {
    if (isStreaming && streamStartTimeRef.current) {
      durationIntervalRef.current = setInterval(() => {
        setStreamDuration(formatDuration(streamStartTimeRef.current));
      }, 1000);
    }
    return () => {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }
    };
  }, [isStreaming]);

  // Effect 4: HLS player setup (web only)
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (!isStreaming || !streamUrl || !webVideoRef.current) return;

    const video = webVideoRef.current;

    if (Hls.isSupported()) {
      const hls = new Hls({ lowLatencyMode: true, enableWorker: true });
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
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad();
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
          return;
        }
        setError("NO SIGNAL: HLS playback failed.");
        setIsLoading(false);
        hls.destroy();
      });

      return () => { hls.destroy(); };
    }

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

  // ── Helper functions ──────────────────────────────────────

  const cleanupAllIntervals = () => {
    if (classificationIntervalRef.current) {
      clearInterval(classificationIntervalRef.current);
      classificationIntervalRef.current = null;
    }
    if (livePollIntervalRef.current) {
      clearInterval(livePollIntervalRef.current);
      livePollIntervalRef.current = null;
    }
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
  };

  const checkServerStatus = async () => {
    try {
      const data = await getLiveStreamStatus();

      const streamIsLive = data.isStreaming || false;
      setIsStreaming(streamIsLive);

      if (data.mode === "mobile-cam") setMode("mobile-cam");
      else if (data.mode === "ip-camera") setMode("ip-camera");
      else setMode("local");

      if (data.streamUrl) {
        setStreamUrl(data.streamUrl.replace("localhost", "192.168.100.12"));
      }

      // Restore stream start time for duration counter after refresh
      if (data.streamStartTime) {
        streamStartTimeRef.current = data.streamStartTime;
      }

      setError(null);

      // If stream is already running after page refresh, resume detection polling
      if (streamIsLive) {
        await startAutoDetection();
      }
    } catch {
      // Server not reachable — this is normal on first load
      setIsStreaming(false);
      setError(null); // Don't show error on initial load
    }
  };

  const waitForPlaylist = async (url: string, retries = 30, delay = 1000): Promise<boolean> => {
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(`${url}?t=${Date.now()}`, { method: "GET" });
        if (res.ok) return true;
      } catch {
        // Server not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    return false;
  };

  const startAutoDetection = async () => {
    cleanupAllIntervals();
    hasBeepedRef.current = false;
    lastPopupTimestampRef.current = null;
    lastPopupByLabelRef.current = {};

    const token = await getStoredToken();
    authTokenRef.current = token;

    console.log("[AUTO-DETECT] Starting automatic anomaly detection polling");

    // Poll classification endpoint every 3 seconds
    classificationIntervalRef.current = setInterval(async () => {
      try {
        const headers: Record<string, string> = {};
        if (authTokenRef.current) headers["Authorization"] = `Bearer ${authTokenRef.current}`;

        // FIXED: Added /api prefix to live-classification endpoint
        const response = await fetch(`${API_URL}/api/live-classification`, { headers });
        if (!response.ok) return;

        const data = await response.json();
        if (data.success && data.data) {
          const result: ClassificationResult = {
            result: data.data.result || "NormalVideos",
            confidence: data.data.confidence || 0,
            timestamp: data.data.timestamp || getCurrentTimestamp(),
            alert_required: data.data.alert_required || false,
            severity: data.data.severity || "Low",
            stable_label: data.data.stable_label,
            raw_label: data.data.raw_label,
            raw_confidence: data.data.raw_confidence,
            consecutive_anomaly_count: data.data.consecutive_anomaly_count || 0,
          };
          setClassification(result);

          // Add to detection history if anomaly detected
          if (result.alert_required) {
            const historyItem: DetectionHistoryItem = {
              id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              timestamp: result.timestamp,
              label: result.result,
              confidence: result.confidence,
              severity: result.severity,
              status: "New",
            };
            setDetectionHistory(prev => [historyItem, ...prev].slice(0, 50));
          }

          if (data.popup_data && data.popup_data.show_popup) {
            handleDetectionPopup(data.popup_data);
          }
        }
      } catch (error) {
        console.debug("[AUTO-DETECT] Polling error:", error);
      }
    }, 3000);

    // Poll for high alert beep every 2 seconds
    livePollIntervalRef.current = setInterval(async () => {
      try {
        const headers: Record<string, string> = {};
        if (authTokenRef.current) headers["Authorization"] = `Bearer ${authTokenRef.current}`;

        // FIXED: Added /api prefix to live-classification endpoint
        const response = await fetch(`${API_URL}/api/live-classification`, { headers });
        if (!response.ok) return;

        const data = await response.json();
        if (data.popup_data?.beep_required && !hasBeepedRef.current) {
          hasBeepedRef.current = true;
          playAlertBeep();
          console.log("[ALERT] High severity anomaly detected!");
        }
      } catch (error) {
        console.debug("[LIVE-POLL] Error:", error);
      }
    }, 2000);
  };

  const handleDetectionPopup = (popupData: PopupData): void => {
    // Ignore the exact same backend popup event if it is received again.
    if (lastPopupTimestampRef.current === popupData.timestamp) return;

    const popupKey = `${popupData.label}-${popupData.severity}`;
    const now = Date.now();
    const lastShownAt = lastPopupByLabelRef.current[popupKey] || 0;

    // Keep saving/logging every detection, but avoid showing the same popup repeatedly.
    if (now - lastShownAt < POPUP_COOLDOWN_MS) {
      lastPopupTimestampRef.current = popupData.timestamp;
      console.log("[POPUP] Suppressed duplicate popup:", popupKey);
      return;
    }

    lastPopupTimestampRef.current = popupData.timestamp;
    lastPopupByLabelRef.current[popupKey] = now;

    setPopupData(popupData);
    setResultPopupVisible(true);
    console.log("[POPUP] Detection result:", popupData.label);

    if (popupData.severity !== "High") {
      setTimeout(() => setResultPopupVisible(false), 8000);
    }
  };

  const handleConnectCamera = async () => {
    try {
      setIsLoading(true);
      setError(null);

      let requestBody: Record<string, string> = { mode };

      if (mode === "mobile-cam") {
        if (!mobileStreamUrl.trim()) {
          throw new Error("Please enter the phone camera URL.");
        }
        requestBody.streamUrl = mobileStreamUrl.trim();
      } else if (mode === "ip-camera") {
        if (!ipAddress.trim()) {
          throw new Error("Please enter the camera IP address.");
        }
        if (ipAddress.startsWith("rtsp://")) {
          requestBody.streamUrl = ipAddress.trim();
        } else {
          requestBody.ip = ipAddress.trim();
          requestBody.username = ipUsername.trim() || "admin";
          requestBody.password = ipPassword.trim();
        }
      }

      console.log("[CONNECT] Request:", requestBody);

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

      setModalVisible(false);
      const liveUrl = `${LIVE_SERVER_URL}/index.m3u8`;
      const playlistReady = await waitForPlaylist(liveUrl);

      if (!playlistReady) {
        setIsStreaming(false);
        setError("NO SIGNAL: Stream did not start in time. Check camera connection.");
        return;
      }

      setStreamUrl(`${liveUrl}?t=${Date.now()}`);
      setIsStreaming(true);
      setError(null);

      const now = getCurrentTimestamp();
      streamStartTimeRef.current = now;
      setStreamDuration("00:00:00");

      setStreamDetails({
        mode,
        cameraName,
        streamUrl: mode === "mobile-cam" ? mobileStreamUrl : mode === "ip-camera" ? ipAddress : "Demo Video",
        connectedAt: now,
        status: "Connected",
        duration: "00:00:00",
      });

      // Clear history on new stream
      // Clear history on new stream
      setDetectionHistory([]);

      // Start backend background analysis thread
      try {
        await fetch(`${API_URL}/api/live-analysis/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" }
        });
        console.log("[CONNECT] Background analysis started");
      } catch (e) {
        console.error("[CONNECT] Failed to start background analysis:", e);
      }

      // Start frontend polling
      await startAutoDetection();

    } catch (err: any) {
      console.error("[CONNECT] Error:", err);
      setIsStreaming(false);
      setError(err?.message || "Failed to connect camera.");
    } finally {
      setIsLoading(false);
    }
  };

  const disconnectCamera = async () => {
    try {
      setIsLoading(true);
      setError(null);

      await fetch(`${LIVE_SERVER_URL}/disconnect`, { method: "POST" });

      if (videoRef.current) {
        await videoRef.current.unloadAsync();
      }
      if (webVideoRef.current) {
        webVideoRef.current.pause();
        webVideoRef.current.removeAttribute("src");
        webVideoRef.current.load();
      }
      // Stop backend background analysis
      try {
        await fetch(`${API_URL}/api/live-analysis/stop`, {
          method: "POST",
          headers: { "Content-Type": "application/json" }
        });
        console.log("[DISCONNECT] Background analysis stopped");
      } catch (e) {
        console.error("[DISCONNECT] Failed to stop background analysis:", e);
      }

      cleanupAllIntervals();
      setIsStreaming(false);
      setClassification(null);
      setPopupData(null);
      setStreamDetails(null);
      setStreamDuration("00:00:00");
      hasBeepedRef.current = false;
      lastPopupTimestampRef.current = null;
      lastPopupByLabelRef.current = {};
      streamStartTimeRef.current = null;
      authTokenRef.current = null;
      setError("NO SIGNAL: Stream disconnected.");

      console.log("[DISCONNECT] Cleanup completed");
    } catch (err: any) {
      setError(err?.toString() || "Failed to disconnect stream.");
    } finally {
      setIsLoading(false);
    }
  };

  const switchCamera = (cameraId: number) => {
    const camera = CAMERAS.find((cam) => cam.id === cameraId);
    if (!camera || !camera.active) return;
    setSelectedCamera(cameraId);
    setIsLoading(true);
    setError(null);
  };

  // ── Derived state ─────────────────────────────────────────
  const isAnomaly = classification && classification.result !== "NormalVideos";

  // ── RENDER ────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="radio" size={32} color={NEON_GREEN} style={styles.neonGlow} />
        <Text style={styles.headerTitle}>LIVE SURVEILLANCE</Text>
        <Text style={styles.headerSubtitle}>NODE: CAM-0{selectedCamera}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20 }}>
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

        <View style={[styles.videoWrapper, isAnomaly ? { borderColor: ALERT_RED } : {}]}>
          {isStreaming && (
            <TouchableOpacity
              style={styles.detailsButton}
              onPress={() => setDetailsModalVisible(true)}
            >
              <Ionicons name="information-circle" size={20} color={NEON_GREEN} />
              <Text style={styles.detailsButtonText}>DETAILS</Text>
            </TouchableOpacity>
          )}

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

          {isStreaming && Platform.OS !== "web" && (
            <Video
              ref={videoRef}
              style={styles.video}
              resizeMode={ResizeMode.COVER}
              shouldPlay
              isMuted
              source={{ uri: streamUrl, overrideFileExtensionAndroid: "m3u8" }}
              onError={() => { setError("NO SIGNAL: Connection to node lost."); setIsLoading(false); }}
              onLoad={() => { setIsLoading(false); setError(null); }}
              onPlaybackStatusUpdate={(status: AVPlaybackStatus) => {
                if (!status.isLoaded && status.error) {
                  setError(`FEED ERROR: ${status.error}`);
                } else if (status.isLoaded) {
                  setIsLoading(false);
                }
              }}
            />
          )}

          {isLoading && !error && (
            <View style={styles.overlayCenter}>
              <ActivityIndicator size="large" color={NEON_GREEN} />
              <Text style={styles.loadingText}>ESTABLISHING CONNECTION...</Text>
            </View>
          )}

          {!isStreaming && !isLoading && (
            <View style={styles.overlayCenter}>
              <Ionicons name="videocam-off" size={42} color={MUTED_GREEN} />
              <Text style={styles.loadingText}>NO CAMERA CONNECTED</Text>
              <Text style={styles.hintText}>Tap "CONNECT CAMERA" to start</Text>
            </View>
          )}

          {error && (
            <View style={styles.overlayCenter}>
              <Ionicons name="warning-outline" size={40} color={ALERT_RED} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
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

            {classification && !error && !isLoading && isStreaming && (
              <View style={styles.hudBottomLeft}>
                <Text style={[styles.classificationText, isAnomaly ? { color: ALERT_RED } : { color: NEON_GREEN }]}>
                  {isAnomaly ? `⚠️ THREAT: ${(classification.stable_label || classification.result).toUpperCase()}` : "SYSTEM CLEAR"}
                </Text>
                <Text style={styles.confidenceText}>
                  CONFIDENCE: {formatConfidence(classification.confidence)}
                </Text>
                {(classification.consecutive_anomaly_count || 0) > 2 && (
                  <Text style={styles.persistenceBadge}>
                    PERSISTENT: {classification.consecutive_anomaly_count} CYCLES
                  </Text>
                )}
                {classification.severity === "High" && (
                  <Text style={styles.highAlertBadge}>HIGH ALERT</Text>
                )}
              </View>
            )}

            <View style={[styles.bracket, styles.bracketTopLeft, isAnomaly ? { borderColor: ALERT_RED } : {}]} />
            <View style={[styles.bracket, styles.bracketTopRight, isAnomaly ? { borderColor: ALERT_RED } : {}]} />
            <View style={[styles.bracket, styles.bracketBottomLeft, isAnomaly ? { borderColor: ALERT_RED } : {}]} />
            <View style={[styles.bracket, styles.bracketBottomRight, isAnomaly ? { borderColor: ALERT_RED } : {}]} />
          </View>
        </View>

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

      {/* Connect Camera Modal */}
      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>CONNECT CAMERA</Text>
              <TouchableOpacity style={styles.closeButton} onPress={() => setModalVisible(false)}>
                <Ionicons name="close" size={24} color={ALERT_RED} />
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>CAMERA NAME</Text>
            <TextInput style={styles.input} placeholder="Main Entrance Camera" placeholderTextColor={MUTED_GREEN} value={cameraName} onChangeText={setCameraName} />

            <Text style={styles.inputLabel}>SOURCE TYPE</Text>
            <View style={styles.modeRow}>
              <TouchableOpacity style={[styles.modeButton, mode === "local" && styles.activeModeButton]} onPress={() => setMode("local")}>
                <Ionicons name="film" size={20} color={mode === "local" ? "#000" : NEON_GREEN} />
                <Text style={[styles.modeText, mode === "local" && styles.activeModeText]}>DEMO VIDEO</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modeButton, mode === "mobile-cam" && styles.activeModeButton]} onPress={() => setMode("mobile-cam")}>
                <Ionicons name="phone-portrait" size={20} color={mode === "mobile-cam" ? "#000" : NEON_GREEN} />
                <Text style={[styles.modeText, mode === "mobile-cam" && styles.activeModeText]}>MOBILE CAM</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modeButton, mode === "ip-camera" && styles.activeModeButton]} onPress={() => setMode("ip-camera")}>
                <Ionicons name="camera" size={20} color={mode === "ip-camera" ? "#000" : NEON_GREEN} />
                <Text style={[styles.modeText, mode === "ip-camera" && styles.activeModeText]}>IP CAMERA</Text>
              </TouchableOpacity>
            </View>

            {mode === "mobile-cam" && (
              <>
                <Text style={styles.inputLabel}>PHONE STREAM URL</Text>
                <TextInput style={styles.input} placeholder="http://192.168.100.21:8080/video" placeholderTextColor={MUTED_GREEN} value={mobileStreamUrl} onChangeText={setMobileStreamUrl} autoCapitalize="none" keyboardType="url" />
                <Text style={styles.hintText}>Install IP Webcam app → Start Server → copy the URL shown</Text>
              </>
            )}

            {mode === "ip-camera" && (
              <>
                <Text style={styles.inputLabel}>CAMERA IP ADDRESS</Text>
                <TextInput style={styles.input} placeholder="192.168.1.64 or rtsp://admin:pass@IP:554/stream" placeholderTextColor={MUTED_GREEN} value={ipAddress} onChangeText={setIpAddress} autoCapitalize="none" keyboardType="url" />
                <View style={styles.credentialsRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>USERNAME</Text>
                    <TextInput style={styles.input} placeholder="admin" placeholderTextColor={MUTED_GREEN} value={ipUsername} onChangeText={setIpUsername} autoCapitalize="none" />
                  </View>
                  <View style={{ width: 10 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>PASSWORD</Text>
                    <TextInput style={styles.input} placeholder="••••••••" placeholderTextColor={MUTED_GREEN} value={ipPassword} onChangeText={setIpPassword} secureTextEntry />
                  </View>
                </View>
                <Text style={styles.hintText}>Connect camera to the same router via LAN or Wi-Fi</Text>
              </>
            )}

            <View style={styles.modalButtonRow}>
              <TouchableOpacity style={styles.backButton} onPress={() => setModalVisible(false)}>
                <Ionicons name="arrow-back" size={18} color={MUTED_GREEN} />
                <Text style={styles.backButtonText}>BACK</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConnectButton} onPress={handleConnectCamera} disabled={isLoading}>
                {isLoading ? <ActivityIndicator color="#000" /> : (
                  <><Ionicons name="play" size={18} color="#000" /><Text style={styles.modalConnectText}>CONNECT</Text></>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Details Modal with Table */}
      <Modal visible={detailsModalVisible} transparent animationType="fade" onRequestClose={() => setDetailsModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.detailsScrollView} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
            <View style={styles.detailsModalBox}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>STREAM DETAILS</Text>
                <TouchableOpacity onPress={() => setDetailsModalVisible(false)}>
                  <Ionicons name="close" size={24} color={ALERT_RED} />
                </TouchableOpacity>
              </View>

              {/* Stream Info Table */}
              <View style={styles.tableSection}>
                <Text style={styles.tableTitle}>STREAM INFORMATION</Text>
                <View style={styles.table}>
                  <TableRow label="Camera Name" value={streamDetails?.cameraName || "—"} />
                  <TableRow label="Mode" value={streamDetails?.mode?.toUpperCase() || "—"} />
                  <TableRow label="Stream URL" value={streamDetails?.streamUrl || "—"} isMonospace />
                  <TableRow label="Connected At" value={streamDetails?.connectedAt ? new Date(streamDetails.connectedAt).toLocaleString() : "—"} />
                  <TableRow label="Duration" value={streamDuration} isStatus />
                  <TableRow label="Status" value={isStreaming ? "🟢 LIVE" : "🔴 OFFLINE"} isStatus />
                </View>
              </View>

              {/* Detection History Table */}
              <View style={styles.tableSection}>
                <Text style={styles.tableTitle}>DETECTION HISTORY</Text>
                {detectionHistory.length === 0 ? (
                  <Text style={styles.noDataText}>No anomalies detected yet</Text>
                ) : (
                  <View style={styles.detectionTable}>
                    {/* Table Header */}
                    <View style={styles.detectionTableHeader}>
                      <Text style={[styles.detectionHeaderCell, { flex: 2 }]}>TIME</Text>
                      <Text style={[styles.detectionHeaderCell, { flex: 2 }]}>ANOMALY</Text>
                      <Text style={[styles.detectionHeaderCell, { flex: 1.5 }]}>CONF</Text>
                      <Text style={[styles.detectionHeaderCell, { flex: 1.5 }]}>SEV</Text>
                      <Text style={[styles.detectionHeaderCell, { flex: 1 }]}>STATUS</Text>
                    </View>
                    {/* Table Rows */}
                    {detectionHistory.map((item) => (
                      <View key={item.id} style={styles.detectionTableRow}>
                        <Text style={[styles.detectionCell, { flex: 2, color: MUTED_GREEN, fontSize: 10 }]}>
                          {new Date(item.timestamp).toLocaleTimeString()}
                        </Text>
                        <Text style={[styles.detectionCell, { flex: 2, color: "#fff", fontWeight: "bold" }]}>
                          {item.label}
                        </Text>
                        <Text style={[styles.detectionCell, { flex: 1.5, color: NEON_GREEN }]}>
                          {formatConfidence(item.confidence)}
                        </Text>
                        <View style={[styles.severityCell, { flex: 1.5, backgroundColor: `${getSeverityColor(item.severity)}33` }]}>
                          <Text style={[styles.severityCellText, { color: getSeverityColor(item.severity) }]}>
                            {item.severity}
                          </Text>
                        </View>
                        <View style={[styles.statusCell, { flex: 1 }]}>
                          <View style={[styles.statusDot, { backgroundColor: item.status === "New" ? ALERT_RED : NEON_GREEN }]} />
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              {/* Current Classification */}
              {classification && (
                <View style={styles.tableSection}>
                  <Text style={styles.tableTitle}>CURRENT DETECTION</Text>
                  <View style={styles.currentDetectionCard}>
                    <View style={styles.currentDetectionRow}>
                      <Text style={styles.currentDetectionLabel}>Label:</Text>
                      <Text style={[styles.currentDetectionValue, { color: (classification.stable_label || classification.result) !== "NormalVideos" ? ALERT_RED : NEON_GREEN }]}>
                        {classification.stable_label || classification.result}
                      </Text>
                    </View>
                    <View style={styles.currentDetectionRow}>
                      <Text style={styles.currentDetectionLabel}>Raw Label:</Text>
                      <Text style={[styles.currentDetectionValue, { color: MUTED_GREEN, fontSize: 10 }]}>
                        {classification.raw_label || "—"} ({formatConfidence(classification.raw_confidence || 0)})
                      </Text>
                    </View>
                    <View style={styles.currentDetectionRow}>
                      <Text style={styles.currentDetectionLabel}>Persistence:</Text>
                      <Text style={[styles.currentDetectionValue, { color: (classification.consecutive_anomaly_count || 0) > 2 ? ALERT_RED : MUTED_GREEN }]}>
                        {(classification.consecutive_anomaly_count || 0)} cycles
                      </Text>
                    </View>
                    <View style={styles.currentDetectionRow}>
                      <Text style={styles.currentDetectionLabel}>Confidence:</Text>
                      <Text style={styles.currentDetectionValue}>{formatConfidence(classification.confidence)}</Text>
                    </View>
                    <View style={styles.currentDetectionRow}>
                      <Text style={styles.currentDetectionLabel}>Severity:</Text>
                      <View style={[styles.severityBadgeInline, { backgroundColor: `${getSeverityColor(classification.severity)}33` }]}>
                        <Text style={[styles.severityBadgeText, { color: getSeverityColor(classification.severity) }]}>
                          {classification.severity}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.currentDetectionRow}>
                      <Text style={styles.currentDetectionLabel}>Alert:</Text>
                      <Text style={[styles.currentDetectionValue, { color: classification.alert_required ? ALERT_RED : MUTED_GREEN }]}>
                        {classification.alert_required ? "⚠️ REQUIRED" : "None"}
                      </Text>
                    </View>
                    <View style={styles.currentDetectionRow}>
                      <Text style={styles.currentDetectionLabel}>Last Update:</Text>
                      <Text style={[styles.currentDetectionValue, { fontSize: 10, color: MUTED_GREEN }]}>
                        {new Date(classification.timestamp).toLocaleString()}
                      </Text>
                    </View>
                  </View>
                </View>
              )}

              <TouchableOpacity style={styles.closeDetailsButton} onPress={() => setDetailsModalVisible(false)}>
                <Text style={styles.closeDetailsText}>CLOSE</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Result Popup Modal */}
      {popupData && (
        <Modal visible={resultPopupVisible} transparent animationType="slide" onRequestClose={() => setResultPopupVisible(false)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.resultModalBox, popupData.severity === "High" ? { borderColor: ALERT_RED, borderWidth: 2 } : {}]}>
              <View style={styles.popupIconContainer}>
                <Ionicons name={popupData.severity === "High" ? "warning" : "alert-circle"} size={48} color={popupData.severity === "High" ? ALERT_RED : NEON_GREEN} />
              </View>
              <Text style={[styles.popupTitle, popupData.severity === "High" ? { color: ALERT_RED } : {}]}>{popupData.title}</Text>
              <Text style={styles.popupLabel}>{popupData.label}</Text>
              <View style={styles.confidenceBar}>
                <View style={[styles.confidenceFill, { width: `${popupData.confidence_percent}%`, backgroundColor: popupData.severity === "High" ? ALERT_RED : NEON_GREEN }]} />
              </View>
              <Text style={styles.popupConfidenceText}>Confidence: {popupData.confidence_percent}%</Text>
              <View style={[styles.severityBadgePopup, { backgroundColor: `${getSeverityColor(popupData.severity)}33` }]}>
                <Text style={[styles.severityText, { color: getSeverityColor(popupData.severity) }]}>
                  SEVERITY: {popupData.severity.toUpperCase()}
                </Text>
              </View>
              <Text style={styles.popupTimestamp}>{new Date(popupData.timestamp).toLocaleString()}</Text>
              <Text style={styles.popupMessage}>{popupData.message}</Text>
              <View style={styles.popupButtonRow}>
                <TouchableOpacity style={styles.dismissButton} onPress={() => setResultPopupVisible(false)}>
                  <Text style={styles.dismissButtonText}>DISMISS</Text>
                </TouchableOpacity>
                {popupData.severity === "High" && (
                  <TouchableOpacity style={styles.acknowledgeButton} onPress={() => { setResultPopupVisible(false); hasBeepedRef.current = false; }}>
                    <Text style={styles.acknowledgeButtonText}>ACKNOWLEDGE</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────
function TableRow({ label, value, isMonospace = false, isStatus = false }: {
  label: string;
  value: string;
  isMonospace?: boolean;
  isStatus?: boolean;
}): React.ReactElement {
  return (
    <View style={styles.tableRow}>
      <Text style={styles.tableRowLabel}>{label}</Text>
      <Text style={[
        styles.tableRowValue,
        isMonospace && { fontFamily: Platform.OS === "ios" ? "Courier" : "monospace", fontSize: 10 },
        isStatus && { color: NEON_GREEN, fontWeight: "900" },
      ]}>
        {value}
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// STYLES
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

  detailsButton: {
    position: "absolute",
    top: 45,
    right: 15,
    zIndex: 10,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 82, 0.4)",
  },
  detailsButtonText: {
    color: NEON_GREEN,
    fontSize: 10,
    fontWeight: "900",
    marginLeft: 4,
    letterSpacing: 1,
  },

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
  hintText: {
    color: MUTED_GREEN,
    fontSize: 11,
    marginTop: 8,
    letterSpacing: 0.5,
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
  highAlertBadge: {
    color: ALERT_RED,
    fontSize: 10,
    fontWeight: "900",
    marginTop: 4,
    letterSpacing: 1,
    backgroundColor: "rgba(255, 51, 51, 0.2)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: "flex-start",
  },
  persistenceBadge: {
    color: ORANGE,
    fontSize: 9,
    fontWeight: "900",
    marginTop: 4,
    letterSpacing: 1,
    backgroundColor: "rgba(255, 165, 0, 0.2)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: "flex-start",
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

  credentialsRow: { flexDirection: "row" },
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

  detailsScrollView: {
    flex: 1,
  },
  detailsModalBox: {
    backgroundColor: "#07110a",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(16,185,82,0.5)",
    padding: 20,
  },

  tableSection: {
    marginBottom: 20,
  },
  tableTitle: {
    color: NEON_GREEN,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 2,
    marginBottom: 10,
  },

  table: {
    backgroundColor: "rgba(16, 185, 82, 0.03)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 82, 0.15)",
    overflow: "hidden",
  },
  tableRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(16, 185, 82, 0.08)",
  },
  tableRowLabel: {
    color: MUTED_GREEN,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    flex: 1,
  },
  tableRowValue: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "bold",
    flex: 2,
    textAlign: "right",
  },

  detectionTable: {
    backgroundColor: "rgba(16, 185, 82, 0.03)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 82, 0.15)",
    overflow: "hidden",
  },
  detectionTableHeader: {
    flexDirection: "row",
    backgroundColor: "rgba(16, 185, 82, 0.1)",
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(16, 185, 82, 0.2)",
  },
  detectionHeaderCell: {
    color: NEON_GREEN,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.5,
    textAlign: "center",
  },
  detectionTableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(16, 185, 82, 0.05)",
  },
  detectionCell: {
    fontSize: 10,
    textAlign: "center",
  },
  severityCell: {
    borderRadius: 4,
    paddingVertical: 2,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  severityCellText: {
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  statusCell: {
    alignItems: "center",
    justifyContent: "center",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  noDataText: {
    color: MUTED_GREEN,
    textAlign: "center",
    paddingVertical: 20,
    fontSize: 13,
  },

  currentDetectionCard: {
    backgroundColor: "rgba(16, 185, 82, 0.05)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 82, 0.2)",
    padding: 14,
  },
  currentDetectionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(16, 185, 82, 0.08)",
  },
  currentDetectionLabel: {
    color: MUTED_GREEN,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
  },
  currentDetectionValue: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "bold",
  },
  severityBadgeInline: {
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  severityBadgeText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.5,
  },

  closeDetailsButton: {
    backgroundColor: "rgba(16, 185, 82, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 82, 0.4)",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 10,
  },
  closeDetailsText: {
    color: NEON_GREEN,
    fontWeight: "900",
    letterSpacing: 1,
  },

  resultModalBox: {
    backgroundColor: "#07110a",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(16,185,82,0.5)",
    padding: 24,
    alignItems: "center",
    width: "90%",
    maxWidth: 400,
    alignSelf: "center",
  },
  popupIconContainer: { marginBottom: 16 },
  popupTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 2,
    marginBottom: 12,
    textAlign: "center",
  },
  popupLabel: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "900",
    marginBottom: 16,
    textAlign: "center",
  },
  confidenceBar: {
    width: "100%",
    height: 8,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 4,
    marginBottom: 8,
    overflow: "hidden",
  },
  confidenceFill: {
    height: "100%",
    borderRadius: 4,
  },
  popupConfidenceText: {
    color: MUTED_GREEN,
    fontSize: 12,
    marginBottom: 12,
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
  },
  severityBadgePopup: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 12,
  },
  severityText: {
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
  },
  popupTimestamp: {
    color: MUTED_GREEN,
    fontSize: 11,
    marginBottom: 12,
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
  },
  popupMessage: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 13,
    textAlign: "center",
    marginBottom: 20,
    lineHeight: 18,
  },
  popupButtonRow: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  dismissButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "rgba(138,154,141,0.4)",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  dismissButtonText: {
    color: MUTED_GREEN,
    fontWeight: "900",
    letterSpacing: 1,
  },
  acknowledgeButton: {
    flex: 1,
    backgroundColor: ALERT_RED,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  acknowledgeButtonText: {
    color: "#fff",
    fontWeight: "900",
    letterSpacing: 1,
  },
});