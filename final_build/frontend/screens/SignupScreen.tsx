import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import {
    Alert,
    Modal,
    Platform,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { registerUser } from "../api";
import AuthLayout from "./AuthLayout";

export default function SignupScreen({ navigation }: any) {
    const [fullName, setFullName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [successModalVisible, setSuccessModalVisible] = useState(false);

    const onSignup = async () => {
        if (!fullName.trim() || !email.trim() || !password.trim() || !confirm.trim()) {
            Alert.alert("Missing info", "Please fill all fields.");
            return;
        }

        if (password !== confirm) {
            Alert.alert("Password mismatch", "Passwords do not match.");
            return;
        }

        setIsLoading(true);

        try {
            await registerUser(fullName.trim(), email.trim(), password);
            setSuccessModalVisible(true);
        } catch (error: any) {
            Alert.alert(
                "Signup Failed",
                error?.response?.data?.message ||
                error?.response?.data?.error ||
                error?.message ||
                error.toString()
            );
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <View style={styles.mainContainer}>
            <SafeAreaView style={styles.backButtonContainer}>
                <Pressable
                    style={styles.backButton}
                    onPress={() => navigation.navigate("AuthChoice")}
                >
                    <Ionicons name="chevron-back" size={24} color="#10B952" />
                    <Text style={styles.backText}>Back</Text>
                </Pressable>
            </SafeAreaView>

            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
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
                            keyboardType="email-address"
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

                        <Pressable
                            style={[styles.cta, isLoading && styles.ctaDisabled]}
                            onPress={onSignup}
                            disabled={isLoading}
                        >
                            <Text style={styles.ctaText}>
                                {isLoading ? "REGISTERING..." : "CREATE ACCOUNT"}
                            </Text>
                        </Pressable>

                        <Text style={styles.helperText}>
                            Already have an account?{" "}
                            <Text
                                style={styles.linkText}
                                onPress={() => navigation.navigate("Login")}
                            >
                                Login
                            </Text>
                        </Text>
                    </View>
                </AuthLayout>
            </ScrollView>

            <Modal
                visible={successModalVisible}
                transparent
                animationType="fade"
                statusBarTranslucent
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.successModal}>
                        <View style={styles.tickCircle}>
                            <Ionicons name="checkmark" size={60} color="#ffffff" />
                        </View>

                        <Text style={styles.successTitle}>Registration Successful</Text>

                        <Text style={styles.successSubtitle}>
                            Your IntelliSight operator account has been created successfully.
                        </Text>

                        <Text style={styles.successSubtitle}>
                            You can now login to access the dashboard.
                        </Text>

                        <Pressable
                            style={styles.successButton}
                            onPress={() => {
                                setSuccessModalVisible(false);
                                navigation.replace("Login");
                            }}
                        >
                            <Text style={styles.successButtonText}>GO TO LOGIN</Text>
                        </Pressable>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    mainContainer: {
        flex: 1,
        backgroundColor: "#050705",
    },

    scroll: {
        flex: 1,
    },

    scrollContent: {
        paddingTop: 70,
        paddingBottom: 50,
    },

    backButtonContainer: {
        position: "absolute",
        top: Platform.OS === "ios" ? 50 : 30,
        left: 20,
        zIndex: 50,
    },

    backButton: {
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: "rgba(16, 185, 82, 0.1)",
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: "rgba(16, 185, 82, 0.3)",
    },

    backText: {
        color: "#10B952",
        fontWeight: "bold",
        fontSize: 14,
        marginLeft: 4,
        letterSpacing: 1,
    },

    formGrid: {
        gap: 10,
    },

    label: {
        color: "#8A9A8D",
        fontSize: 12,
        fontWeight: "bold",
        letterSpacing: 1,
    },

    input: {
        borderWidth: 1,
        borderColor: "rgba(16, 185, 82, 0.2)",
        backgroundColor: "rgba(16, 185, 82, 0.03)",
        color: "#e9efe9",
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderRadius: 12,
        marginBottom: 8,
    },

    cta: {
        marginTop: 14,
        backgroundColor: "#10B952",
        paddingVertical: 18,
        borderRadius: 8,
        alignItems: "center",
    },

    ctaDisabled: {
        opacity: 0.7,
    },

    ctaText: {
        color: "#ffffff",
        fontWeight: "900",
        fontSize: 16,
        letterSpacing: 1,
    },

    helperText: {
        marginTop: 18,
        color: "#8A9A8D",
        fontSize: 14,
        textAlign: "center",
    },

    linkText: {
        color: "#10B952",
        fontWeight: "800",
    },

    modalOverlay: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.75)",
        justifyContent: "center",
        alignItems: "center",
    },

    successModal: {
        width: "88%",
        maxWidth: 430,
        backgroundColor: "#07110A",
        borderRadius: 22,
        borderWidth: 1,
        borderColor: "#10B952",
        paddingHorizontal: 30,
        paddingVertical: 35,
        alignItems: "center",
    },

    tickCircle: {
        width: 110,
        height: 110,
        borderRadius: 55,
        backgroundColor: "#10B952",
        justifyContent: "center",
        alignItems: "center",
        marginBottom: 25,
    },

    successTitle: {
        color: "#ffffff",
        fontSize: 28,
        fontWeight: "bold",
        marginBottom: 15,
        textAlign: "center",
    },

    successSubtitle: {
        color: "#A7B3A8",
        fontSize: 16,
        textAlign: "center",
        lineHeight: 24,
        marginBottom: 5,
    },

    successButton: {
        marginTop: 30,
        width: "100%",
        backgroundColor: "#10B952",
        paddingVertical: 17,
        borderRadius: 12,
        alignItems: "center",
    },

    successButtonText: {
        color: "#ffffff",
        fontWeight: "900",
        fontSize: 16,
        letterSpacing: 1,
    },
});