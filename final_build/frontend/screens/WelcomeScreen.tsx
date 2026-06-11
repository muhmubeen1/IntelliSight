import { Ionicons } from '@expo/vector-icons';
import { ResizeMode, Video } from 'expo-av';
import React, { useEffect } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
    Extrapolate,
    interpolate,
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming
} from 'react-native-reanimated';

const NEON_GREEN = '#10B952';
const DARK_BG = '#050705';
const MUTED_GREEN = '#8A9A8D';
const OVERLAY_COLOR = 'rgba(5, 7, 5, 0.02)';

export default function WelcomeScreen({ navigation }: any) {
    const { width, height } = useWindowDimensions();

    const scrollY = useSharedValue(0);
    const bounceY = useSharedValue(0);
    const pulseAnim = useSharedValue(1);

    useEffect(() => {
        bounceY.value = withRepeat(withTiming(20, { duration: 1000 }), -1, true);
        pulseAnim.value = withRepeat(withTiming(1.04, { duration: 1500 }), -1, true);
    }, []);

    const scrollHandler = useAnimatedScrollHandler({
        onScroll: (event) => { scrollY.value = event.contentOffset.y; },
    });

    const videoFadeStyle = useAnimatedStyle(() => ({
        opacity: interpolate(scrollY.value, [0, height * 0.4], [0.4, 0.15], Extrapolate.CLAMP)
    }));

    // PAGE 2 ANIMATION
    const modulesStyle = useAnimatedStyle(() => ({
        opacity: interpolate(scrollY.value, [height * 0.3, height * 0.8], [0, 1], Extrapolate.CLAMP),
        transform: [{ translateY: interpolate(scrollY.value, [height * 0.3, height], [80, 0], Extrapolate.CLAMP) }]
    }));

    // PAGE 3 ANIMATION
    const teamStyle = useAnimatedStyle(() => ({
        opacity: interpolate(scrollY.value, [height * 1.3, height * 1.8], [0, 1], Extrapolate.CLAMP),
        transform: [{ translateY: interpolate(scrollY.value, [height * 1.3, height * 2], [80, 0], Extrapolate.CLAMP) }]
    }));

    // PAGE 4 (ABOUT) ANIMATION
    const aboutStyle = useAnimatedStyle(() => ({
        opacity: interpolate(scrollY.value, [height * 2.3, height * 2.8], [0, 1], Extrapolate.CLAMP),
        transform: [{ translateY: interpolate(scrollY.value, [height * 2.3, height * 3], [80, 0], Extrapolate.CLAMP) }]
    }));

    const animatedTitleStyle = useAnimatedStyle(() => ({
        transform: [{ scale: pulseAnim.value }],
        opacity: interpolate(pulseAnim.value, [1, 1.04], [0.8, 1])
    }));

    const isSmallScreen = height < 700;

    return (
        <View style={styles.container}>
            {/* BACKGROUND VIDEO */}
            <Animated.View style={[StyleSheet.absoluteFillObject, videoFadeStyle, { zIndex: -1 }]}>
                <Video
                    source={require('../assets/videos/bg_video.mp4')}
                    style={StyleSheet.absoluteFillObject}
                    resizeMode={ResizeMode.COVER}
                    shouldPlay
                    isLooping
                    isMuted
                />
                <View style={styles.darkOverlay} />
            </Animated.View>

            <Animated.ScrollView
                onScroll={scrollHandler}
                scrollEventThrottle={16}
                showsVerticalScrollIndicator={false}
                snapToInterval={height}
                decelerationRate="fast"
            >
                {/* ================= PAGE 1: HERO ================= */}
                <View style={[styles.page, { width, height }]}>
                    <View style={styles.heroContent}>
                        <View style={[styles.iconCircle, isSmallScreen && { width: 80, height: 80, marginBottom: 10 }]}>
                            <Ionicons name="shield-checkmark" size={isSmallScreen ? 40 : 55} color={NEON_GREEN} style={styles.neonGlow} />
                        </View>
                        <Animated.Text style={[styles.title, styles.textGlow, animatedTitleStyle, isSmallScreen && { fontSize: 40 }]}>
                            IntelliSight
                        </Animated.Text>
                        <Text style={[styles.subtitle, isSmallScreen && { fontSize: 14 }]}>
                            AI-Assisted Video Surveillance{"\n"}For Public Safety
                        </Text>
                    </View>
                    <Animated.View style={[styles.scrollIndicator, { transform: [{ translateY: bounceY }] }]}>
                        <Ionicons name="chevron-down" size={30} color={NEON_GREEN} style={styles.neonGlow} />
                    </Animated.View>
                </View>

                {/* ================= PAGE 2: MASSIVE CARDS ================= */}
                <View style={[styles.page, { width, height, paddingVertical: Platform.OS === 'ios' ? 50 : 30 }]}>
                    <Animated.View style={[styles.sectionContainer, modulesStyle]}>

                        <Text style={[styles.sectionLabel, isSmallScreen && { marginBottom: 5 }]}>SYSTEM MODULES</Text>
                        <View style={[styles.headerLine, isSmallScreen && { marginBottom: 15 }]} />

                        <View style={styles.grid}>
                            <View style={styles.featureBox}>
                                <View style={styles.iconWrapper}>
                                    <Ionicons name="videocam" size={32} color={NEON_GREEN} style={styles.neonGlow} />
                                </View>
                                <Text style={styles.featureTitle}>Live RTSP</Text>
                                <Text style={styles.featureDesc}>Real-time monitoring and offline video uploads directly from the dashboard.</Text>
                            </View>

                            <View style={styles.featureBox}>
                                <View style={styles.iconWrapper}>
                                    <Ionicons name="analytics" size={32} color={NEON_GREEN} style={styles.neonGlow} />
                                </View>
                                <Text style={styles.featureTitle}>Anomaly Detect</Text>
                                <Text style={styles.featureDesc}>Advanced tracking algorithm outputting direct label & confidence scoring.</Text>
                            </View>

                            <View style={styles.featureBox}>
                                <View style={styles.iconWrapper}>
                                    <Ionicons name="hardware-chip" size={32} color={NEON_GREEN} style={styles.neonGlow} />
                                </View>
                                <Text style={styles.featureTitle}>I3D + ViT Fusion</Text>
                                <Text style={styles.featureDesc}>State-of-the-art neural architecture built specifically for video analysis.</Text>
                            </View>

                            <View style={styles.featureBox}>
                                <View style={styles.iconWrapper}>
                                    <Ionicons name="lock-closed" size={32} color={NEON_GREEN} style={styles.neonGlow} />
                                </View>
                                <Text style={styles.featureTitle}>Secure Archives</Text>
                                <Text style={styles.featureDesc}>Encrypted timeline and history logs of all flagged security incidents.</Text>
                            </View>
                        </View>

                        <Animated.View style={[styles.scrollIndicator, { transform: [{ translateY: bounceY }], position: 'relative', marginTop: 20 }]}>
                            <Ionicons name="chevron-down" size={30} color={NEON_GREEN} style={styles.neonGlow} />
                        </Animated.View>

                    </Animated.View>
                </View>

                {/* ================= PAGE 3: THE TEAM with IMAGES ================= */}
                <View style={[styles.page, { width, height, paddingVertical: Platform.OS === 'ios' ? 50 : 30 }]}>
                    <Animated.View style={[styles.sectionContainer, teamStyle, { justifyContent: 'center' }]}>

                        <Text style={styles.sectionLabel}>PROJECT ARCHITECTS</Text>
                        <View style={styles.headerLine} />

                        <View style={styles.teamGrid}>

                            {/* --- Member 1 with Image --- */}
                            <View style={styles.teamCard}>
                                <Animated.View style={[styles.imageGlowContainer, { marginBottom: 15 }]}>
                                    <Image
                                        // 👈 UPDATE filename to match assets/mubeen.jpg
                                        source={require('../assets/images/mubeen.png')}
                                        style={styles.teamImage}
                                    />
                                </Animated.View>
                                <Text style={styles.teamName}>Mubeen</Text>
                                <Text style={styles.teamRole}>Lead Developer</Text>
                            </View>

                            {/* --- Member 2 with Image --- */}
                            <View style={styles.teamCard}>
                                <Animated.View style={[styles.imageGlowContainer, { marginBottom: 15 }]}>
                                    <Image
                                        // 👈 UPDATE filename to match assets/member2.jpg
                                        source={require('../assets/images/rohan.png')}
                                        style={styles.teamImage}
                                    />
                                </Animated.View>
                                <Text style={styles.teamName}>Rohan</Text>
                                <Text style={styles.teamRole}>AI Engineer</Text>
                            </View>

                        </View>

                        <Animated.View style={[styles.scrollIndicator, { transform: [{ translateY: bounceY }], position: 'relative', marginTop: 20 }]}>
                            <Ionicons name="chevron-down" size={30} color={NEON_GREEN} style={styles.neonGlow} />
                        </Animated.View>

                    </Animated.View>
                </View>

                {/* ================= PAGE 4: ABOUT & LOGIN ================= */}
                <View style={[styles.page, { width, height, paddingVertical: Platform.OS === 'ios' ? 50 : 30 }]}>
                    <Animated.View style={[styles.sectionContainer, aboutStyle, { justifyContent: 'center' }]}>

                        <Text style={styles.sectionLabel}>ABOUT THE ENGINE</Text>
                        <View style={styles.headerLine} />

                        <View style={styles.aboutCard}>
                            <Ionicons name="information-circle-outline" size={45} color={NEON_GREEN} style={[styles.neonGlow, { marginBottom: 15 }]} />

                            <Text style={styles.aboutText}>
                                Born from the critical need for proactive public safety, IntelliSight bridges the gap between raw video feeds and actionable intelligence.
                            </Text>

                            <Text style={styles.aboutText}>
                                Utilizing deep learning models, the system is designed for rapid deployment in high-stakes environments where every millisecond counts.
                            </Text>

                            <View style={styles.versionBadge}>
                                <Text style={styles.versionText}>SYSTEM BUILD: v1.0.0-beta</Text>
                            </View>
                        </View>

                        <View style={styles.buttonWrapper}>
                            <Pressable
                                style={styles.getStartedButton}
                                onPress={() => navigation.navigate('AuthChoice')}
                            >
                                <Text style={styles.getStartedText}>Get Started</Text>
                            </Pressable>
                        </View>

                    </Animated.View>
                </View>

            </Animated.ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: DARK_BG },
    darkOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: OVERLAY_COLOR },
    page: { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 },

    heroContent: { alignItems: 'center' },
    iconCircle: { width: 100, height: 100, borderRadius: 50, backgroundColor: 'rgba(16, 185, 82, 0.08)', justifyContent: 'center', alignItems: 'center', marginBottom: 20, borderWidth: 1, borderColor: 'rgba(16, 185, 82, 0.4)' },
    title: { fontSize: 52, fontWeight: '900', color: '#ffffff', letterSpacing: 2 },
    textGlow: { textShadowColor: NEON_GREEN, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 15 },
    neonGlow: { textShadowColor: NEON_GREEN, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 10 },
    subtitle: { fontSize: 16, color: MUTED_GREEN, textAlign: 'center', marginTop: 10, fontWeight: '500' },

    scrollIndicator: { position: 'absolute', bottom: 40, alignItems: 'center' },
    sectionContainer: { width: '100%', alignItems: 'center', maxWidth: 500, flex: 1, justifyContent: 'center' },

    sectionLabel: { color: NEON_GREEN, fontSize: 14, fontWeight: '800', letterSpacing: 4, textAlign: 'center', marginBottom: 10 },
    headerLine: { width: 40, height: 3, backgroundColor: NEON_GREEN, borderRadius: 2, marginBottom: 30, alignSelf: 'center', shadowColor: NEON_GREEN, shadowRadius: 5, shadowOpacity: 0.8 },

    grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', width: '100%' },

    featureBox: {
        backgroundColor: 'rgba(16, 185, 82, 0.04)', padding: '6%', borderRadius: 20,
        width: '48%', minHeight: 220, marginBottom: 15, borderWidth: 1.5,
        borderColor: 'rgba(16, 185, 82, 0.3)', justifyContent: 'flex-start',
    },
    iconWrapper: {
        width: 55, height: 55, borderRadius: 30, backgroundColor: 'rgba(16, 185, 82, 0.1)',
        justifyContent: 'center', alignItems: 'center', marginBottom: 15,
        borderWidth: 1, borderColor: 'rgba(16, 185, 82, 0.2)'
    },
    featureTitle: { color: 'white', fontSize: 18, fontWeight: '800', marginBottom: 8 },
    featureDesc: { color: MUTED_GREEN, fontSize: 13, lineHeight: 18 },

    teamGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 20, width: '100%', marginBottom: 20 },
    teamCard: {
        backgroundColor: 'rgba(16, 185, 82, 0.02)', padding: 20, borderRadius: 16,
        alignItems: 'center', width: '45%', borderWidth: 1, borderColor: 'rgba(16, 185, 82, 0.15)',
    },
    teamName: { color: 'white', fontSize: 16, fontWeight: 'bold', marginTop: 10, marginBottom: 4 },
    teamRole: { color: MUTED_GREEN, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, textAlign: 'center' },

    // ✨ NEW STYLES FOR TEAM IMAGES ✨
    imageGlowContainer: {
        width: 100, height: 100, borderRadius: 50, backgroundColor: 'rgba(16, 185, 82, 0.05)',
        justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: NEON_GREEN,
        shadowColor: NEON_GREEN, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 10, elevation: 10,
    },
    teamImage: { width: 90, height: 90, borderRadius: 45, resizeMode: 'cover' },

    aboutCard: {
        backgroundColor: 'rgba(16, 185, 82, 0.04)', padding: 30, borderRadius: 20,
        alignItems: 'center', width: '100%', borderWidth: 1.5, borderColor: 'rgba(16, 185, 82, 0.3)',
        marginBottom: 30,
    },
    aboutText: { color: MUTED_GREEN, fontSize: 14, lineHeight: 24, textAlign: 'center', marginBottom: 15 },
    versionBadge: {
        backgroundColor: 'rgba(16, 185, 82, 0.15)', paddingHorizontal: 15, paddingVertical: 8,
        borderRadius: 20, marginTop: 10, borderWidth: 1, borderColor: 'rgba(16, 185, 82, 0.4)'
    },
    versionText: { color: NEON_GREEN, fontSize: 11, fontWeight: 'bold', letterSpacing: 1 },

    buttonWrapper: { width: '100%', marginTop: 'auto', paddingBottom: 20 },
    getStartedButton: {
        backgroundColor: NEON_GREEN, width: '100%', paddingVertical: 20,
        borderRadius: 8, alignItems: 'center',
        shadowColor: NEON_GREEN, shadowRadius: 15, shadowOpacity: 0.4, elevation: 8
    },
    getStartedText: { color: '#ffffff', fontWeight: '900', fontSize: 16, letterSpacing: 1.5 }
});