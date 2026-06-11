import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
    Platform,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const NEON_GREEN = '#10B952';
const DARK_BG = '#050705';
const MUTED_GREEN = '#8A9A8D';

export default function DetectionDetailsScreen({ route, navigation }: any) {
    const { detection } = route.params;

    return (
        <View style={styles.container}>

            <TouchableOpacity
                style={styles.closeButton}
                onPress={() => navigation.goBack()}
            >
                <Ionicons
                    name="close"
                    size={22}
                    color={DARK_BG}
                />
            </TouchableOpacity>

            <View style={styles.header}>
                <Ionicons
                    name="document-text-outline"
                    size={36}
                    color={NEON_GREEN}
                />
                <Text style={styles.title}>DETECTION DETAILS</Text>
            </View>

            <View style={styles.card}>
                <Text style={styles.label}>File Name</Text>
                <Text style={styles.value}>
                    {detection.filename}
                </Text>

                <Text style={styles.label}>Anomaly Type</Text>
                <Text style={styles.value}>
                    {detection.anomaly_type}
                </Text>

                <Text style={styles.label}>Confidence</Text>
                <Text style={styles.value}>
                    {(Number(detection.confidence) * 100).toFixed(1)}%
                </Text>

                <Text style={styles.label}>Detected At</Text>
                <Text style={styles.value}>
                    {detection.created_at
                        ? new Date(detection.created_at).toLocaleString()
                        : detection.detected_at
                            ? new Date(detection.detected_at).toLocaleString()
                            : 'No Date'}
                </Text>

                <Text style={styles.label}>Event ID</Text>
                <Text style={styles.value}>
                    {detection.event_id || detection.alert_id || 'N/A'}
                </Text>
            </View>

        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: DARK_BG,
        padding: 20,
    },

    closeButton: {
        position: 'absolute',
        top: Platform.OS === 'ios' ? 55 : 25,
        right: 20,
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: NEON_GREEN,
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 999,
        elevation: 10,
    },

    header: {
        alignItems: 'center',
        marginTop: Platform.OS === 'ios' ? 60 : 40,
        marginBottom: 30,
    },

    title: {
        color: '#fff',
        fontSize: 22,
        fontWeight: '900',
        letterSpacing: 2,
        marginTop: 12,
    },

    card: {
        borderWidth: 1,
        borderColor: 'rgba(16,185,82,0.3)',
        backgroundColor: 'rgba(16,185,82,0.04)',
        borderRadius: 14,
        padding: 20,
    },

    label: {
        color: NEON_GREEN,
        fontSize: 12,
        fontWeight: 'bold',
        letterSpacing: 1,
        marginTop: 15,
    },

    value: {
        color: MUTED_GREEN,
        fontSize: 14,
        marginTop: 6,
        fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    },
});