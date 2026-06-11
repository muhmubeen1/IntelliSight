import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Platform,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const NEON_GREEN = '#10B952';
const DARK_BG = '#050705';
const MUTED_GREEN = '#8A9A8D';

const API_BASE_URL = 'http://192.168.100.12:5000';

export default function ArchivesScreen({ navigation }: any) {
    const [detections, setDetections] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const getToken = () => {
        return (
            localStorage.getItem('token') ||
            localStorage.getItem('jwt') ||
            localStorage.getItem('jwt_token') ||
            localStorage.getItem('access_token')
        );
    };

    const fetchDetections = async () => {
        try {
            const token = getToken();

            if (!token) {
                Alert.alert('Auth Error', 'Login token not found.');
                setDetections([]);
                return;
            }

            const response = await fetch(`${API_BASE_URL}/api/alerts`, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/json',
                },
            });

            const data = await response.json();

            if (!response.ok) {
                console.log('Archive API error:', data);
                setDetections([]);
                return;
            }

            const archivedItems = Array.isArray(data)
                ? data.filter((item) => {
                    const status = String(item.status || '').toLowerCase().trim();
                    return status === 'reviewed' || status === 'archived';
                })
                : [];

            setDetections(archivedItems);
        } catch (error) {
            console.log('Archive fetch error:', error);
            Alert.alert('Error', 'Unable to load archived detections.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const onRefresh = () => {
        setRefreshing(true);
        fetchDetections();
    };

    const exportReport = async () => {
        try {
            const token = getToken();

            if (!token) {
                Alert.alert('Auth Error', 'Login token not found.');
                return;
            }

            const pdfUrl = `${API_BASE_URL}/api/reports/detections/pdf`;

            const fileUri =
                FileSystem.cacheDirectory + 'intellisight_archived_report.pdf';

            const downloadResult = await FileSystem.downloadAsync(pdfUrl, fileUri, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            const sharingAvailable = await Sharing.isAvailableAsync();

            if (sharingAvailable) {
                await Sharing.shareAsync(downloadResult.uri);
            } else {
                Alert.alert('Report Downloaded', `Saved at:\n${downloadResult.uri}`);
            }
        } catch (error) {
            console.log('PDF export error:', error);
            Alert.alert('Export Error', 'Unable to export PDF report.');
        }
    };

    useEffect(() => {
        fetchDetections();
    }, []);

    const formatDate = (dateString: string) => {
        if (!dateString) return 'NO DATE';
        return new Date(dateString).toLocaleDateString();
    };

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Ionicons
                    name="server"
                    size={32}
                    color={NEON_GREEN}
                    style={styles.neonGlow}
                />

                <Text style={styles.headerTitle}>SECURE ARCHIVES</Text>

                <Text style={styles.headerSubtitle}>
                    Stored Events: {detections.length}
                </Text>

                <TouchableOpacity style={styles.exportButton} onPress={exportReport}>
                    <Ionicons name="download-outline" size={16} color={DARK_BG} />
                    <Text style={styles.exportText}>EXPORT REPORT</Text>
                </TouchableOpacity>
            </View>

            <ScrollView
                contentContainerStyle={styles.content}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        tintColor={NEON_GREEN}
                    />
                }
            >
                <Text style={styles.sectionTitle}>RECENT BACKUPS</Text>

                {loading ? (
                    <ActivityIndicator
                        color={NEON_GREEN}
                        size="large"
                        style={{ marginTop: 40 }}
                    />
                ) : detections.length === 0 ? (
                    <Text style={styles.emptyText}>No archived detections found.</Text>
                ) : (
                    <View style={styles.grid}>
                        {detections.map((item) => (
                            <TouchableOpacity
                                key={String(item.alert_id)}
                                style={styles.archiveBox}
                                onPress={() =>
                                    navigation.navigate('DetectionDetails', {
                                        detection: item,
                                    })
                                }
                            >
                                <Ionicons
                                    name="folder-outline"
                                    size={30}
                                    color={MUTED_GREEN}
                                />

                                <Text style={styles.archiveDate}>
                                    {formatDate(item.created_at)}
                                </Text>

                                <Text style={styles.archiveSize} numberOfLines={1}>
                                    {item.filename || 'Unknown File'}
                                </Text>

                                <Text style={styles.archiveSize} numberOfLines={1}>
                                    {item.anomaly_type || 'Unknown'}
                                </Text>

                                <Text style={styles.archiveSize}>
                                    Conf: {(Number(item.confidence || 0) * 100).toFixed(1)}%
                                </Text>

                                <Text style={styles.archiveStatus}>
                                    {item.status || 'reviewed'}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                )}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: DARK_BG,
    },
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
        fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    },
    exportButton: {
        marginTop: 14,
        backgroundColor: NEON_GREEN,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 9,
        borderRadius: 8,
        gap: 6,
    },
    exportText: {
        color: DARK_BG,
        fontSize: 11,
        fontWeight: '900',
        letterSpacing: 1,
    },
    content: {
        padding: 20,
    },
    sectionTitle: {
        color: MUTED_GREEN,
        fontSize: 12,
        fontWeight: 'bold',
        letterSpacing: 2,
        marginBottom: 15,
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        gap: 15,
    },
    archiveBox: {
        width: '47%',
        minHeight: 150,
        backgroundColor: 'rgba(16, 185, 82, 0.02)',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(16, 185, 82, 0.2)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 10,
    },
    archiveDate: {
        color: NEON_GREEN,
        fontSize: 12,
        fontWeight: 'bold',
        marginTop: 10,
        letterSpacing: 1,
    },
    archiveSize: {
        color: MUTED_GREEN,
        fontSize: 10,
        marginTop: 5,
        fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
        textAlign: 'center',
    },
    archiveStatus: {
        color: NEON_GREEN,
        fontSize: 9,
        marginTop: 6,
        textTransform: 'uppercase',
        letterSpacing: 1,
    },
    emptyText: {
        color: MUTED_GREEN,
        textAlign: 'center',
        marginTop: 40,
        fontSize: 13,
        letterSpacing: 1,
    },
});