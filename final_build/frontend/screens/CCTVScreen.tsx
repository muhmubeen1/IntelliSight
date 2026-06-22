import { Ionicons } from "@expo/vector-icons";
import { AVPlaybackStatus, ResizeMode, Video } from "expo-av";
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

import {
  connectLiveCamera,
  disconnectLiveCamera,
  getLiveStreamStatus,
  getLiveStreamUrl,
} from "../api";

import { CAMERAS } from "../config/streams";

const API_URL = "http://192.168.100.12:5000";

const NEON_GREEN = "#10B952";
const DARK_BG = "#050705";
const MUTED_GREEN = "#8A9A8D";
const ALERT_RED = "#ff3333";

type StreamMode = "local" | "rtsp";

export default function CCTVScreen() {
  const [selectedCamera, setSelectedCamera] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isStreaming, setIsStreaming] = useState(false);
  const [streamUrl, setStreamUrl] = useState(getLiveStreamUrl());

  const [modalVisible, setModalVisible] = useState(false);
  const [cameraName, setCameraName] = useState("Main Entrance Camera");
  const [mode, setMode] = useState<StreamMode>("local");
  const [rtspUrl, setRtspUrl] = useState("");

  const [classification, setClassification] = useState<{
    result: string;
    confidence: number;
    timestamp: number;
  } | null>(null);

  const videoRef = useRef<Video>(null);
  const pulseAnim = useSharedValue(1);

  useEffect(() => {
    pulseAnim.value = withRepeat(
      withTiming(0.2, {
        duration: 800,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      true
    );
  }, []);

  const animatedPulseStyle = useAnimatedStyle(() => ({
    opacity: pulseAnim.value,
  }));

  const fixedStreamUrl = (url: string) => {
    return url.replace("localhost", "192.168.100.12");
  };

  const checkStatus = async () => {
    try {
      const data = await getLiveStreamStatus();

      setIsStreaming(data.isStreaming || false);
      setMode(data.mode || "local");

      if (data.streamUrl) {
        setStreamUrl(fixedStreamUrl(data.streamUrl));
      } else {
        setStreamUrl(getLiveStreamUrl());
      }

      setError(null);
    } catch (err) {
      setIsStreaming(false);
      setError("Live server not reachable.");
    }
  };

  useEffect(() => {
    checkStatus();
  }, []);

  const handleConnectCamera = async () => {
    try {
      setIsLoading(true);
      setError(null);

      if (mode === "rtsp" && !rtspUrl.trim()) {
        setError("Please enter RTSP URL.");
        return;
      }

      const finalRtspUrl = mode === "rtsp" ? rtspUrl.trim() : "";

      const data = await connectLiveCamera(mode, finalRtspUrl);

      console.log("Camera connected:", data);

      setStreamUrl(getLiveStreamUrl());
      setIsStreaming(true);
      setModalVisible(false);
    } catch (error: any) {
      setIsStreaming(false);
      setError(error?.toString() || "Failed to connect camera.");
    } finally {
      setIsLoading(false);
    }
  };

  const disconnectCamera = async () => {
    try {
      setIsLoading(true);
      setError(null);

      await disconnectLiveCamera();

      if (videoRef.current) {
        await videoRef.current.unloadAsync();
      }

      setIsStreaming(false);
      setRtspUrl("");
      setError("NO SIGNAL: Stream disconnected.");
    } catch (error: any) {
      setError(error?.toString() || "Failed to disconnect stream.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVideoError = () => {
    setError("NO SIGNAL: Connection to node lost.");
    setIsLoading(false);
  };

  const handleVideoLoad = () => {
    setIsLoading(false);
    setError(null);
  };

  const handlePlaybackStatusUpdate = (status: AVPlaybackStatus) => {
    if (!status.isLoaded) {
      if (status.error) setError(`FEED ERROR: ${status.error}`);
    } else {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const fetchClassification = async () => {
      try {
        const response = await fetch(`${API_URL}/live-classification`);
        const data = await response.json();
        setClassification(data);
      } catch (err) { }
    };

    fetchClassification();
    const interval = setInterval(fetchClassification, 2000);

    return () => clearInterval(interval);
  }, []);

  const isAnomaly = classification && classification.result !== "NormalVideos";

  const switchCamera = (cameraId: number) => {
    const camera = CAMERAS.find((cam) => cam.id === cameraId);
    if (!camera || !camera.active) return;

    setSelectedCamera(cameraId);
    setIsLoading(true);
    setError(null);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons
          name="radio"
          size={32}
          color={NEON_GREEN}
          style={styles.neonGlow}
        />
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

        <View
          style={[styles.videoWrapper, isAnomaly && { borderColor: ALERT_RED }]}
        >
          {isStreaming && (
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
              onError={handleVideoError}
              onLoad={handleVideoLoad}
              onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
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
              <Text style={styles.hudText}>
                {isStreaming ? "LIVE" : "OFFLINE"}
              </Text>
            </View>

            {classification && !error && !isLoading && isStreaming && (
              <View style={styles.hudBottomLeft}>
                <Text
                  style={[
                    styles.classificationText,
                    isAnomaly ? { color: ALERT_RED } : { color: NEON_GREEN },
                  ]}
                >
                  {isAnomaly
                    ? `⚠️ THREAT: ${classification.result.toUpperCase()}`
                    : "SYSTEM CLEAR"}
                </Text>
                <Text style={styles.confidenceText}>
                  CONFIDENCE: {(classification.confidence * 100).toFixed(1)}%
                </Text>
              </View>
            )}

            <View
              style={[
                styles.bracket,
                styles.bracketTopLeft,
                isAnomaly && { borderColor: ALERT_RED },
              ]}
            />
            <View
              style={[
                styles.bracket,
                styles.bracketTopRight,
                isAnomaly && { borderColor: ALERT_RED },
              ]}
            />
            <View
              style={[
                styles.bracket,
                styles.bracketBottomLeft,
                isAnomaly && { borderColor: ALERT_RED },
              ]}
            />
            <View
              style={[
                styles.bracket,
                styles.bracketBottomRight,
                isAnomaly && { borderColor: ALERT_RED },
              ]}
            />
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
                    color={
                      !camera.active
                        ? MUTED_GREEN
                        : isSelected
                          ? "#000"
                          : NEON_GREEN
                    }
                    style={{ marginBottom: 5 }}
                  />
                  <Text
                    style={[
                      styles.buttonText,
                      isSelected && { color: "#000", fontWeight: "900" },
                      !camera.active && styles.inactiveButtonText,
                    ]}
                  >
                    {camera.name.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </ScrollView>

      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>CONNECT CAMERA</Text>

              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setModalVisible(false)}
              >
                <Ionicons name="close" size={24} color={ALERT_RED} />
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>CAMERA NAME</Text>
            <TextInput
              style={styles.input}
              placeholder="Main Entrance Camera"
              placeholderTextColor={MUTED_GREEN}
              value={cameraName}
              onChangeText={setCameraName}
            />

            <Text style={styles.inputLabel}>SOURCE TYPE</Text>
            <View style={styles.modeRow}>
              <TouchableOpacity
                style={[
                  styles.modeButton,
                  mode === "local" && styles.activeModeButton,
                ]}
                onPress={() => setMode("local")}
              >
                <Ionicons
                  name="film"
                  size={20}
                  color={mode === "local" ? "#000" : NEON_GREEN}
                />
                <Text
                  style={[
                    styles.modeText,
                    mode === "local" && styles.activeModeText,
                  ]}
                >
                  DEMO VIDEO
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.modeButton,
                  mode === "rtsp" && styles.activeModeButton,
                ]}
                onPress={() => setMode("rtsp")}
              >
                <Ionicons
                  name="camera"
                  size={20}
                  color={mode === "rtsp" ? "#000" : NEON_GREEN}
                />
                <Text
                  style={[
                    styles.modeText,
                    mode === "rtsp" && styles.activeModeText,
                  ]}
                >
                  RTSP CAMERA
                </Text>
              </TouchableOpacity>
            </View>

            {mode === "rtsp" && (
              <>
                <Text style={styles.inputLabel}>RTSP URL</Text>
                <TextInput
                  style={styles.input}
                  placeholder="rtsp://admin:password@192.168.1.10:554/stream1"
                  placeholderTextColor={MUTED_GREEN}
                  value={rtspUrl}
                  onChangeText={setRtspUrl}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </>
            )}

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

  topActionRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
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
  connectCameraText: {
    color: "#000",
    fontWeight: "900",
    letterSpacing: 1,
  },
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
  stopButtonText: {
    color: ALERT_RED,
    fontWeight: "900",
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
  hudText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "bold",
    letterSpacing: 1,
  },

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
  classificationText: {
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1,
  },
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
  bracketTopLeft: {
    top: 10,
    left: 10,
    borderTopWidth: 2,
    borderLeftWidth: 2,
  },
  bracketTopRight: {
    top: 10,
    right: 10,
    borderTopWidth: 2,
    borderRightWidth: 2,
  },
  bracketBottomLeft: {
    bottom: 10,
    left: 10,
    borderBottomWidth: 2,
    borderLeftWidth: 2,
  },
  bracketBottomRight: {
    bottom: 10,
    right: 10,
    borderBottomWidth: 2,
    borderRightWidth: 2,
  },

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
  buttonText: {
    color: NEON_GREEN,
    fontSize: 12,
    fontWeight: "bold",
    letterSpacing: 1,
  },
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
  modalTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 2,
  },
  closeButton: {
    padding: 5,
  },
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
  modeRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },
  modeButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "rgba(16,185,82,0.35)",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  activeModeButton: {
    backgroundColor: NEON_GREEN,
    borderColor: NEON_GREEN,
  },
  modeText: {
    color: NEON_GREEN,
    marginTop: 6,
    fontSize: 11,
    fontWeight: "900",
  },
  activeModeText: {
    color: "#000",
  },
  modalButtonRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 5,
  },
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
  backButtonText: {
    color: MUTED_GREEN,
    fontWeight: "900",
  },
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
  modalConnectText: {
    color: "#000",
    fontWeight: "900",
  },
});