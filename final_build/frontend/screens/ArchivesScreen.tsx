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
    const [archives, setArchives] = useState<any[]>([]);
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

    const fetchArchives = async () => {
        try {
            const token = getToken();

            if (!token) {
                Alert.alert('Auth Error', 'Login token not found.');
                setArchives([]);
                return;
            }

            const response = await fetch(`${API_BASE_URL}/api/alerts/archives`, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/json',
                },
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                console.log('Archives API error:', data);
                setArchives([]);
                return;
            }

            setArchives(data.data || data.archives || []);
        } catch (error) {
            console.log('Archive fetch error:', error);
            Alert.alert('Error', 'Unable to load archives.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const onRefresh = () => {
        setRefreshing(true);
        fetchArchives();
    };

    const downloadArchivePdf = async (archiveId: number, archiveDate: string) => {
        try {
            const token = getToken();

            if (!token) {
                Alert.alert('Auth Error', 'Login token not found.');
                return;
            }

            const pdfUrl = `${API_BASE_URL}/api/alerts/archive/${archiveId}/pdf`;

            if (Platform.OS === 'web') {
                const response = await fetch(pdfUrl, {
                    method: 'GET',
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                });

                if (!response.ok) {
                    throw new Error('Failed to download PDF');
                }

                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);

                const link = document.createElement('a');
                link.href = url;
                link.download = `IntelliSight_Archive_${archiveDate}.pdf`;
                document.body.appendChild(link);
                link.click();

                document.body.removeChild(link);
                window.URL.revokeObjectURL(url);

                return;
            }

            const fileUri =
                FileSystem.cacheDirectory + `intellisight_archive_${archiveDate}.pdf`;

            const downloadResult = await FileSystem.downloadAsync(pdfUrl, fileUri, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            const sharingAvailable = await Sharing.isAvailableAsync();

            if (sharingAvailable) {
                await Sharing.shareAsync(downloadResult.uri);
            } else {
                Alert.alert('PDF Downloaded', `Saved at:\n${downloadResult.uri}`);
            }
        } catch (error) {
            console.log('Archive PDF download error:', error);
            Alert.alert('Download Error', 'Unable to download archive PDF.');
        }
    };

    useEffect(() => {
        fetchArchives();
    }, []);

    const formatDate = (dateString: string) => {
        if (!dateString) return 'NO DATE';

        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });
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
                    Archive Days: {archives.length}
                </Text>
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
                <Text style={styles.sectionTitle}>DAILY ALERT ARCHIVES</Text>

                {loading ? (
                    <ActivityIndicator
                        color={NEON_GREEN}
                        size="large"
                        style={{ marginTop: 40 }}
                    />
                ) : archives.length === 0 ? (
                    <Text style={styles.emptyText}>No archive records found.</Text>
                ) : (
                    <View style={styles.grid}>
                        {archives.map((item) => (
                            <View
                                key={String(item.archive_id)}
                                style={styles.archiveBox}
                            >
                                <Ionicons
                                    name="archive-outline"
                                    size={30}
                                    color={NEON_GREEN}
                                />

                                <Text style={styles.archiveDate}>
                                    {formatDate(item.archive_date)}
                                </Text>

                                <Text style={styles.archiveSize}>
                                    Total Alerts: {item.total_alerts}
                                </Text>

                                <Text style={styles.archiveSize}>
                                    High: {item.high_count} | Medium: {item.medium_count} | Low: {item.low_count}
                                </Text>

                                <Text style={styles.archiveSize}>
                                    Stream: {item.stream_alerts}
                                </Text>

                                <Text style={styles.archiveSize}>
                                    Manual: {item.manual_alerts}
                                </Text>

                                <TouchableOpacity
                                    style={styles.downloadButton}
                                    onPress={() =>
                                        downloadArchivePdf(
                                            item.archive_id,
                                            item.archive_date
                                        )
                                    }
                                >
                                    <Ionicons
                                        name="download-outline"
                                        size={14}
                                        color={DARK_BG}
                                    />
                                    <Text style={styles.downloadText}>
                                        PDF REPORT
                                    </Text>
                                </TouchableOpacity>
                            </View>
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
        minHeight: 210,
        backgroundColor: 'rgba(16, 185, 82, 0.02)',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(16, 185, 82, 0.2)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 12,
    },
    archiveDate: {
        color: NEON_GREEN,
        fontSize: 12,
        fontWeight: 'bold',
        marginTop: 10,
        letterSpacing: 1,
        textAlign: 'center',
    },
    archiveSize: {
        color: MUTED_GREEN,
        fontSize: 10,
        marginTop: 6,
        fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
        textAlign: 'center',
    },
    downloadButton: {
        marginTop: 12,
        backgroundColor: NEON_GREEN,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderRadius: 8,
        gap: 5,
    },
    downloadText: {
        color: DARK_BG,
        fontSize: 9,
        fontWeight: '900',
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