import { Ionicons } from '@expo/vector-icons';
import { AVPlaybackStatus, ResizeMode, Video } from 'expo-av';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

// Keep your existing imports
import { CAMERAS, STREAM_SERVER_URL } from '../config/streams';

const { width } = Dimensions.get('window');
const API_URL = 'http://192.168.100.55:5000'; // Your Flask server IP

// --- THE THEME PALETTE ---
const NEON_GREEN = '#10B952';
const DARK_BG = '#050705';
const MUTED_GREEN = '#8A9A8D';
const ALERT_RED = '#ff3333';

export default function CCTVScreen() {
  const [selectedCamera, setSelectedCamera] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [classification, setClassification] = useState<{
    result: string;
    confidence: number;
    timestamp: number;
  } | null>(null);

  const videoRef = useRef<Video>(null);
  const pulseAnim = useSharedValue(1);

  // Pulse animation for the "LIVE" dot
  useEffect(() => {
    pulseAnim.value = withRepeat(withTiming(0.2, { duration: 800, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, []);

  const animatedPulseStyle = useAnimatedStyle(() => ({ opacity: pulseAnim.value }));

  const handleVideoError = (error: string) => {
    setError('NO SIGNAL: Connection to node lost.');
    setIsLoading(false);
  };

  const handleVideoLoad = () => {
    setIsLoading(false);
    setError(null);
  };

  const handlePlaybackStatusUpdate = (status: AVPlaybackStatus) => {
    if (!status.isLoaded) {
      if (status.error) setError(`FEED ERROR: ${status.error}`);
      setIsLoading(true);
    } else {
      setIsLoading(false);
      setError(null);
    }
  };

  // Fetch classification results periodically
  useEffect(() => {
    const fetchClassification = async () => {
      try {
        const response = await fetch(`${API_URL}/live-classification`);
        const data = await response.json();
        setClassification(data);
      } catch (err) {
        // Silently fail if classification is down, so the video keeps playing
      }
    };
    fetchClassification();
    const interval = setInterval(fetchClassification, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const loadVideo = async () => {
      try {
        if (videoRef.current) {
          await videoRef.current.loadAsync(
            { uri: `${STREAM_SERVER_URL}/index.m3u8`, overrideFileExtensionAndroid: 'm3u8' },
            {},
            false
          );
          await videoRef.current.playAsync();
        }
      } catch (err) {
        setError('Failed to establish secure video stream.');
      }
    };
    loadVideo();
    return () => {
      if (videoRef.current) videoRef.current.unloadAsync();
    };
  }, [selectedCamera]); // Re-load if camera changes

  const isAnomaly = classification && classification.result !== 'NormalVideos';

  const switchCamera = (cameraId: number) => {
    const camera = CAMERAS.find(cam => cam.id === cameraId);
    if (!camera || !camera.active) return;
    setSelectedCamera(cameraId);
    setIsLoading(true);
    setError(null);
  };

  return (
    <View style={styles.container}>

      {/* HUD Header */}
      <View style={styles.header}>
        <Ionicons name="radio" size={32} color={NEON_GREEN} style={styles.neonGlow} />
        <Text style={styles.headerTitle}>LIVE SURVEILLANCE</Text>
        <Text style={styles.headerSubtitle}>NODE: CAM-0{selectedCamera}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20 }}>

        {/* ========================================= */}
        {/* ✨ THE TACTICAL VIDEO HUD ✨                */}
        {/* ========================================= */}
        <View style={[styles.videoWrapper, isAnomaly && { borderColor: ALERT_RED }]}>

          {/* THE ACTUAL VIDEO FEED */}
          <Video
            ref={videoRef}
            style={styles.video}
            resizeMode={ResizeMode.COVER}
            shouldPlay
            isMuted
            onError={handleVideoError}
            onLoad={handleVideoLoad}
            onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
          />

          {/* LOADING & ERROR STATES (Matrix Style) */}
          {isLoading && !error && (
            <View style={styles.overlayCenter}>
              <ActivityIndicator size="large" color={NEON_GREEN} />
              <Text style={styles.loadingText}>ESTABLISHING CONNECTION...</Text>
            </View>
          )}

          {error && (
            <View style={styles.overlayCenter}>
              <Ionicons name="warning-outline" size={40} color={ALERT_RED} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* HUD OVERLAY ELEMENTS (pointerEvents="none" lets you tap through them if needed) */}
          <View style={StyleSheet.absoluteFillObject} pointerEvents="none">

            {/* Top Right: Live Rec Indicator */}
            <View style={styles.hudTopRight}>
              <Animated.View style={[styles.recDot, animatedPulseStyle, error && { backgroundColor: MUTED_GREEN }]} />
              <Text style={styles.hudText}>{error ? 'OFFLINE' : 'LIVE'}</Text>
            </View>

            {/* Bottom Left: Live AI Classification */}
            {classification && !error && !isLoading && (
              <View style={styles.hudBottomLeft}>
                <Text style={[styles.classificationText, isAnomaly ? { color: ALERT_RED } : { color: NEON_GREEN }]}>
                  {isAnomaly ? `⚠️ THREAT: ${classification.result.toUpperCase()}` : 'SYSTEM CLEAR'}
                </Text>
                <Text style={styles.confidenceText}>
                  CONFIDENCE: {(classification.confidence * 100).toFixed(1)}%
                </Text>
              </View>
            )}

            {/* Targeting Brackets */}
            <View style={[styles.bracket, styles.bracketTopLeft, isAnomaly && { borderColor: ALERT_RED }]} />
            <View style={[styles.bracket, styles.bracketTopRight, isAnomaly && { borderColor: ALERT_RED }]} />
            <View style={[styles.bracket, styles.bracketBottomLeft, isAnomaly && { borderColor: ALERT_RED }]} />
            <View style={[styles.bracket, styles.bracketBottomRight, isAnomaly && { borderColor: ALERT_RED }]} />
          </View>
        </View>

        {/* ========================================= */}
        {/* CAMERA CONTROLS                           */}
        {/* ========================================= */}
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
                    color={!camera.active ? MUTED_GREEN : (isSelected ? '#000' : NEON_GREEN)}
                    style={{ marginBottom: 5 }}
                  />
                  <Text style={[
                    styles.buttonText,
                    isSelected && { color: '#000', fontWeight: '900' },
                    !camera.active && styles.inactiveButtonText
                  ]}>
                    {camera.name.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: DARK_BG },

  // Header
  header: { padding: 20, alignItems: 'center', backgroundColor: 'rgba(16, 185, 82, 0.05)', paddingTop: Platform.OS === 'ios' ? 60 : 40, borderBottomWidth: 1, borderBottomColor: 'rgba(16, 185, 82, 0.2)' },
  neonGlow: { textShadowColor: NEON_GREEN, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 10 },
  headerTitle: { fontSize: 22, fontWeight: '900', letterSpacing: 2, marginTop: 10, color: '#fff' },
  headerSubtitle: { fontSize: 12, color: NEON_GREEN, letterSpacing: 1, marginTop: 5, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },

  // Video HUD
  videoWrapper: { width: '100%', height: 250, backgroundColor: '#000', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(16, 185, 82, 0.4)', marginBottom: 30, overflow: 'hidden' },
  video: { ...StyleSheet.absoluteFillObject },

  // Loading & Error states
  overlayCenter: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  loadingText: { color: NEON_GREEN, marginTop: 15, fontSize: 12, letterSpacing: 2, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  errorText: { color: ALERT_RED, textAlign: 'center', marginTop: 10, fontSize: 14, fontWeight: 'bold', letterSpacing: 1 },

  // HUD Overlays
  hudTopRight: { position: 'absolute', top: 15, right: 15, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: ALERT_RED, marginRight: 6 },
  hudText: { color: '#fff', fontSize: 10, fontWeight: 'bold', letterSpacing: 1 },

  hudBottomLeft: { position: 'absolute', bottom: 15, left: 15, backgroundColor: 'rgba(0,0,0,0.7)', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  classificationText: { fontSize: 14, fontWeight: '900', letterSpacing: 1 },
  confidenceText: { color: 'rgba(255,255,255,0.7)', fontSize: 10, marginTop: 4, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },

  // Brackets [ ]
  bracket: { position: 'absolute', width: 20, height: 20, borderColor: 'rgba(16, 185, 82, 0.6)' },
  bracketTopLeft: { top: 10, left: 10, borderTopWidth: 2, borderLeftWidth: 2 },
  bracketTopRight: { top: 10, right: 10, borderTopWidth: 2, borderRightWidth: 2 },
  bracketBottomLeft: { bottom: 10, left: 10, borderBottomWidth: 2, borderLeftWidth: 2 },
  bracketBottomRight: { bottom: 10, right: 10, borderBottomWidth: 2, borderRightWidth: 2 },

  // Controls
  controlsContainer: { backgroundColor: 'rgba(16, 185, 82, 0.02)', padding: 20, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(16, 185, 82, 0.1)' },
  controlsTitle: { fontSize: 14, fontWeight: 'bold', color: MUTED_GREEN, letterSpacing: 2, marginBottom: 15 },
  buttonGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10 },

  cameraButton: { flexBasis: '48%', backgroundColor: 'transparent', paddingVertical: 15, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(16, 185, 82, 0.3)', alignItems: 'center', justifyContent: 'center' },
  selectedButton: { backgroundColor: NEON_GREEN, borderColor: NEON_GREEN, shadowColor: NEON_GREEN, shadowRadius: 10, shadowOpacity: 0.4, elevation: 5 },
  buttonText: { color: NEON_GREEN, fontSize: 12, fontWeight: 'bold', letterSpacing: 1 },

  inactiveButton: { borderColor: 'rgba(138, 154, 141, 0.2)', backgroundColor: 'rgba(255,255,255,0.02)' },
  inactiveButtonText: { color: MUTED_GREEN },
});