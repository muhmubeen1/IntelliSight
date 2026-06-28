import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

import { getToken } from '../api';

const NEON_GREEN = '#10B952';
const DARK_BG = '#050705';
const MUTED_GREEN = '#8A9A8D';
const ALERT_RED = '#ff3333';
const ALERT_ORANGE = '#ff9800';

const API_BASE_URL = 'http://192.168.100.12:5000';

export default function AlertsScreen() {
    const [alerts, setAlerts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState('');
    const [selectedSession, setSelectedSession] = useState<any>(null);
    const [sessionDetections, setSessionDetections] = useState<any[]>([]);
    const [detailsVisible, setDetailsVisible] = useState(false);

    const fetchAlerts = async () => {
        try {
            setLoading(true);
            setErrorMessage('');

            const token = await getToken();

            if (!token) {
                setAlerts([]);
                setErrorMessage('Login token missing. Please login again.');
                return;
            }

            // Fetch manual/upload alerts and live stream sessions separately.
            // Live detections are saved under one stream session, so we map each
            // session to one card instead of showing every detection as a separate alert.
            const [alertsResponse, sessionsResponse] = await Promise.all([
                fetch(`${API_BASE_URL}/api/alerts`, {
                    method: 'GET',
                    headers: {
                        Accept: 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                }),
                fetch(`${API_BASE_URL}/api/live/sessions`, {
                    method: 'GET',
                    headers: {
                        Accept: 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                }),
            ]);

            const alertsData = await alertsResponse.json();
            const sessionsData = await sessionsResponse.json();

            if (!alertsResponse.ok) {
                throw new Error(alertsData.error || alertsData.msg || alertsData.message || 'Failed to fetch alerts');
            }

            if (!sessionsResponse.ok) {
                throw new Error(sessionsData.error || sessionsData.msg || sessionsData.message || 'Failed to fetch live sessions');
            }

            const manualAlerts = Array.isArray(alertsData)
                ? alertsData
                : alertsData.data || alertsData.alerts || [];

            const liveSessions = (sessionsData.data || []).map((session: any) => ({
                alert_id: `stream-${session.stream_id}`,
                stream_id: session.stream_id,
                source: 'stream',
                source_label: 'STREAM',
                filename: 'Live Stream',
                message: `Live stream session • ${session.total_detections || 0} detections`,
                severity: session.highest_severity || 'Medium',
                status: session.status || 'active',
                anomaly_type: 'Live Stream Session',
                confidence: null,
                created_at: session.started_at,
                is_stream_session: true,
            }));

            setAlerts([...liveSessions, ...manualAlerts]);
        } catch (error: any) {
            console.log('Alert fetch error:', error);
            setAlerts([]);
            setErrorMessage(error.message || 'Failed to fetch alerts');
        } finally {
            setLoading(false);
        }
    };


    const openSessionDetails = async (session: any) => {
        try {
            const token = await getToken();

            if (!token) {
                Alert.alert('Error', 'Login token missing. Please login again.');
                return;
            }

            const response = await fetch(
                `${API_BASE_URL}/api/live/sessions/${session.stream_id}/detections`,
                {
                    method: 'GET',
                    headers: {
                        Accept: 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Failed to fetch stream detections');
            }

            setSelectedSession(session);
            setSessionDetections(data.data || []);
            setDetailsVisible(true);
        } catch (error: any) {
            console.log('Open session details error:', error);
            Alert.alert('Error', error.message || 'Failed to open stream logs');
        }
    };

    const reviewAlert = async (alertId: number) => {
        try {
            const token = await getToken();

            const response = await fetch(
                `${API_BASE_URL}/api/alerts/${alertId}/review`,
                {
                    method: 'PUT',
                    headers: {
                        Accept: 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            if (response.ok) {
                fetchAlerts();
            }
        } catch (error) {
            console.log('Review alert error:', error);
        }
    };

    const archiveTodayLogs = async () => {
        try {
            const token = await getToken();

            if (!token) {
                setErrorMessage('Login token missing. Please login again.');
                return;
            }

            const response = await fetch(`${API_BASE_URL}/api/alerts/archive-today`, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    Authorization: `Bearer ${token}`,
                },
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Failed to archive today logs');
            }

            Alert.alert(
                'Success',
                'Today logs archived successfully.'
            );

            // Refresh Alerts screen
            await fetchAlerts();

        } catch (error: any) {
            console.log('Archive today error:', error);

            Alert.alert(
                'Archive Failed',
                error.message || 'Failed to archive today logs'
            );

            setErrorMessage(error.message || 'Failed to archive today logs');
        }
    };

    useFocusEffect(
        useCallback(() => {
            fetchAlerts();
        }, [])
    );

    const unresolvedCount = alerts.filter((alert) => {
        const status = alert.status?.toLowerCase();
        return status === 'unread' || status === 'new' || status === 'active';
    }).length;

    const formatTime = (dateString: string) => {
        if (!dateString) return 'TIME';

        const date = new Date(dateString);

        if (isNaN(date.getTime())) return 'TIME';

        return date.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
    };

    // Get severity color based on severity level
    const getSeverityColor = (severity: string | undefined) => {
        const s = severity?.toLowerCase() || 'low';
        if (s === 'high') return ALERT_RED;
        if (s === 'medium') return ALERT_ORANGE;
        return NEON_GREEN;
    };

    // Get severity icon based on severity
    const getSeverityIcon = (severity: string | undefined) => {
        const s = severity?.toLowerCase() || 'low';
        if (s === 'high') return 'alert-circle';
        if (s === 'medium') return 'warning';
        return 'information-circle';
    };

    // Get card border color based on severity
    const getCardBorderColor = (severity: string | undefined) => {
        const s = severity?.toLowerCase() || 'low';
        if (s === 'high') return 'rgba(255, 51, 51, 0.4)';
        if (s === 'medium') return 'rgba(255, 152, 0, 0.4)';
        return 'rgba(16, 185, 82, 0.2)';
    };

    // Get card background tint based on severity
    const getCardBgColor = (severity: string | undefined) => {
        const s = severity?.toLowerCase() || 'low';
        if (s === 'high') return 'rgba(255, 51, 51, 0.05)';
        if (s === 'medium') return 'rgba(255, 152, 0, 0.03)';
        return 'rgba(16, 185, 82, 0.02)';
    };

    // Count by severity
    const highCount = alerts.filter(a => a.severity?.toLowerCase() === 'high').length;
    const mediumCount = alerts.filter(a => a.severity?.toLowerCase() === 'medium').length;
    const lowCount = alerts.filter(a => a.severity?.toLowerCase() === 'low' || !a.severity).length;

    return (
        <View style={alertStyles.alertContainer}>
            <View style={alertStyles.alertHeader}>
                <Ionicons name="warning" size={32} color={ALERT_RED} style={alertStyles.alertRedGlow} />
                <Text style={alertStyles.alertHeaderTitle}>ANOMALY LOGS</Text>
                <Text style={alertStyles.alertHeaderSubtitle}>
                    Unresolved Threats: {unresolvedCount}
                </Text>

                {/* Severity Breakdown */}
                <View style={alertStyles.alertSeverityBreakdown}>
                    <View style={alertStyles.alertSeverityPill}>
                        <View style={[alertStyles.alertSeverityDot, { backgroundColor: ALERT_RED }]} />
                        <Text style={[alertStyles.alertSeverityText, { color: ALERT_RED }]}>{highCount} High</Text>
                    </View>
                    <View style={alertStyles.alertSeverityPill}>
                        <View style={[alertStyles.alertSeverityDot, { backgroundColor: ALERT_ORANGE }]} />
                        <Text style={[alertStyles.alertSeverityText, { color: ALERT_ORANGE }]}>{mediumCount} Med</Text>
                    </View>
                    <View style={alertStyles.alertSeverityPill}>
                        <View style={[alertStyles.alertSeverityDot, { backgroundColor: NEON_GREEN }]} />
                        <Text style={[alertStyles.alertSeverityText, { color: NEON_GREEN }]}>{lowCount} Low</Text>
                    </View>
                </View>

                <TouchableOpacity
                    style={alertStyles.archiveTodayButton}
                    onPress={archiveTodayLogs}
                >
                    <Ionicons name="archive-outline" size={16} color={DARK_BG} />
                    <Text style={alertStyles.archiveTodayText}>ARCHIVE TODAY LOGS</Text>
                </TouchableOpacity>
            </View>

            {loading ? (
                <ActivityIndicator color={ALERT_RED} size="large" style={{ marginTop: 40 }} />
            ) : (
                <ScrollView contentContainerStyle={alertStyles.alertContent}>
                    {errorMessage ? (
                        <Text style={alertStyles.alertEmptyText}>{errorMessage}</Text>
                    ) : alerts.length === 0 ? (
                        <Text style={alertStyles.alertEmptyText}>No alerts found</Text>
                    ) : (
                        alerts.map((alert) => {
                            const status = alert.status?.toLowerCase();
                            const resolved = status !== 'unread' && status !== 'new' && status !== 'active';
                            const severityColor = getSeverityColor(alert.severity);
                            const severityIcon = getSeverityIcon(alert.severity);

                            return (
                                <TouchableOpacity
                                    key={alert.alert_id}
                                    activeOpacity={alert.is_stream_session ? 0.85 : 1}
                                    onPress={() => {
                                        if (alert.is_stream_session) {
                                            openSessionDetails(alert);
                                        }
                                    }}
                                    style={[
                                        alertStyles.alertCard,
                                        {
                                            borderColor: getCardBorderColor(alert.severity),
                                            backgroundColor: getCardBgColor(alert.severity),
                                        },
                                    ]}
                                >
                                    <View style={alertStyles.alertIcon}>
                                        <Ionicons
                                            name={resolved ? 'checkmark-circle' : severityIcon}
                                            size={30}
                                            color={resolved ? NEON_GREEN : severityColor}
                                        />
                                        {!resolved && (
                                            <View style={[
                                                alertStyles.alertSeverityBadge,
                                                { backgroundColor: severityColor }
                                            ]}>
                                                <Text style={alertStyles.alertSeverityBadgeText}>
                                                    {(alert.severity || 'LOW').toUpperCase()}
                                                </Text>
                                            </View>
                                        )}
                                    </View>

                                    <View style={alertStyles.alertInfo}>
                                        <Text style={[
                                            alertStyles.alertType,
                                            !resolved && { color: severityColor }
                                        ]}>
                                            {alert.anomaly_type || alert.label || 'ANOMALY DETECTED'}
                                        </Text>

                                        <View style={alertStyles.alertSourceRow}>
                                            <View
                                                style={[
                                                    alertStyles.alertSourceBadge,
                                                    {
                                                        backgroundColor:
                                                            alert.source === 'stream'
                                                                ? ALERT_RED
                                                                : NEON_GREEN,
                                                    },
                                                ]}
                                            >
                                                <Text style={alertStyles.alertSourceBadgeText}>
                                                    {alert.source_label || 'MANUAL'}
                                                </Text>
                                            </View>

                                            <Text style={alertStyles.alertDetails}>
                                                {(alert.filename || alert.source || 'UPLOAD')} // {formatTime(alert.created_at || alert.detected_at)}
                                            </Text>
                                        </View>

                                        <Text style={alertStyles.alertMessage}>
                                            {alert.message || 'Suspicious activity detected'}
                                        </Text>

                                        {/* Show severity tag for normal logs too */}
                                        {alert.severity && (
                                            <View style={[
                                                alertStyles.alertTag,
                                                { borderColor: severityColor }
                                            ]}>
                                                <Text style={[
                                                    alertStyles.alertTagText,
                                                    { color: severityColor }
                                                ]}>
                                                    Severity: {alert.severity}
                                                </Text>
                                            </View>
                                        )}
                                    </View>

                                    <TouchableOpacity
                                        style={[
                                            alertStyles.alertAction,
                                            resolved && alertStyles.alertActionResolved
                                        ]}
                                        disabled={resolved && !alert.is_stream_session}
                                        onPress={() => {
                                            if (alert.is_stream_session) {
                                                openSessionDetails(alert);
                                            } else {
                                                reviewAlert(alert.alert_id);
                                            }
                                        }}
                                    >
                                        <Text style={[
                                            alertStyles.alertActionText,
                                            resolved && { color: MUTED_GREEN }
                                        ]}>
                                            {alert.is_stream_session ? 'SESSION' : resolved ? 'ARCHIVED' : 'REVIEW'}
                                        </Text>
                                    </TouchableOpacity>
                                </TouchableOpacity>
                            );
                        })
                    )}
                </ScrollView>
            )}

            <Modal
                visible={detailsVisible}
                transparent
                animationType="fade"
                onRequestClose={() => setDetailsVisible(false)}
            >
                <View style={alertStyles.modalOverlay}>
                    <View style={alertStyles.modalBox}>
                        <Text style={alertStyles.modalTitle}>LIVE STREAM DETECTIONS</Text>

                        <Text style={alertStyles.modalSubtitle}>
                            {selectedSession?.filename || 'Live Stream'} // Total Detections: {sessionDetections.length}
                        </Text>

                        <ScrollView style={alertStyles.modalScrollArea}>
                            {sessionDetections.length === 0 ? (
                                <Text style={alertStyles.modalEmptyText}>No detections found for this stream.</Text>
                            ) : (
                                sessionDetections.map((d) => {
                                    const detectionSeverityColor = getSeverityColor(d.severity);

                                    return (
                                        <View key={d.detection_id} style={alertStyles.detectionRow}>
                                            <View style={[alertStyles.detectionDot, { backgroundColor: detectionSeverityColor }]} />
                                            <View style={{ flex: 1 }}>
                                                <Text style={[alertStyles.detectionType, { color: detectionSeverityColor }]}>
                                                    {d.anomaly_type || 'Anomaly'}
                                                </Text>
                                                <Text style={alertStyles.detectionMeta}>
                                                    {formatTime(d.detected_at || d.frame_timestamp)} // {d.confidence ? `${(d.confidence * 100).toFixed(1)}%` : 'N/A'} // {d.severity || 'Low'}
                                                </Text>
                                            </View>
                                        </View>
                                    );
                                })
                            )}
                        </ScrollView>

                        <TouchableOpacity
                            style={alertStyles.modalCloseButton}
                            onPress={() => setDetailsVisible(false)}
                        >
                            <Text style={alertStyles.modalCloseText}>CLOSE</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const alertStyles = StyleSheet.create({
    alertContainer: { flex: 1, backgroundColor: DARK_BG },
    alertHeader: {
        padding: 20,
        alignItems: 'center',
        backgroundColor: 'rgba(255, 51, 51, 0.05)',
        paddingTop: Platform.OS === 'ios' ? 60 : 40,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255, 51, 51, 0.2)',
    },
    alertRedGlow: {
        textShadowColor: ALERT_RED,
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 10,
    },
    alertHeaderTitle: {
        fontSize: 22,
        fontWeight: '900',
        letterSpacing: 2,
        marginTop: 10,
        color: '#fff',
    },
    alertHeaderSubtitle: {
        fontSize: 12,
        color: ALERT_RED,
        letterSpacing: 1,
        marginTop: 5,
        fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    },
    alertSeverityBreakdown: {
        flexDirection: 'row',
        marginTop: 12,
        gap: 10,
    },
    alertSeverityPill: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.3)',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    alertSeverityDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginRight: 6,
    },
    alertSeverityText: {
        fontSize: 11,
        fontWeight: 'bold',
        letterSpacing: 1,
    },
    archiveTodayButton: {
        marginTop: 14,
        backgroundColor: NEON_GREEN,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderRadius: 8,
        gap: 6,
    },
    archiveTodayText: {
        color: DARK_BG,
        fontSize: 11,
        fontWeight: '900',
        letterSpacing: 1,
    },
    alertContent: { padding: 20 },
    alertEmptyText: {
        color: MUTED_GREEN,
        textAlign: 'center',
        marginTop: 40,
        fontSize: 14,
    },
    alertCard: {
        flexDirection: 'row',
        padding: 15,
        borderRadius: 12,
        borderWidth: 1,
        marginBottom: 15,
        alignItems: 'center',
    },
    alertIcon: {
        marginRight: 15,
        alignItems: 'center',
    },
    alertSeverityBadge: {
        marginTop: 4,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    alertSeverityBadgeText: {
        color: '#fff',
        fontSize: 8,
        fontWeight: 'bold',
        letterSpacing: 1,
    },
    alertInfo: { flex: 1 },
    alertType: {
        color: NEON_GREEN,
        fontSize: 16,
        fontWeight: 'bold',
        letterSpacing: 1,
        marginBottom: 4,
        textTransform: 'uppercase',
    },
    alertDetails: {
        color: MUTED_GREEN,
        fontSize: 12,
        fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    },
    alertSourceRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 2,
    },
    alertSourceBadge: {
        borderRadius: 5,
        paddingHorizontal: 6,
        paddingVertical: 2,
        marginRight: 8,
    },
    alertSourceBadgeText: {
        color: '#fff',
        fontSize: 9,
        fontWeight: 'bold',
        letterSpacing: 1,
    },
    alertMessage: {
        color: '#C8D0CA',
        fontSize: 11,
        marginTop: 5,
    },
    alertTag: {
        marginTop: 6,
        alignSelf: 'flex-start',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 4,
        borderWidth: 1,
    },
    alertTagText: {
        fontSize: 10,
        fontWeight: 'bold',
        letterSpacing: 1,
    },
    alertAction: {
        backgroundColor: 'rgba(255,255,255,0.05)',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 6,
    },
    alertActionResolved: {
        backgroundColor: 'rgba(138, 154, 141, 0.05)',
    },
    alertActionText: {
        color: '#fff',
        fontSize: 10,
        fontWeight: 'bold',
        letterSpacing: 1,
    },

    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.75)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    modalBox: {
        width: '100%',
        maxWidth: 520,
        backgroundColor: '#071007',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: 'rgba(16, 185, 82, 0.35)',
        padding: 18,
    },
    modalTitle: {
        color: NEON_GREEN,
        fontSize: 16,
        fontWeight: '900',
        letterSpacing: 1.5,
        textAlign: 'center',
    },
    modalSubtitle: {
        color: MUTED_GREEN,
        fontSize: 11,
        textAlign: 'center',
        marginTop: 8,
        marginBottom: 12,
        fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    },
    modalScrollArea: {
        maxHeight: 350,
        marginTop: 4,
    },
    modalEmptyText: {
        color: MUTED_GREEN,
        textAlign: 'center',
        paddingVertical: 20,
        fontSize: 12,
    },
    detectionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.03)',
        borderRadius: 8,
        padding: 10,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.06)',
    },
    detectionDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        marginRight: 10,
    },
    detectionType: {
        fontSize: 13,
        fontWeight: '900',
        letterSpacing: 1,
        textTransform: 'uppercase',
    },
    detectionMeta: {
        color: MUTED_GREEN,
        fontSize: 11,
        marginTop: 3,
        fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    },
    modalCloseButton: {
        marginTop: 14,
        backgroundColor: NEON_GREEN,
        paddingVertical: 10,
        borderRadius: 8,
        alignItems: 'center',
    },
    modalCloseText: {
        color: DARK_BG,
        fontSize: 12,
        fontWeight: '900',
        letterSpacing: 1,
    },
});