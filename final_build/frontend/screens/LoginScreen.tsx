// import { Ionicons } from '@expo/vector-icons'; // ✨ Imported icons for the back button
// import React, { useState } from "react";
// import { Alert, Platform, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
// import AuthLayout from "./AuthLayout";

// export default function LoginScreen({ navigation }: any) {
//     const [email, setEmail] = useState("");
//     const [password, setPassword] = useState("");
//     const [isLoading, setIsLoading] = useState(false);

//     const onLogin = async () => {
//         if (!email.trim() || !password.trim()) {
//             Alert.alert("Missing info", "Please enter email and password.");
//             return;
//         }

//         setIsLoading(true);
//         try {
//             await loginUser(email, password);
//             navigation.replace("MainTabs");
//         } catch (error: any) {
//             Alert.alert("Login Failed", error.toString());
//         } finally {
//             setIsLoading(false);
//         }
//     };

//     return (
//         <View style={{ flex: 1, backgroundColor: '#050705' }}>

//             {/* ✨ THE NEW FLOATING BACK BUTTON ✨ */}
//             <SafeAreaView style={styles.backButtonContainer}>
//                 <Pressable
//                     style={styles.backButton}
//                     onPress={() => navigation.navigate('AuthChoice')}
//                 >
//                     <Ionicons name="chevron-back" size={24} color="#10B952" />
//                     <Text style={styles.backText}>Welcome</Text>
//                 </Pressable>
//             </SafeAreaView>

//             <AuthLayout
//                 title="Login to IntelliSight"
//                 subtitle="Enter your credentials to access surveillance and anomaly detection features."
//             >
//                 <View style={styles.formGrid}>
//                     <Text style={styles.label}>Email</Text>
//                     <TextInput
//                         style={styles.input}
//                         placeholder="operator@intellisight.com"
//                         placeholderTextColor="rgba(233,239,233,0.35)"
//                         value={email}
//                         onChangeText={setEmail}
//                         autoCapitalize="none"
//                     />

//                     <Text style={styles.label}>Password</Text>
//                     <TextInput
//                         style={styles.input}
//                         placeholder="Enter your password"
//                         placeholderTextColor="rgba(233,239,233,0.35)"
//                         value={password}
//                         onChangeText={setPassword}
//                         secureTextEntry
//                     />

//                     <Pressable style={styles.cta} onPress={onLogin} disabled={isLoading}>
//                         <Text style={styles.ctaText}>{isLoading ? "Authenticating..." : "LOGIN"}</Text>
//                     </Pressable>

//                     <Text style={styles.helper}>
//                         New here?{" "}
//                         <Text style={styles.link} onPress={() => navigation.navigate("Signup")}>
//                             Create an account
//                         </Text>
//                     </Text>
//                 </View>
//             </AuthLayout>
//         </View>
//     );
// }

// const styles = StyleSheet.create({
//     // ✨ Back Button Styles
//     backButtonContainer: {
//         position: 'absolute',
//         top: Platform.OS === 'ios' ? 50 : 30, // Adjusts for the phone notch
//         left: 20,
//         zIndex: 50, // Ensures it stays on top of the AuthLayout
//     },
//     backButton: {
//         flexDirection: 'row',
//         alignItems: 'center',
//         backgroundColor: 'rgba(16, 185, 82, 0.1)',
//         paddingVertical: 8,
//         paddingHorizontal: 12,
//         borderRadius: 20,
//         borderWidth: 1,
//         borderColor: 'rgba(16, 185, 82, 0.3)',
//     },
//     backText: { color: '#10B952', fontWeight: 'bold', fontSize: 14, marginLeft: 4, letterSpacing: 1 },

//     // Existing Form Styles
//     formGrid: { gap: 10 },
//     label: { color: "#8A9A8D", fontSize: 12, fontWeight: 'bold', letterSpacing: 1 },
//     input: {
//         borderWidth: 1,
//         borderColor: "rgba(16, 185, 82, 0.2)",
//         backgroundColor: "rgba(16, 185, 82, 0.03)",
//         color: "#e9efe9",
//         paddingHorizontal: 16,
//         paddingVertical: 16,
//         borderRadius: 12,
//         marginBottom: 10,
//     },
//     cta: {
//         marginTop: 15,
//         backgroundColor: "#10B952",
//         paddingVertical: 18,
//         borderRadius: 8,
//         alignItems: "center",
//         shadowColor: "#10B952", shadowRadius: 10, shadowOpacity: 0.3, elevation: 5
//     },
//     ctaText: { color: "#ffffff", fontWeight: "900", fontSize: 16, letterSpacing: 1 },
//     helper: { marginTop: 15, color: "#8A9A8D", fontSize: 13, textAlign: 'center' },
//     link: { color: "#10B952", fontWeight: "800" },
// });



import { Ionicons } from '@expo/vector-icons';
import React, { useState } from "react";
import {
    Alert,
    Platform,
    Pressable,
    SafeAreaView,
    StyleSheet,
    Text,
    TextInput,
    View
} from "react-native";
import { loginUser } from "../api";
import AuthLayout from "./AuthLayout";

export default function LoginScreen({ navigation }: any) {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    const onLogin = async () => {
        if (!email.trim() || !password.trim()) {
            Alert.alert("Missing info", "Please enter email and password.");
            return;
        }

        setIsLoading(true);

        try {
            await loginUser(email, password);
            navigation.replace("MainTabs");
        } catch (error: any) {
            Alert.alert("Login Failed", error.toString());
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <View style={{ flex: 1, backgroundColor: '#050705' }}>
            <SafeAreaView style={styles.backButtonContainer}>
                <Pressable
                    style={styles.backButton}
                    onPress={() => navigation.navigate('AuthChoice')}
                >
                    <Ionicons name="chevron-back" size={24} color="#10B952" />
                    <Text style={styles.backText}>Welcome</Text>
                </Pressable>
            </SafeAreaView>

            <AuthLayout
                title="Login to IntelliSight"
                subtitle="Enter your credentials to access surveillance and anomaly detection features."
            >
                <View style={styles.formGrid}>
                    <Text style={styles.label}>Email</Text>
                    <TextInput
                        style={styles.input}
                        placeholder="operator@intellisight.com"
                        placeholderTextColor="rgba(233,239,233,0.35)"
                        value={email}
                        onChangeText={setEmail}
                        autoCapitalize="none"
                    />

                    <Text style={styles.label}>Password</Text>
                    <TextInput
                        style={styles.input}
                        placeholder="Enter your password"
                        placeholderTextColor="rgba(233,239,233,0.35)"
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry
                    />

                    <Pressable style={styles.cta} onPress={onLogin} disabled={isLoading}>
                        <Text style={styles.ctaText}>
                            {isLoading ? "Authenticating..." : "LOGIN"}
                        </Text>
                    </Pressable>

                    <Text style={styles.helper}>
                        New here?{" "}
                        <Text style={styles.link} onPress={() => navigation.navigate("Signup")}>
                            Create an account
                        </Text>
                    </Text>
                </View>
            </AuthLayout>
        </View>
    );
}

const styles = StyleSheet.create({
    backButtonContainer: {
        position: 'absolute',
        top: Platform.OS === 'ios' ? 50 : 30,
        left: 20,
        zIndex: 50,
    },
    backButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(16, 185, 82, 0.1)',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: 'rgba(16, 185, 82, 0.3)',
    },
    backText: {
        color: '#10B952',
        fontWeight: 'bold',
        fontSize: 14,
        marginLeft: 4,
        letterSpacing: 1
    },
    formGrid: { gap: 10 },
    label: {
        color: "#8A9A8D",
        fontSize: 12,
        fontWeight: 'bold',
        letterSpacing: 1
    },
    input: {
        borderWidth: 1,
        borderColor: "rgba(16, 185, 82, 0.2)",
        backgroundColor: "rgba(16, 185, 82, 0.03)",
        color: "#e9efe9",
        paddingHorizontal: 16,
        paddingVertical: 16,
        borderRadius: 12,
        marginBottom: 10,
    },
    cta: {
        marginTop: 15,
        backgroundColor: "#10B952",
        paddingVertical: 18,
        borderRadius: 8,
        alignItems: "center",
        shadowColor: "#10B952",
        shadowRadius: 10,
        shadowOpacity: 0.3,
        elevation: 5
    },
    ctaText: {
        color: "#ffffff",
        fontWeight: "900",
        fontSize: 16,
        letterSpacing: 1
    },
    helper: {
        marginTop: 15,
        color: "#8A9A8D",
        fontSize: 13,
        textAlign: 'center'
    },
    link: {
        color: "#10B952",
        fontWeight: "800"
    },
});