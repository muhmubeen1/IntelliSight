import React from "react";
import { ImageBackground, StyleSheet, Text, View } from "react-native";

type Props = {
    title: string;
    subtitle: string;
    children: React.ReactNode;
};

export default function AuthLayout({ title, subtitle, children }: Props) {
    return (
        <View style={styles.wrap}>
            <View style={styles.topbar} />

            <View style={styles.card}>
                {/* Left hero/banner like your dashboard */}
                <ImageBackground
                    source={{
                        uri: "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?auto=format&fit=crop&w=1600&q=70",
                    }}
                    resizeMode="cover"
                    style={styles.hero}
                    imageStyle={styles.heroImg}
                >
                    <View style={styles.heroOverlay} />
                    <View style={styles.heroContent}>
                        <View style={styles.brandRow}>
                            <View style={styles.badge} />
                            <Text style={styles.brand}>IntelliSight</Text>
                        </View>

                        <Text style={styles.heroTitle}>
                            AI-Assisted Video Surveillance for Public Safety
                        </Text>

                        <Text style={styles.heroSub}>
                            Live RTSP monitoring + offline video uploads. I3D + ViT fusion for anomaly
                            detection with label & confidence.
                        </Text>

                        <View style={styles.greenBar} />
                    </View>
                </ImageBackground>

                {/* Right form panel */}
                <View style={styles.form}>
                    <Text style={styles.formTitle}>{title}</Text>
                    <Text style={styles.formSubtitle}>{subtitle}</Text>
                    {children}
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        flex: 1,
        backgroundColor: "#0b0f0c",
        paddingTop: 44,
        paddingHorizontal: 16,
        justifyContent: "center",
    },
    topbar: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 42,
        backgroundColor: "#0f6b1f",
    },
    card: {
        width: "100%",
        borderRadius: 16,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        backgroundColor: "rgba(14,18,15,0.9)",
    },
    hero: {
        height: 240,
        justifyContent: "flex-end",
    },
    heroImg: {
        opacity: 0.95,
    },
    heroOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(0,0,0,0.45)",
    },
    heroContent: {
        padding: 18,
    },
    brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    badge: {
        width: 30,
        height: 30,
        borderRadius: 10,
        backgroundColor: "#0f6b1f",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.12)",
    },
    brand: { color: "#e9efe9", fontWeight: "800", fontSize: 16 },
    heroTitle: { color: "#e9efe9", fontWeight: "900", fontSize: 18, marginTop: 10 },
    heroSub: { color: "#a7b3a7", marginTop: 8, lineHeight: 18, fontSize: 12 },
    greenBar: {
        marginTop: 14,
        height: 10,
        borderRadius: 999,
        backgroundColor: "#0f6b1f",
    },
    form: {
        padding: 18,
        backgroundColor: "rgba(0,0,0,0.35)",
    },
    formTitle: { color: "#e9efe9", fontSize: 20, fontWeight: "900" },
    formSubtitle: { color: "#a7b3a7", fontSize: 12, marginTop: 6, lineHeight: 18 },
});
