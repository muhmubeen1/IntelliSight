import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { ResizeMode, Video } from "expo-av";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

type StreamMode = "local" | "rtsp";

type StatusResponse = {
  isStreaming: boolean;
  mode: StreamMode;
  streamUrl: string;
};

type ConnectResponse = {
  message: string;
  mode: StreamMode;
  streamUrl: string;
};

const LIVE_SERVER_URL = "http://192.168.100.12:4000";

export default function LiveMonitoringScreen() {
  const [mode, setMode] = useState<StreamMode>("local");
  const [rtspUrl, setRtspUrl] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [streamUrl, setStreamUrl] = useState<string>(
    `${LIVE_SERVER_URL}/index.m3u8`
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [activeCamera, setActiveCamera] = useState<string>("CAM-01");

  useEffect(() => {
    checkStatus();
  }, []);

  const fixStreamUrl = (url: string) => {
    return url.replace("localhost", "192.168.100.12");
  };

  const checkStatus = async () => {
    try {
      const response = await fetch(`${LIVE_SERVER_URL}/status`);
      const data: StatusResponse = await response.json();

      setIsStreaming(data.isStreaming);
      setMode(data.mode || "local");
      setStreamUrl(fixStreamUrl(data.streamUrl));
    } catch (error) {
      console.log("Status error:", error);
    }
  };

  const connectStream = async () => {
    if (mode === "rtsp" && !rtspUrl.trim()) {
      Alert.alert("Missing RTSP URL", "Please enter camera RTSP URL.");
      return;
    }

    try {
      setLoading(true);

      const response = await fetch(`${LIVE_SERVER_URL}/connect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode,
          rtspUrl,
        }),
      });

      const data: ConnectResponse = await response.json();

      if (!response.ok) {
        Alert.alert("Connection Failed", data.message || "Unable to connect.");
        return;
      }

      setIsStreaming(true);
      setStreamUrl(fixStreamUrl(data.streamUrl));

      Alert.alert("Connected", "Live stream started successfully.");
    } catch (error: any) {
      Alert.alert("Error", error.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const disconnectStream = async () => {
    try {
      setLoading(true);

      await fetch(`${LIVE_SERVER_URL}/disconnect`, {
        method: "POST",
      });

      setIsStreaming(false);
      Alert.alert("Disconnected", "Live stream stopped.");
    } catch (error: any) {
      Alert.alert("Error", error.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Ionicons name="radio-outline" size={36} color="#10B952" />
          <Text style={styles.title}>LIVE SURVEILLANCE</Text>
          <Text style={styles.node}>NODE: {activeCamera}</Text>
        </View>

        <View style={styles.videoFrame}>
          {isStreaming ? (
            <Video
              source={{ uri: streamUrl }}
              style={styles.video}
              resizeMode={ResizeMode.CONTAIN}
              shouldPlay
              isLooping
              useNativeControls
            />
          ) : (
            <View style={styles.noSignalBox}>
              <Ionicons name="videocam-off-outline" size={52} color="#8A9A8D" />
              <Text style={styles.noSignalText}>NO LIVE STREAM</Text>
            </View>
          )}

          <View style={styles.liveBadge}>
            <View
              style={[
                styles.liveDot,
                { backgroundColor: isStreaming ? "#ff3333" : "#555" },
              ]}
            />
            <Text style={styles.liveText}>
              {isStreaming ? "LIVE" : "OFFLINE"}
            </Text>
          </View>
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>CONNECT CAMERA</Text>

          <View style={styles.modeRow}>
            <TouchableOpacity
              style={[
                styles.modeButton,
                mode === "local" && styles.activeModeButton,
              ]}
              onPress={() => setMode("local")}
            >
              <MaterialCommunityIcons
                name="video-vintage"
                size={24}
                color={mode === "local" ? "#050705" : "#10B952"}
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
                name="camera-outline"
                size={24}
                color={mode === "rtsp" ? "#050705" : "#10B952"}
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
            <TextInput
              style={styles.input}
              placeholder="rtsp://username:password@camera-ip:554/stream"
              placeholderTextColor="#6d7a70"
              value={rtspUrl}
              onChangeText={setRtspUrl}
              autoCapitalize="none"
              autoCorrect={false}
            />
          )}

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={styles.connectButton}
              onPress={connectStream}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#050705" />
              ) : (
                <>
                  <Ionicons name="play" size={20} color="#050705" />
                  <Text style={styles.connectText}>CONNECT</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.disconnectButton}
              onPress={disconnectStream}
              disabled={loading}
            >
              <Ionicons name="stop" size={20} color="#ff3333" />
              <Text style={styles.disconnectText}>DISCONNECT</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.statusText}>
            STATUS:{" "}
            <Text style={{ color: isStreaming ? "#10B952" : "#ff3333" }}>
              {isStreaming ? "CONNECTED" : "DISCONNECTED"}
            </Text>
          </Text>
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>NETWORK NODES</Text>

          <View style={styles.cameraGrid}>
            {["CAM-01", "CAM-02", "CAM-03"].map((camera, index) => (
              <TouchableOpacity
                key={camera}
                style={[
                  styles.cameraCard,
                  activeCamera === camera && styles.activeCameraCard,
                ]}
                onPress={() => setActiveCamera(camera)}
              >
                <Ionicons
                  name={index === 0 ? "videocam" : "videocam-off"}
                  size={28}
                  color={activeCamera === camera ? "#050705" : "#8A9A8D"}
                />
                <Text
                  style={[
                    styles.cameraText,
                    activeCamera === camera && styles.activeCameraText,
                  ]}
                >
                  CAMERA {index + 1}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.aiPanel}>
          <Text style={styles.sectionTitle}>AI DETECTION STATUS</Text>
          <Text style={styles.aiText}>Prediction: Waiting for live AI...</Text>
          <Text style={styles.aiText}>Confidence: --%</Text>
          <Text style={styles.aiText}>Alert: No active alert</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#050705",
  },
  header: {
    alignItems: "center",
    paddingTop: 38,
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: "#0b3d22",
  },
  title: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 3,
    marginTop: 8,
  },
  node: {
    color: "#10B952",
    marginTop: 8,
    letterSpacing: 2,
    fontSize: 13,
  },
  videoFrame: {
    height: 260,
    margin: 14,
    borderWidth: 1,
    borderColor: "#10B952",
    borderRadius: 14,
    backgroundColor: "#000000",
    overflow: "hidden",
    position: "relative",
  },
  video: {
    width: "100%",
    height: "100%",
    backgroundColor: "#000000",
  },
  noSignalBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  noSignalText: {
    color: "#8A9A8D",
    marginTop: 10,
    fontWeight: "900",
    letterSpacing: 2,
  },
  liveBadge: {
    position: "absolute",
    top: 15,
    right: 15,
    flexDirection: "row",
    alignItems: "center",
  },
  liveDot: {
    width: 10,
    height: 10,
    borderRadius: 10,
    marginRight: 6,
  },
  liveText: {
    color: "#ffffff",
    fontWeight: "900",
    fontSize: 12,
  },
  panel: {
    margin: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: "#113d25",
    borderRadius: 16,
    backgroundColor: "#07110a",
  },
  sectionTitle: {
    color: "#AAB8AD",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 3,
    marginBottom: 18,
  },
  modeRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 15,
  },
  modeButton: {
    flex: 1,
    height: 60,
    borderWidth: 1,
    borderColor: "#203528",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#07110a",
  },
  activeModeButton: {
    backgroundColor: "#10B952",
    shadowColor: "#10B952",
    shadowOpacity: 0.6,
    shadowRadius: 12,
  },
  modeText: {
    color: "#10B952",
    fontWeight: "900",
    marginTop: 5,
    fontSize: 12,
  },
  activeModeText: {
    color: "#050705",
  },
  input: {
    borderWidth: 1,
    borderColor: "#124d2b",
    borderRadius: 10,
    padding: 14,
    color: "#ffffff",
    marginBottom: 15,
    backgroundColor: "#020503",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
  },
  connectButton: {
    flex: 1,
    height: 52,
    borderRadius: 10,
    backgroundColor: "#10B952",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  connectText: {
    color: "#050705",
    fontWeight: "900",
  },
  disconnectButton: {
    flex: 1,
    height: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#ff3333",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  disconnectText: {
    color: "#ff3333",
    fontWeight: "900",
  },
  statusText: {
    color: "#AAB8AD",
    marginTop: 15,
    fontWeight: "800",
  },
  cameraGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  cameraCard: {
    width: "48%",
    height: 88,
    borderWidth: 1,
    borderColor: "#203528",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#07110a",
  },
  activeCameraCard: {
    backgroundColor: "#10B952",
    shadowColor: "#10B952",
    shadowOpacity: 0.7,
    shadowRadius: 12,
  },
  cameraText: {
    color: "#8A9A8D",
    fontWeight: "900",
    marginTop: 8,
    letterSpacing: 1,
  },
  activeCameraText: {
    color: "#050705",
  },
  aiPanel: {
    margin: 14,
    marginBottom: 35,
    padding: 18,
    borderWidth: 1,
    borderColor: "#113d25",
    borderRadius: 16,
    backgroundColor: "#07110a",
  },
  aiText: {
    color: "#AAB8AD",
    marginBottom: 8,
    fontWeight: "700",
  },
});