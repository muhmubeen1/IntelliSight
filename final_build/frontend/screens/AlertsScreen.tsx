import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import {
    ActivityIndicator,
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

const API_BASE_URL = 'http://192.168.100.12:5000';

export default function AlertsScreen() {
    const [alerts, setAlerts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState('');

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

            const response = await fetch(`${API_BASE_URL}/api/alerts`, {
                method: 'GET',
                headers: {
                    Accept: 'application/json',
                    Authorization: `Bearer ${token}`,
                },
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || data.msg || 'Failed to fetch alerts');
            }

            setAlerts(Array.isArray(data) ? data : data.alerts || []);
        } catch (error: any) {
            console.log('Alert fetch error:', error);
            setAlerts([]);
            setErrorMessage(error.message || 'Failed to fetch alerts');
        } finally {
            setLoading(false);
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

    useFocusEffect(
        useCallback(() => {
            fetchAlerts();
        }, [])
    );

    const unresolvedCount = alerts.filter(
        (alert) => alert.status?.toLowerCase() === 'unread'
    ).length;

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

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Ionicons name="warning" size={32} color={ALERT_RED} style={styles.redGlow} />
                <Text style={styles.headerTitle}>ANOMALY LOGS</Text>
                <Text style={styles.headerSubtitle}>
                    Unresolved Threats: {unresolvedCount}
                </Text>
            </View>

            {loading ? (
                <ActivityIndicator color={ALERT_RED} size="large" style={{ marginTop: 40 }} />
            ) : (
                <ScrollView contentContainerStyle={styles.content}>
                    {errorMessage ? (
                        <Text style={styles.emptyText}>{errorMessage}</Text>
                    ) : alerts.length === 0 ? (
                        <Text style={styles.emptyText}>No alerts found</Text>
                    ) : (
                        alerts.map((alert) => {
                            const resolved = alert.status?.toLowerCase() !== 'unread';

                            return (
                                <View
                                    key={alert.alert_id}
                                    style={[
                                        styles.alertCard,
                                        !resolved && { borderColor: 'rgba(255, 51, 51, 0.4)' },
                                    ]}
                                >
                                    <View style={styles.alertIcon}>
                                        <Ionicons
                                            name={resolved ? 'checkmark-circle' : 'alert-circle'}
                                            size={30}
                                            color={resolved ? NEON_GREEN : ALERT_RED}
                                        />
                                    </View>

                                    <View style={styles.alertInfo}>
                                        <Text style={[styles.alertType, !resolved && { color: ALERT_RED }]}>
                                            {alert.anomaly_type || alert.label || 'ANOMALY DETECTED'}
                                        </Text>

                                        <Text style={styles.alertDetails}>
                                            {(alert.filename || alert.source || 'UPLOAD')} // {formatTime(alert.created_at || alert.detected_at)}
                                        </Text>

                                        <Text style={styles.alertMessage}>
                                            {alert.message || 'Suspicious activity detected'}
                                        </Text>
                                    </View>

                                    <TouchableOpacity
                                        style={styles.alertAction}
                                        disabled={resolved}
                                        onPress={() => reviewAlert(alert.alert_id)}
                                    >
                                        <Text style={styles.actionText}>
                                            {resolved ? 'ARCHIVED' : 'REVIEW'}
                                        </Text>
                                    </TouchableOpacity>
                                </View>
                            );
                        })
                    )}
                </ScrollView>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: DARK_BG },
    header: {
        padding: 20,
        alignItems: 'center',
        backgroundColor: 'rgba(255, 51, 51, 0.05)',
        paddingTop: Platform.OS === 'ios' ? 60 : 40,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255, 51, 51, 0.2)',
    },
    redGlow: {
        textShadowColor: ALERT_RED,
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
        color: ALERT_RED,
        letterSpacing: 1,
        marginTop: 5,
        fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    },
    content: { padding: 20 },
    emptyText: {
        color: MUTED_GREEN,
        textAlign: 'center',
        marginTop: 40,
        fontSize: 14,
    },
    alertCard: {
        flexDirection: 'row',
        backgroundColor: 'rgba(16, 185, 82, 0.02)',
        padding: 15,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(16, 185, 82, 0.2)',
        marginBottom: 15,
        alignItems: 'center',
    },
    alertIcon: { marginRight: 15 },
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
    alertMessage: {
        color: '#C8D0CA',
        fontSize: 11,
        marginTop: 5,
    },
    alertAction: {
        backgroundColor: 'rgba(255,255,255,0.05)',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 6,
    },
    actionText: {
        color: '#fff',
        fontSize: 10,
        fontWeight: 'bold',
        letterSpacing: 1,
    },
});