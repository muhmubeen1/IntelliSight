import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const NEON_GREEN = '#10B952';
const DARK_BG = '#050705';
const MUTED_GREEN = '#8A9A8D';
const ALERT_RED = '#ff3333';

export default function ProfileScreen({ navigation }: any) {
    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Ionicons name="person-circle" size={50} color={NEON_GREEN} style={styles.neonGlow} />
                <Text style={styles.headerTitle}>OPERATOR PROFILE</Text>
                <Text style={styles.headerSubtitle}>Clearance Level: Tier 1</Text>
            </View>

            <View style={styles.content}>

                {/* ID Badge */}
                <View style={styles.idCard}>
                    <Text style={styles.label}>OPERATOR ID:</Text>
                    <Text style={styles.value}>OP-70126573</Text>
                    <View style={styles.divider} />
                    <Text style={styles.label}>STATUS:</Text>
                    <Text style={[styles.value, { color: NEON_GREEN }]}>ACTIVE DUTY</Text>
                </View>

                {/* Settings Menu */}
                <View style={styles.menuGroup}>
                    <TouchableOpacity style={styles.menuItem}>
                        <Ionicons name="notifications-outline" size={20} color={MUTED_GREEN} />
                        <Text style={styles.menuText}>Alert Preferences</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.menuItem}>
                        <Ionicons name="lock-closed-outline" size={20} color={MUTED_GREEN} />
                        <Text style={styles.menuText}>Security Settings</Text>
                    </TouchableOpacity>
                </View>

                {/* Logout Button */}
                <TouchableOpacity
                    style={styles.logoutButton}
                    onPress={() => navigation.replace('AuthChoice')}
                >
                    <Ionicons name="log-out-outline" size={20} color={ALERT_RED} />
                    <Text style={styles.logoutText}>SYSTEM LOGOUT</Text>
                </TouchableOpacity>

            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: DARK_BG },
    header: { padding: 20, alignItems: 'center', backgroundColor: 'rgba(16, 185, 82, 0.05)', paddingTop: Platform.OS === 'ios' ? 60 : 40, borderBottomWidth: 1, borderBottomColor: 'rgba(16, 185, 82, 0.2)' },
    neonGlow: { textShadowColor: NEON_GREEN, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 10 },
    headerTitle: { fontSize: 22, fontWeight: '900', letterSpacing: 2, marginTop: 10, color: '#fff' },
    headerSubtitle: { fontSize: 12, color: NEON_GREEN, letterSpacing: 1, marginTop: 5, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
    content: { padding: 20 },
    idCard: { backgroundColor: 'rgba(16, 185, 82, 0.05)', padding: 20, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(16, 185, 82, 0.3)', marginBottom: 30 },
    label: { color: MUTED_GREEN, fontSize: 10, fontWeight: 'bold', letterSpacing: 1, marginBottom: 5 },
    value: { color: '#fff', fontSize: 18, fontWeight: 'bold', letterSpacing: 2 },
    divider: { height: 1, backgroundColor: 'rgba(16, 185, 82, 0.2)', marginVertical: 15 },
    menuGroup: { backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', marginBottom: 30 },
    menuItem: { flexDirection: 'row', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
    menuText: { color: '#fff', fontSize: 14, marginLeft: 15, fontWeight: 'bold', letterSpacing: 1 },
    logoutButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255, 51, 51, 0.1)', padding: 18, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255, 51, 51, 0.3)' },
    logoutText: { color: ALERT_RED, fontSize: 14, fontWeight: '900', letterSpacing: 2, marginLeft: 10 }
});