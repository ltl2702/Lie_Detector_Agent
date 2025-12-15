import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:5000';

const api = axios.create({
  baseURL: API_URL,
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Attach methods to api object
api.healthCheck = () => api.get('/api/health');
api.startSession = (sessionData) => api.post('/api/session/start', sessionData);
api.getMetrics = (sessionId) => api.get(`/api/session/${sessionId}/metrics`);
api.getBaseline = (sessionId) => api.get(`/api/session/${sessionId}/baseline`);
api.calibrateSession = (sessionId) => api.post(`/api/session/${sessionId}/calibrate`);
api.getCameraFrame = (sessionId) => api.get(`/api/session/${sessionId}/camera/frame`);
api.endSession = (sessionId, sessionData) => api.post(`/api/session/${sessionId}/end`, sessionData);
api.getHistory = () => api.get('/api/sessions');
api.controlCamera = (action) => api.post('/api/camera/control', { action });
api.getSessionData = (sessionId) => api.get(`/api/session/${sessionId}/data`);
api.connectWebSocket = (sessionId) => {
  return new WebSocket(`${WS_URL}/ws/${sessionId}`);
};

export default api;
