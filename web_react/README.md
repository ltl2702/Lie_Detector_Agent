# Lie Detector Web - React Frontend + Flask Backend

## Setup

### Frontend Setup (React)

1. Install dependencies:
```bash
cd web_react
npm install
```

2. Create `.env` file:
```
REACT_APP_API_URL=http://localhost:5000
```

3. Start development server:
```bash
npm start
```

Frontend will be available at `http://localhost:3000`

### Backend Setup (Flask)

1. Install Python dependencies:
```bash
pip install flask flask-cors flask-socketio python-socketio python-engineio
```

2. Run the Flask server:
```bash
python web_react/backend.py
```

Backend API will be available at `http://localhost:5000`

## Running Both Servers

### Option 1: Separate Terminals

Terminal 1 (Frontend):
```bash
cd web_react
npm start
```

Terminal 2 (Backend):
```bash
python web_react/backend.py
```

### Option 2: Using concurrently (Node.js)

From `web_react` directory:
```bash
npm install -D concurrently
npm start  # This will run both servers
```

(Update package.json scripts section with concurrently command)

## API Endpoints

### Sessions
- `POST /api/session/start` - Start new detection session
- `POST /api/session/<session_id>/end` - End session
- `GET /api/session/<session_id>/baseline` - Get baseline metrics
- `GET /api/session/<session_id>/metrics` - Get current metrics
- `GET /api/session/<session_id>/data` - Get all session data
- `GET /api/sessions` - List all active sessions

### Camera Control
- `POST /api/camera/start` - Start camera for session
- `POST /api/camera/stop` - Stop camera for session

### WebSocket Events
- `connect` - Connection established
- `disconnect` - Connection closed
- `join_session` - Join session room
- `leave_session` - Leave session room
- `metrics_update` - Real-time metrics update

## Architecture

```
web_react/
├── src/
│   ├── App.jsx                 # Main app component
│   ├── LieDetectorApp.jsx      # Main UI component
│   ├── index.css               # Global styles
│   ├── main.jsx                # React entry point
│   └── services/
│       └── api.js              # API client
├── public/
│   └── index.html              # HTML template
├── backend.py                  # Flask API server
├── package.json                # Node dependencies
├── tailwind.config.js          # Tailwind CSS config
├── postcss.config.js           # PostCSS config
├── vite.config.js              # Vite config
└── .env                        # Environment variables
```

## Features

### Calibration Phase
- 60-second baseline establishment
- BPM, blink rate, gaze stability measurement
- Emotion detection (FER with MTCNN)
- Hand-face contact frequency tracking

### Detection Phase
- Real-time BPM monitoring
- Blink pattern analysis
- Facial emotion recognition
- Eye gaze tracking
- Lip compression detection
- Hand-to-face gesture analysis
- Adaptive stress level assessment

### WebSocket Real-time Updates
- Live metrics streaming
- Tell detection alerts
- Emotion updates
- Gesture analysis

## Integration with Python Backend

The backend integrates directly with:
- `deception_detection.py` - Core detection algorithms
- `memory_system.py` - Learning and adaptation
- MediaPipe - Face and hand tracking
- FER (Facial Emotion Recognition) - Emotion detection

## Notes

- Ensure camera is connected and working
- May require camera permissions in browser
- WebSocket connection required for real-time updates
- Python dependencies from original project still required
