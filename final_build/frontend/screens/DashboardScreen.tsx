import { Ionicons } from '@expo/vector-icons';
import { ResizeMode, Video } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Dimensions,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { getToken } from '../api';

const { width } = Dimensions.get('window');

const NEON_GREEN = '#10B952';
const DARK_BG = '#050705';
const MUTED_GREEN = '#8A9A8D';
const API_URL = 'http://192.168.100.12:5000';

export default function DashboardScreen() {
  const [selectedFile, setSelectedFile] =
    useState<ImagePicker.ImagePickerAsset | null>(null);
  const [classificationResult, setClassificationResult] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  const [analysisData, setAnalysisData] = useState<any>(null);
  const [showResultModal, setShowResultModal] = useState(false);

  const scanAnim = useSharedValue(0);
  const pulseAnim = useSharedValue(1);

  useEffect(() => {
    checkBackendConnection();

    scanAnim.value = withRepeat(
      withTiming(220, { duration: 2000, easing: Easing.linear }),
      -1,
      false
    );

    pulseAnim.value = withRepeat(
      withTiming(0.2, { duration: 800 }),
      -1,
      true
    );
  }, []);

  const animatedScanStyle = useAnimatedStyle(() => {
    let laserColor = NEON_GREEN;

    if (classificationResult && classificationResult !== 'Normal Activity') {
      laserColor = '#ff3333';
    }

    return {
      transform: [{ translateY: scanAnim.value }],
      backgroundColor: laserColor,
      shadowColor: laserColor,
    };
  });

  const animatedPulseStyle = useAnimatedStyle(() => ({
    opacity: pulseAnim.value,
  }));

  const checkBackendConnection = async () => {
    try {
      const response = await fetch(`${API_URL}/health`);
      const data = await response.json();

      if (data.status !== 'OK') {
        throw new Error('Backend not ready');
      }
    } catch (error) {
      console.log('Backend connection error:', error);
    }
  };

  const getResultColor = (result: string): string => {
    if (result === 'Normal Activity') return NEON_GREEN;
    if (result === 'Error during classification') return '#f44336';
    return '#ff3333';
  };

  const getResultMessage = (result: string): string => {
    if (result === 'Normal Activity') {
      return 'SYSTEM CLEAR: No anomalies detected';
    }

    if (result === 'Error during classification') {
      return result;
    }

    return `⚠️ THREAT DETECTED: ${result}`;
  };

  const pickFile = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        allowsEditing: false,
        quality: 1,
      });

      if (!result.canceled) {
        const asset = result.assets[0];
        setSelectedFile(asset);
        await handleClassification(asset);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to pick file from library');
    }
  };

  const handleClassification = async (file: ImagePicker.ImagePickerAsset) => {
    setIsLoading(true);
    setClassificationResult('');

    try {
      const token = await getToken();

      console.log('Stored JWT:', token);

      if (!token) {
        Alert.alert('Login Required', 'Please login again before uploading.');
        setClassificationResult('Error during classification');
        return;
      }

      const formData = new FormData();

      const name =
        file.fileName ||
        file.uri.split('/').pop() ||
        (file.type === 'video' ? 'upload.mp4' : 'upload.jpg');

      if (Platform.OS === 'web') {
        const response = await fetch(file.uri);
        const blob = await response.blob();
        formData.append('file', blob, name);
      } else {
        formData.append('file', {
          uri: file.uri,
          type: file.type === 'video' ? 'video/mp4' : 'image/jpeg',
          name,
        } as any);
      }

      const response = await fetch(`${API_URL}/api/classify`, {
        method: 'POST',
        body: formData,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      console.log('Classify response status:', response.status);

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.msg || `HTTP ${response.status}`);
      }

      setClassificationResult(data.result || 'Unknown');
      setAnalysisData(data);
      setShowResultModal(true);
    } catch (error) {
      console.log('Classification error:', error);
      setClassificationResult('Error during classification');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 40 }}
    >
      <View style={styles.header}>
        <Ionicons
          name="shield-checkmark"
          size={32}
          color={NEON_GREEN}
          style={styles.neonGlow}
        />
        <Text style={styles.headerTitle}>INTELLISIGHT CORE</Text>
        <Text style={styles.headerSubtitle}>System Status: Online</Text>
      </View>

      <View style={styles.mainContent}>
        <View style={styles.videoContainer}>
          {selectedFile ? (
            selectedFile.type === 'video' ? (
              <Video
                source={{ uri: selectedFile.uri }}
                style={StyleSheet.absoluteFillObject}
                resizeMode={ResizeMode.COVER}
                shouldPlay
                isLooping
                isMuted
              />
            ) : (
              <Image
                source={{ uri: selectedFile.uri }}
                style={StyleSheet.absoluteFillObject}
                resizeMode="cover"
              />
            )
          ) : (
            <Ionicons
              name="scan-outline"
              size={80}
              color="rgba(16, 185, 82, 0.15)"
            />
          )}

          <View style={StyleSheet.absoluteFillObject}>
            <Animated.View style={[styles.scannerLine, animatedScanStyle]} />

            <View style={styles.hudTopLeft}>
              <View
                style={[
                  styles.liveDot,
                  selectedFile && {
                    backgroundColor: classificationResult
                      ? getResultColor(classificationResult)
                      : '#ff9800',
                  },
                ]}
              />

              <Text
                style={[
                  styles.liveText,
                  selectedFile && {
                    color: classificationResult
                      ? getResultColor(classificationResult)
                      : '#ff9800',
                  },
                ]}
              >
                {selectedFile
                  ? classificationResult
                    ? 'ANALYSIS COMPLETE'
                    : 'SCANNING MATRIX...'
                  : 'AWAITING UPLOAD'}
              </Text>
            </View>

            <View style={styles.hudTopRight}>
              <Animated.View style={[styles.recDot, animatedPulseStyle]} />
              <Text style={styles.hudText}>REC</Text>
            </View>

            <View style={styles.hudBottomLeft}>
              <Text style={styles.hudTextSmall}>MODEL: I3D + ViT v1.2</Text>
              <Text style={styles.hudTextSmall}>LENS: 24MM WIDE</Text>
            </View>

            <View style={styles.hudBottomRight}>
              <Text style={styles.hudTextSmall}>FPS: 60.00</Text>
              <Text style={styles.hudTextSmall}>POS: [42.36, -71.05]</Text>
            </View>

            <View style={[styles.bracket, styles.bracketTopLeft]} />
            <View style={[styles.bracket, styles.bracketTopRight]} />
            <View style={[styles.bracket, styles.bracketBottomLeft]} />
            <View style={[styles.bracket, styles.bracketBottomRight]} />
          </View>
        </View>

        <View style={styles.actionSection}>
          <Text style={styles.sectionTitle}>Manual Video / Image  Inspection</Text>

          <Text style={styles.instructionText}>
            Upload a local video file or image frame to run it through the I3D +
            ViT anomaly detection engine.
          </Text>

          <TouchableOpacity
            style={[styles.button, isLoading && styles.buttonDisabled]}
            onPress={pickFile}
            disabled={isLoading}
          >
            <Ionicons
              name="cloud-upload-outline"
              size={24}
              color="#000"
              style={{ marginRight: 10 }}
            />
            <Text style={styles.buttonText}>
              {isLoading ? 'ANALYZING FOOTAGE...' : 'UPLOAD & ANALYZE'}
            </Text>
          </TouchableOpacity>

          {classificationResult ? (
            <View
              style={[
                styles.resultContainer,
                { borderColor: getResultColor(classificationResult) },
              ]}
            >
              <Text style={styles.resultLabel}>ANALYSIS RESULT:</Text>
              <Text
                style={[
                  styles.resultText,
                  { color: getResultColor(classificationResult) },
                ]}
              >
                {getResultMessage(classificationResult)}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      <Modal
        visible={showResultModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowResultModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.analysisModal}>
            <TouchableOpacity
              style={styles.closeIcon}
              onPress={() => setShowResultModal(false)}
            >
              <Ionicons name="close-circle" size={30} color={NEON_GREEN} />
            </TouchableOpacity>

            <Text style={styles.modalHeading}>ANALYSIS COMPLETE</Text>

            <Text style={styles.modalLabel}>Final Result</Text>
            <Text style={styles.modalValue}>
              {analysisData?.result || 'Unknown'}
            </Text>

            <Text style={styles.modalLabel}>Confidence</Text>
            <Text style={styles.modalValue}>
              {(Number(analysisData?.confidence || 0) * 100).toFixed(1)}%
            </Text>

            <Text style={styles.modalLabel}>I3D Prediction</Text>
            <Text style={styles.modalValue}>
              {analysisData?.i3d_prediction?.label || 'N/A'} - {((analysisData?.i3d_prediction?.confidence || 0) * 100).toFixed(1)}%
            </Text>

            <Text style={styles.modalLabel}>ViT Prediction</Text>
            <Text style={styles.modalValue}>
              {analysisData?.vit_prediction?.label || 'N/A'} - {((analysisData?.vit_prediction?.confidence || 0) * 100).toFixed(1)}%
            </Text>

            <Text style={styles.modalLabel}>Alert Status</Text>
            <Text style={styles.modalValue}>
              {analysisData?.alert_created ? 'Alert Generated' : 'No Alert'}
            </Text>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: DARK_BG },

  header: {
    padding: 20,
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 82, 0.05)',
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(16, 185, 82, 0.2)',
  },

  neonGlow: {
    textShadowColor: NEON_GREEN,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },

  headerTitle: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 2,
    marginTop: 10,
    color: '#fff',
  },

  headerSubtitle: {
    fontSize: 12,
    color: NEON_GREEN,
    letterSpacing: 1,
    marginTop: 5,
    textTransform: 'uppercase',
  },

  mainContent: { padding: 20 },

  videoContainer: {
    width: '100%',
    height: 220,
    backgroundColor: 'rgba(16, 185, 82, 0.02)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 82, 0.3)',
    marginBottom: 30,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },

  scannerLine: {
    position: 'absolute',
    top: 0,
    width: '100%',
    height: 2,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 10,
    elevation: 5,
    zIndex: 10,
  },

  hudTopLeft: {
    position: 'absolute',
    top: 15,
    left: 15,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    zIndex: 20,
  },

  hudTopRight: {
    position: 'absolute',
    top: 15,
    right: 15,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 20,
  },

  hudBottomLeft: {
    position: 'absolute',
    bottom: 15,
    left: 15,
    zIndex: 20,
  },

  hudBottomRight: {
    position: 'absolute',
    bottom: 15,
    right: 15,
    alignItems: 'flex-end',
    zIndex: 20,
  },

  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: NEON_GREEN,
    marginRight: 6,
  },

  liveText: {
    color: NEON_GREEN,
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
  },

  recDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ff3333',
    marginRight: 6,
  },

  hudText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
  },

  hudTextSmall: {
    color: 'rgba(16, 185, 82, 0.6)',
    fontSize: 9,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    letterSpacing: 1,
    marginTop: 2,
  },

  bracket: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderColor: 'rgba(16, 185, 82, 0.5)',
    zIndex: 15,
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

  actionSection: {
    backgroundColor: 'rgba(16, 185, 82, 0.03)',
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 82, 0.1)',
  },

  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#fff',
    letterSpacing: 1,
  },

  instructionText: {
    fontSize: 14,
    lineHeight: 22,
    color: MUTED_GREEN,
    marginBottom: 25,
  },

  button: {
    flexDirection: 'row',
    backgroundColor: NEON_GREEN,
    padding: 18,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: NEON_GREEN,
    shadowRadius: 10,
    shadowOpacity: 0.3,
    elevation: 5,
  },

  buttonDisabled: {
    backgroundColor: '#3a5240',
    shadowOpacity: 0,
    elevation: 0,
  },

  buttonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1,
  },

  resultContainer: {
    padding: 20,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
    marginTop: 20,
    borderWidth: 1,
    alignItems: 'center',
  },

  resultLabel: {
    color: MUTED_GREEN,
    fontSize: 12,
    letterSpacing: 2,
    marginBottom: 8,
  },

  resultText: {
    fontSize: 16,
    textAlign: 'center',
    fontWeight: '900',
    letterSpacing: 1,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },

  analysisModal: {
    width: '100%',
    backgroundColor: '#071007',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: NEON_GREEN,
    padding: 24,
  },

  closeIcon: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 100,
  },

  modalHeading: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 20,
    letterSpacing: 2,
  },

  modalLabel: {
    color: NEON_GREEN,
    marginTop: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
  },

  modalValue: {
    color: '#fff',
    marginTop: 5,
    fontSize: 14,
  },
});