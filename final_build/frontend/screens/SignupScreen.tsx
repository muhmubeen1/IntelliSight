import { Ionicons } from '@expo/vector-icons';
import React, { useState } from "react";
import { Alert, Platform, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import { registerUser } from "../api";
import AuthLayout from "./AuthLayout";

export default function SignupScreen({ navigation }: any) {
    const [fullName, setFullName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    const onSignup = async () => {
        if (!fullName.trim() || !email.trim() || !password.trim()) {
            Alert.alert("Missing info", "Please fill all fields.");
            return;
        }
        if (password !== confirm) {
            Alert.alert("Password mismatch", "Passwords do not match.");
            return;
        }

        setIsLoading(true);
        try {
            await registerUser(fullName, email, password);
            Alert.alert("Success", "Account created! Please log in.");
            navigation.replace("Login");
        } catch (error: any) {
            Alert.alert("Signup Failed", error.toString());
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <View style={styles.mainContainer}>

            {/* THE FLOATING BACK BUTTON */}
            <SafeAreaView style={styles.backButtonContainer}>
                <Pressable
                    style={styles.backButton}
                    onPress={() => navigation.navigate('AuthChoice')}
                >
                    <Ionicons name="chevron-back" size={24} color="#10B952" />
                    <Text style={styles.backText}>Back</Text>
                </Pressable>
            </SafeAreaView>

            <View style={styles.formWrapper}>
                <AuthLayout
                    title="Create Operator Profile"
                    subtitle="Register to access live surveillance, offline analysis, alerts, and history logs."
                >
                    <View style={styles.formGrid}>
                        <Text style={styles.label}>Full Name</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="John Doe"
                            placeholderTextColor="rgba(233,239,233,0.35)"
                            value={fullName}
                            onChangeText={setFullName}
                        />

                        <Text style={styles.label}>Email Address</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="operator@intellisight.com"
                            placeholderTextColor="rgba(233,239,233,0.35)"
                            value={email}
                            onChangeText={setEmail}
                            autoCapitalize="none"
                        />

                        <Text style={styles.label}>Secure Password</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="Create password"
                            placeholderTextColor="rgba(233,239,233,0.35)"
                            value={password}
                            onChangeText={setPassword}
                            secureTextEntry
                        />

                        <Text style={styles.label}>Confirm Password</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="Re-enter password"
                            placeholderTextColor="rgba(233,239,233,0.35)"
                            value={confirm}
                            onChangeText={setConfirm}
                            secureTextEntry
                        />

                        <Pressable style={styles.cta} onPress={onSignup} disabled={isLoading}>
                            <Text style={styles.ctaText}>{isLoading ? "Registering..." : "CREATE ACCOUNT"}</Text>
                        </Pressable>
                    </View>
                </AuthLayout>
            </View>

            {/* ✨ THE GUARANTEED FIX: Absolute positioned text at the bottom of the screen ✨ */}
            <View style={styles.absoluteBottomContainer}>
                <SafeAreaView>
                    <Text style={styles.helperText}>
                        Already have an account?{" "}
                        <Text style={styles.linkText} onPress={() => navigation.navigate("Login")}>
                            Login
                        </Text>
                    </Text>
                </SafeAreaView>
            </View>

        </View>
    );
}

const styles = StyleSheet.create({
    mainContainer: { flex: 1, backgroundColor: '#050705' },
    formWrapper: { flex: 1, justifyContent: 'center', paddingBottom: 60 }, // Leaves room for the bottom text

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
    backText: { color: '#10B952', fontWeight: 'bold', fontSize: 14, marginLeft: 4, letterSpacing: 1 },

    formGrid: { gap: 10 },
    label: { color: "#8A9A8D", fontSize: 12, fontWeight: 'bold', letterSpacing: 1 },
    input: {
        borderWidth: 1, borderColor: "rgba(16, 185, 82, 0.2)", backgroundColor: "rgba(16, 185, 82, 0.03)",
        color: "#e9efe9", paddingHorizontal: 16, paddingVertical: 14, borderRadius: 12, marginBottom: 8,
    },
    cta: {
        marginTop: 10, backgroundColor: "#10B952", paddingVertical: 18, borderRadius: 8,
        alignItems: "center", shadowColor: "#10B952", shadowRadius: 10, shadowOpacity: 0.3, elevation: 5
    },
    ctaText: { color: "#ffffff", fontWeight: "900", fontSize: 16, letterSpacing: 1 },

    // ✨ Absolute Positioning Styles
    absoluteBottomContainer: {
        position: 'absolute',
        bottom: Platform.OS === 'ios' ? 40 : 20,
        width: '100%',
        alignItems: 'center',
        zIndex: 100 // Forces it to the very front layer
    },
    helperText: { color: "#8A9A8D", fontSize: 14, textAlign: 'center' },
    linkText: { color: "#10B952", fontWeight: "800" },
});