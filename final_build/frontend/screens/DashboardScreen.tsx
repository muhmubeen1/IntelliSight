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
  const [logSavedMessage, setLogSavedMessage] = useState<string>('');

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

    if (classificationResult && classificationResult !== 'NormalVideos') {
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
    if (result === 'NormalVideos') return NEON_GREEN;
    if (result === 'Unknown' || result === 'Uncertain') return '#ff9800';
    if (result === 'Error during classification') return '#f44336';
    return '#ff3333';
  };

  const getResultMessage = (result: string): string => {
    if (result === 'NormalVideos') {
      return 'SYSTEM CLEAR: No anomalies detected';
    }

    if (result === 'Unknown' || result === 'Uncertain') {
      return `ANALYSIS UNCERTAIN: ${result}`;
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
    setLogSavedMessage('');

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
        // Try to get the file directly from the picker result
        // ImagePicker on web sometimes provides the file object directly
        const fileObj = file.file || new File([], name, { type: 'video/mp4' });

        // If we have a real file object, use it
        if (fileObj && fileObj.size > 0) {
          formData.append('video', fileObj);
        } else {
          // Fallback: fetch the blob URL before it expires
          const fileResponse = await fetch(file.uri);
          const blob = await fileResponse.blob();
          const newFile = new File([blob], name, { type: blob.type || 'video/mp4' });
          formData.append('video', newFile);
        }

      } else {
        formData.append('video', {
          uri: file.uri,
          type: file.type === 'video' ? 'video/mp4' : 'image/jpeg',
          name,
        } as any);
      }
      console.log('About to classify:', `${API_URL}/api/classify`);
      console.log('Token present:', !!token);
      console.log('FormData has video:', (formData as any).has?.('video'));

      const response = await fetch(`${API_URL}/api/classify`, {
        method: 'POST',
        body: formData,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      console.log('Classify response status:', response.status);

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.msg || `HTTP ${response.status}`);
      }

      setClassificationResult(data.final_label || 'Unknown');
      setAnalysisData(data);
      setShowResultModal(true);

      // Show log saved message for ALL videos (normal + anomaly)
      const alertCount = data.alerts?.length || 0;
      const totalAnomalies = data.summary?.total_anomalies || 0;

      if (totalAnomalies === 0) {
        setLogSavedMessage('✅ Analysis complete. Normal video log saved to system.');
      } else {
        setLogSavedMessage(`✅ Analysis complete. ${alertCount} alert(s) logged to system.`);
      }

      // Auto-hide the message after 5 seconds
      setTimeout(() => setLogSavedMessage(''), 5000);

    } catch (error) {
      console.log('Classification error:', error);
      setClassificationResult('Error during classification');
    } finally {
      setIsLoading(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getSeverityColor = (severity: string) => {
    switch (severity?.toLowerCase()) {
      case 'high': return '#ff3333';
      case 'medium': return '#ff9800';
      case 'low': return NEON_GREEN;
      default: return MUTED_GREEN;
    }
  };

  return (
    <ScrollView
      style={dashStyles.dashContainer}
      contentContainerStyle={{ paddingBottom: 40 }}
    >
      <View style={dashStyles.dashHeader}>
        <Ionicons
          name="shield-checkmark"
          size={32}
          color={NEON_GREEN}
          style={dashStyles.dashNeonGlow}
        />
        <Text style={dashStyles.dashHeaderTitle}>INTELLISIGHT CORE</Text>
        <Text style={dashStyles.dashHeaderSubtitle}>System Status: Online</Text>
      </View>

      <View style={dashStyles.dashMainContent}>
        <View style={dashStyles.dashVideoContainer}>
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
            <Animated.View style={[dashStyles.dashScannerLine, animatedScanStyle]} />

            <View style={dashStyles.dashHudTopLeft}>
              <View
                style={[
                  dashStyles.dashLiveDot,
                  selectedFile && {
                    backgroundColor: classificationResult
                      ? getResultColor(classificationResult)
                      : '#ff9800',
                  },
                ]}
              />

              <Text
                style={[
                  dashStyles.dashLiveText,
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

            <View style={dashStyles.dashHudTopRight}>
              <Animated.View style={[dashStyles.dashRecDot, animatedPulseStyle]} />
              <Text style={dashStyles.dashHudText}>REC</Text>
            </View>

            <View style={dashStyles.dashHudBottomLeft}>
              <Text style={dashStyles.dashHudTextSmall}>MODEL: I3D + ViT v1.2</Text>
              <Text style={dashStyles.dashHudTextSmall}>LENS: 24MM WIDE</Text>
            </View>

            <View style={dashStyles.dashHudBottomRight}>
              <Text style={dashStyles.dashHudTextSmall}>FPS: 60.00</Text>
              <Text style={dashStyles.dashHudTextSmall}>POS: [42.36, -71.05]</Text>
            </View>

            <View style={[dashStyles.dashBracket, dashStyles.dashBracketTopLeft]} />
            <View style={[dashStyles.dashBracket, dashStyles.dashBracketTopRight]} />
            <View style={[dashStyles.dashBracket, dashStyles.dashBracketBottomLeft]} />
            <View style={[dashStyles.dashBracket, dashStyles.dashBracketBottomRight]} />
          </View>
        </View>

        <View style={dashStyles.dashActionSection}>
          <Text style={dashStyles.dashSectionTitle}>Manual Video / Image Inspection</Text>

          <Text style={dashStyles.dashInstructionText}>
            Upload a local video file or image frame to run it through the I3D +
            ViT anomaly detection engine.
          </Text>

          <TouchableOpacity
            style={[dashStyles.dashButton, isLoading && dashStyles.dashButtonDisabled]}
            onPress={pickFile}
            disabled={isLoading}
          >
            <Ionicons
              name="cloud-upload-outline"
              size={24}
              color="#000"
              style={{ marginRight: 10 }}
            />
            <Text style={dashStyles.dashButtonText}>
              {isLoading ? 'ANALYZING FOOTAGE...' : 'UPLOAD & ANALYZE'}
            </Text>
          </TouchableOpacity>

          {/* Log Saved Message Banner */}
          {logSavedMessage ? (
            <View style={dashStyles.dashLogBanner}>
              <Ionicons name="checkmark-circle" size={20} color={NEON_GREEN} />
              <Text style={dashStyles.dashLogBannerText}>{logSavedMessage}</Text>
            </View>
          ) : null}

          {classificationResult ? (
            <View
              style={[
                dashStyles.dashResultContainer,
                { borderColor: getResultColor(classificationResult) },
              ]}
            >
              <Text style={dashStyles.dashResultLabel}>ANALYSIS RESULT:</Text>
              <Text
                style={[
                  dashStyles.dashResultText,
                  { color: getResultColor(classificationResult) },
                ]}
              >
                {getResultMessage(classificationResult)}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* Enhanced Result Modal with Timeline */}
      <Modal
        visible={showResultModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowResultModal(false)}
      >
        <View style={dashStyles.dashModalOverlay}>
          <ScrollView style={dashStyles.dashModalScroll} contentContainerStyle={{ padding: 20, alignItems: 'center' }}>
            <View style={dashStyles.dashAnalysisModal}>
              <TouchableOpacity
                style={dashStyles.dashCloseIcon}
                onPress={() => setShowResultModal(false)}
              >
                <Ionicons name="close-circle" size={30} color={NEON_GREEN} />
              </TouchableOpacity>

              <Text style={dashStyles.dashModalHeading}>ANALYSIS COMPLETE</Text>

              {/* Summary Section */}
              {analysisData?.summary && (
                <View style={dashStyles.dashSummaryBox}>
                  <Text style={dashStyles.dashModalLabel}>Summary</Text>
                  <View style={dashStyles.dashSummaryRow}>
                    <Text style={dashStyles.dashSummaryKey}>Total Anomalies:</Text>
                    <Text style={dashStyles.dashSummaryValue}>{analysisData.summary.total_anomalies}</Text>
                  </View>
                  <View style={dashStyles.dashSummaryRow}>
                    <Text style={dashStyles.dashSummaryKey}>Anomaly Duration:</Text>
                    <Text style={dashStyles.dashSummaryValue}>{analysisData.summary.total_anomaly_duration}s</Text>
                  </View>
                  <View style={dashStyles.dashSummaryRow}>
                    <Text style={dashStyles.dashSummaryKey}>Highest Severity:</Text>
                    <Text style={[
                      dashStyles.dashSummaryValue,
                      { color: getSeverityColor(analysisData.summary.highest_severity) }
                    ]}>
                      {analysisData.summary.highest_severity}
                    </Text>
                  </View>
                  <View style={dashStyles.dashSummaryRow}>
                    <Text style={dashStyles.dashSummaryKey}>Video Duration:</Text>
                    <Text style={dashStyles.dashSummaryValue}>{analysisData.summary.video_duration}s</Text>
                  </View>
                </View>
              )}

              {/* Timeline Section */}
              {analysisData?.timeline && analysisData.timeline.length > 0 && (
                <View style={dashStyles.dashTimelineBox}>
                  <Text style={dashStyles.dashModalLabel}>Anomaly Timeline</Text>
                  {analysisData.timeline.map((item: any, index: number) => (
                    <View key={item.id || index} style={dashStyles.dashTimelineItem}>
                      <View style={dashStyles.dashTimelineHeader}>
                        <Text style={dashStyles.dashTimelineType}>{item.anomaly_type}</Text>
                        <Text style={[
                          dashStyles.dashTimelineConfidence,
                          { color: getSeverityColor(item.confidence >= 0.85 ? 'high' : item.confidence >= 0.70 ? 'medium' : 'low') }
                        ]}>
                          {(item.confidence * 100).toFixed(1)}%
                        </Text>
                      </View>
                      <Text style={dashStyles.dashTimelineTime}>
                        ⏱ {formatTime(item.start_time)} - {formatTime(item.end_time)} ({item.duration}s)
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {/* If no anomalies */}
              {analysisData?.summary?.total_anomalies === 0 && (
                <View style={dashStyles.dashNormalBox}>
                  <Ionicons name="checkmark-done-circle" size={48} color={NEON_GREEN} />
                  <Text style={dashStyles.dashNormalText}>No anomalies detected</Text>
                  <Text style={dashStyles.dashNormalSubtext}>Video log saved successfully</Text>
                </View>
              )}

              <Text style={dashStyles.dashModalLabel}>Final Result</Text>
              <Text style={dashStyles.dashModalValue}>
                {analysisData?.final_label || 'Unknown'}
              </Text>

              <Text style={dashStyles.dashModalLabel}>Confidence</Text>
              <Text style={dashStyles.dashModalValue}>
                {(Number(analysisData?.final_confidence || 0) * 100).toFixed(1)}%
              </Text>

              <Text style={dashStyles.dashModalLabel}>Alert Status</Text>
              <Text style={dashStyles.dashModalValue}>
                {analysisData?.alert_required ? 'Alert Generated' : 'No Alert'}
              </Text>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </ScrollView>
  );
}

const dashStyles = StyleSheet.create({
  dashContainer: { flex: 1, backgroundColor: DARK_BG },

  dashHeader: {
    padding: 20,
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 82, 0.05)',
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(16, 185, 82, 0.2)',
  },

  dashNeonGlow: {
    textShadowColor: NEON_GREEN,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },

  dashHeaderTitle: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 2,
    marginTop: 10,
    color: '#fff',
  },

  dashHeaderSubtitle: {
    fontSize: 12,
    color: NEON_GREEN,
    letterSpacing: 1,
    marginTop: 5,
    textTransform: 'uppercase',
  },

  dashMainContent: { padding: 20 },

  dashVideoContainer: {
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

  dashScannerLine: {
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

  dashHudTopLeft: {
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

  dashHudTopRight: {
    position: 'absolute',
    top: 15,
    right: 15,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 20,
  },

  dashHudBottomLeft: {
    position: 'absolute',
    bottom: 15,
    left: 15,
    zIndex: 20,
  },

  dashHudBottomRight: {
    position: 'absolute',
    bottom: 15,
    right: 15,
    alignItems: 'flex-end',
    zIndex: 20,
  },

  dashLiveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: NEON_GREEN,
    marginRight: 6,
  },

  dashLiveText: {
    color: NEON_GREEN,
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
  },

  dashRecDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ff3333',
    marginRight: 6,
  },

  dashHudText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
  },

  dashHudTextSmall: {
    color: 'rgba(16, 185, 82, 0.6)',
    fontSize: 9,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    letterSpacing: 1,
    marginTop: 2,
  },

  dashBracket: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderColor: 'rgba(16, 185, 82, 0.5)',
    zIndex: 15,
  },

  dashBracketTopLeft: {
    top: 10,
    left: 10,
    borderTopWidth: 2,
    borderLeftWidth: 2,
  },

  dashBracketTopRight: {
    top: 10,
    right: 10,
    borderTopWidth: 2,
    borderRightWidth: 2,
  },

  dashBracketBottomLeft: {
    bottom: 10,
    left: 10,
    borderBottomWidth: 2,
    borderLeftWidth: 2,
  },

  dashBracketBottomRight: {
    bottom: 10,
    right: 10,
    borderBottomWidth: 2,
    borderRightWidth: 2,
  },

  dashActionSection: {
    backgroundColor: 'rgba(16, 185, 82, 0.03)',
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 82, 0.1)',
  },

  dashSectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#fff',
    letterSpacing: 1,
  },

  dashInstructionText: {
    fontSize: 14,
    lineHeight: 22,
    color: MUTED_GREEN,
    marginBottom: 25,
  },

  dashButton: {
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

  dashButtonDisabled: {
    backgroundColor: '#3a5240',
    shadowOpacity: 0,
    elevation: 0,
  },

  dashButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1,
  },

  dashLogBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 82, 0.1)',
    borderRadius: 8,
    padding: 12,
    marginTop: 15,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 82, 0.3)',
  },

  dashLogBannerText: {
    color: NEON_GREEN,
    fontSize: 13,
    marginLeft: 10,
    fontWeight: '600',
  },

  dashResultContainer: {
    padding: 20,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
    marginTop: 20,
    borderWidth: 1,
    alignItems: 'center',
  },

  dashResultLabel: {
    color: MUTED_GREEN,
    fontSize: 12,
    letterSpacing: 2,
    marginBottom: 8,
  },

  dashResultText: {
    fontSize: 16,
    textAlign: 'center',
    fontWeight: '900',
    letterSpacing: 1,
  },

  dashModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  dashModalScroll: {
    width: '100%',
  },

  dashAnalysisModal: {
    width: '100%',
    maxWidth: width - 40,
    backgroundColor: '#071007',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: NEON_GREEN,
    padding: 24,
  },

  dashCloseIcon: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 100,
  },

  dashModalHeading: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 20,
    letterSpacing: 2,
  },

  dashModalLabel: {
    color: NEON_GREEN,
    marginTop: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
  },

  dashModalValue: {
    color: '#fff',
    marginTop: 5,
    fontSize: 14,
  },

  dashSummaryBox: {
    backgroundColor: 'rgba(16, 185, 82, 0.05)',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 82, 0.15)',
  },

  dashSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },

  dashSummaryKey: {
    color: MUTED_GREEN,
    fontSize: 12,
  },

  dashSummaryValue: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },

  dashTimelineBox: {
    backgroundColor: 'rgba(255, 51, 51, 0.05)',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 51, 51, 0.2)',
  },

  dashTimelineItem: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#ff3333',
  },

  dashTimelineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  dashTimelineType: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },

  dashTimelineConfidence: {
    fontSize: 12,
    fontWeight: 'bold',
  },

  dashTimelineTime: {
    color: MUTED_GREEN,
    fontSize: 11,
    marginTop: 4,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },

  dashNormalBox: {
    alignItems: 'center',
    padding: 20,
    marginBottom: 16,
  },

  dashNormalText: {
    color: NEON_GREEN,
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 10,
  },

  dashNormalSubtext: {
    color: MUTED_GREEN,
    fontSize: 12,
    marginTop: 5,
  },
});