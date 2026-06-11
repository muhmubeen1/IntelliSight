import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Platform, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';

const NEON_GREEN = '#10B952';
const DARK_BG = '#050705';
const MUTED_GREEN = '#8A9A8D';

export default function AuthChoiceScreen({ navigation }: any) {
    return (
        <View style={styles.container}>

            {/* ✨ FLOATING BACK BUTTON ✨ */}
            <SafeAreaView style={styles.backButtonContainer}>
                <Pressable
                    style={styles.backButton}
                    onPress={() => navigation.navigate('Welcome')}
                >
                    <Ionicons name="chevron-back" size={24} color={NEON_GREEN} />
                    <Text style={styles.backText}>Return</Text>
                </Pressable>
            </SafeAreaView>

            <View style={styles.content}>

                {/* Glowing Security Icon */}
                <Animated.View entering={FadeInDown.delay(100).duration(800)} style={styles.iconContainer}>
                    <Ionicons name="finger-print-outline" size={80} color={NEON_GREEN} style={styles.neonGlow} />
                </Animated.View>

                <Animated.Text entering={FadeInDown.delay(200).duration(800)} style={[styles.title, styles.textGlow]}>
                    IDENTITY{"\n"}VERIFICATION
                </Animated.Text>

                <Animated.Text entering={FadeInDown.delay(300).duration(800)} style={styles.subtitle}>
                    Establish your security clearance level to access the IntelliSight network.
                </Animated.Text>

                <View style={styles.buttonContainer}>

                    {/* PRIMARY ACTION: LOGIN */}
                    <Animated.View entering={FadeInUp.delay(500).duration(800)} style={{ width: '100%' }}>
                        <Pressable
                            style={styles.primaryButton}
                            onPress={() => navigation.navigate('Login')}
                        >
                            <Ionicons name="log-in-outline" size={24} color="#000" style={{ marginRight: 10 }} />
                            <Text style={styles.primaryButtonText}>AUTHENTICATE (LOGIN)</Text>
                        </Pressable>
                    </Animated.View>

                    {/* SECONDARY ACTION: SIGN UP */}
                    <Animated.View entering={FadeInUp.delay(600).duration(800)} style={{ width: '100%' }}>
                        <Pressable
                            style={styles.secondaryButton}
                            onPress={() => navigation.navigate('Signup')}
                        >
                            <Ionicons name="person-add-outline" size={22} color={NEON_GREEN} style={{ marginRight: 10 }} />
                            <Text style={styles.secondaryButtonText}>REQUEST CLEARANCE (SIGN UP)</Text>
                        </Pressable>
                    </Animated.View>

                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: DARK_BG },

    backButtonContainer: {
        position: 'absolute',
        top: Platform.OS === 'ios' ? 50 : 30,
        left: 20,
        zIndex: 50,
    },
    backButton: {
        flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(16, 185, 82, 0.1)',
        paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20,
        borderWidth: 1, borderColor: 'rgba(16, 185, 82, 0.3)',
    },
    backText: { color: NEON_GREEN, fontWeight: 'bold', fontSize: 14, marginLeft: 4, letterSpacing: 1 },

    content: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 30 },

    iconContainer: {
        width: 130, height: 130, borderRadius: 65,
        backgroundColor: 'rgba(16, 185, 82, 0.05)',
        justifyContent: 'center', alignItems: 'center',
        marginBottom: 30, borderWidth: 1, borderColor: 'rgba(16, 185, 82, 0.3)',
        shadowColor: NEON_GREEN, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 20, elevation: 10
    },
    neonGlow: { textShadowColor: NEON_GREEN, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 15 },
    textGlow: { textShadowColor: NEON_GREEN, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 10 },

    title: { color: 'white', fontSize: 36, fontWeight: '900', textAlign: 'center', letterSpacing: 3, marginBottom: 15 },
    subtitle: { color: MUTED_GREEN, fontSize: 15, textAlign: 'center', lineHeight: 24, marginBottom: 50, paddingHorizontal: 10 },

    buttonContainer: { width: '100%', gap: 20 }, // Spacing between buttons

    // Solid Neon Green Button
    primaryButton: {
        flexDirection: 'row', backgroundColor: NEON_GREEN, width: '100%', paddingVertical: 20,
        borderRadius: 12, justifyContent: 'center', alignItems: 'center',
        shadowColor: NEON_GREEN, shadowRadius: 15, shadowOpacity: 0.4, elevation: 8
    },
    primaryButtonText: { color: '#000000', fontWeight: '900', fontSize: 16, letterSpacing: 1.5 },

    // Transparent Outlined Button
    secondaryButton: {
        flexDirection: 'row', backgroundColor: 'transparent', width: '100%', paddingVertical: 20,
        borderRadius: 12, justifyContent: 'center', alignItems: 'center',
        borderWidth: 2, borderColor: NEON_GREEN,
    },
    secondaryButtonText: { color: NEON_GREEN, fontWeight: '900', fontSize: 16, letterSpacing: 1.5 },
});