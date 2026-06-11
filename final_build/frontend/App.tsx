import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';

// --- IMPORT ALL YOUR SCREENS ---
import AuthChoiceScreen from './screens/AuthChoiceScreen';
import DetectionDetailsScreen from './screens/DetectionDetailsScreen';
import LoginScreen from './screens/LoginScreen';
import MainTabNavigator from './screens/MainTabNavigator';
import SignupScreen from './screens/SignupScreen';
import WelcomeScreen from './screens/WelcomeScreen';

const Stack = createNativeStackNavigator();

export default function App() {
    return (
        <NavigationContainer>
            <Stack.Navigator
                initialRouteName="Welcome"
                screenOptions={{ headerShown: false }}
            >
                <Stack.Screen name="Welcome" component={WelcomeScreen} />
                <Stack.Screen name="AuthChoice" component={AuthChoiceScreen} />
                <Stack.Screen name="Login" component={LoginScreen} />
                <Stack.Screen name="Signup" component={SignupScreen} />

                <Stack.Screen name="MainTabs" component={MainTabNavigator} />

                <Stack.Screen
                    name="DetectionDetails"
                    component={DetectionDetailsScreen}
                />
            </Stack.Navigator>
        </NavigationContainer>
    );
}