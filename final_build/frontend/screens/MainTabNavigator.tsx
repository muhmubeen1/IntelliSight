import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import React from 'react';
import { Platform, StyleSheet } from 'react-native';

// --- IMPORT YOUR 5 REAL SCREENS ---
import AlertsScreen from './AlertsScreen';
import ArchivesScreen from './ArchivesScreen';
import CCTVScreen from './CCTVScreen';
import DashboardScreen from './DashboardScreen';
import ProfileScreen from './ProfileScreen';

const Tab = createBottomTabNavigator();

// --- THE NEON GREEN PALETTE ---
const NEON_GREEN = '#10B952';
const DARK_BG = '#050705';
const MUTED_GREEN = '#8A9A8D';
const ALERT_RED = '#ff3333'; // Used for Alerts tab if needed

export default function MainTabNavigator() {
    return (
        <Tab.Navigator
            screenOptions={({ route }) => ({
                headerShown: false,
                tabBarStyle: {
                    backgroundColor: DARK_BG,
                    borderTopWidth: 1,
                    borderTopColor: 'rgba(16, 185, 82, 0.2)',
                    height: Platform.OS === 'ios' ? 85 : 70,
                    paddingBottom: Platform.OS === 'ios' ? 25 : 10,
                    paddingTop: 10,
                },
                tabBarActiveTintColor: NEON_GREEN,
                tabBarInactiveTintColor: MUTED_GREEN,
                tabBarIcon: ({ focused, color }) => {
                    let iconName: keyof typeof Ionicons.glyphMap = 'help';

                    if (route.name === 'Manual') {
                        iconName = focused ? 'hardware-chip' : 'hardware-chip-outline';
                    } else if (route.name === 'Live') {
                        iconName = focused ? 'videocam' : 'videocam-outline';
                    } else if (route.name === 'Alerts') {
                        iconName = focused ? 'warning' : 'warning-outline';
                        // Optional: If you want the Alerts tab icon to glow red when focused
                        if (focused) return <Ionicons name={iconName} size={26} color={ALERT_RED} style={{ textShadowColor: ALERT_RED, textShadowRadius: 10 }} />;
                    } else if (route.name === 'Archives') {
                        iconName = focused ? 'server' : 'server-outline';
                    } else if (route.name === 'Profile') {
                        iconName = focused ? 'person' : 'person-outline';
                    }

                    return <Ionicons name={iconName} size={26} color={color} style={focused ? styles.neonGlow : null} />;
                },
            })}
        >
            <Tab.Screen name="Manual" component={DashboardScreen} />
            <Tab.Screen name="Live" component={CCTVScreen} />
            <Tab.Screen name="Alerts" component={AlertsScreen} />
            <Tab.Screen name="Archives" component={ArchivesScreen} />
            <Tab.Screen name="Profile" component={ProfileScreen} />
        </Tab.Navigator>
    );
}

const styles = StyleSheet.create({
    neonGlow: {
        textShadowColor: NEON_GREEN,
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 10
    }
});