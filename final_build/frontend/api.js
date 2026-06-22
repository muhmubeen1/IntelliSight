import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const API_URL = 'http://192.168.100.12:5000';
const LIVE_SERVER_URL = 'http://192.168.100.12:4000';

const api = axios.create({
    baseURL: `${API_URL}/api`,
});

// ==========================
// TOKEN HELPERS
// ==========================

export const saveToken = async (token) => {
    try {
        if (Platform.OS === 'web') {
            localStorage.setItem('jwt_token', token);
        } else {
            await SecureStore.setItemAsync('jwt_token', token);
        }
    } catch (error) {
        console.log('Save token error:', error);
    }
};

export const getToken = async () => {
    try {
        if (Platform.OS === 'web') {
            return localStorage.getItem('jwt_token');
        } else {
            return await SecureStore.getItemAsync('jwt_token');
        }
    } catch (error) {
        console.log('Get token error:', error);
        return null;
    }
};

export const removeToken = async () => {
    try {
        if (Platform.OS === 'web') {
            localStorage.removeItem('jwt_token');
        } else {
            await SecureStore.deleteItemAsync('jwt_token');
        }
    } catch (error) {
        console.log('Remove token error:', error);
    }
};

// ==========================
// AUTH APIs
// ==========================

export const loginUser = async (email, password) => {
    try {
        const response = await api.post('/auth/login', {
            email,
            password,
        });

        if (response.data.access_token) {
            await saveToken(response.data.access_token);
            console.log('JWT Saved Successfully');
        }

        return response.data;
    } catch (error) {
        throw error.response?.data?.msg || 'Login failed';
    }
};

export const registerUser = async (fullName, email, password) => {
    try {
        const response = await api.post('/auth/register', {
            full_name: fullName,
            email,
            password,
        });

        return response.data;
    } catch (error) {
        throw error.response?.data?.msg || 'Registration failed';
    }
};

export const logoutUser = async () => {
    await removeToken();
};

// ==========================
// SERVER APIs
// ==========================

export const healthCheck = async () => {
    try {
        const response = await axios.get(`${API_URL}/health`);
        return response.data;
    } catch (error) {
        throw error.response?.data || 'Server unavailable';
    }
};

export const getLiveClassification = async () => {
    try {
        const response = await axios.get(`${API_URL}/live-classification`);
        return response.data;
    } catch (error) {
        throw error.response?.data || 'Failed to fetch live classification';
    }
};

// ==========================
// LIVE CCTV STREAM APIs
// Node.js Live Server APIs
// ==========================

export const connectLiveCamera = async (rtspUrl) => {
    try {
        const response = await axios.post(`${LIVE_SERVER_URL}/connect`, {
            mode: 'rtsp',
            rtspUrl,
        });

        return response.data;
    } catch (error) {
        throw (
            error.response?.data?.message ||
            error.response?.data?.error ||
            'Failed to connect live camera'
        );
    }
};

export const disconnectLiveCamera = async () => {
    try {
        const response = await axios.post(`${LIVE_SERVER_URL}/disconnect`);
        return response.data;
    } catch (error) {
        throw (
            error.response?.data?.message ||
            error.response?.data?.error ||
            'Failed to disconnect live camera'
        );
    }
};

export const getLiveStreamStatus = async () => {
    try {
        const response = await axios.get(`${LIVE_SERVER_URL}/status`);
        return response.data;
    } catch (error) {
        throw (
            error.response?.data?.message ||
            error.response?.data?.error ||
            'Failed to fetch live stream status'
        );
    }
};

export const getLiveStreamUrl = () => {
    return `${LIVE_SERVER_URL}/videos/ipcam/index.m3u8`;
};

export default api;