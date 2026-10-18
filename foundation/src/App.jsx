
import { useRef, useState } from "react";
import {
  FilesetResolver,
  HandLandmarker,
  DrawingUtils,
} from "@mediapipe/tasks-vision";
import "./App.css";

function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const landmarkerRef = useRef(null);
  const streamRef = useRef(null);
  const animationRef = useRef(null);
  const lastVideoTimeRef = useRef(-1);

  const [isLoading, setIsLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState("Camera is off");
  const [detectedHands, setDetectedHands] = useState(0);

  async function startCamera() {
    setIsLoading(true);
    setStatus("Starting camera...");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });

      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play();

      setStatus("Loading hand tracking model...");

      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
      );

      const landmarker = await HandLandmarker.createFromOptions(
        vision,
        {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          },
          runningMode: "VIDEO",
          numHands: 2,
        }
      );

      landmarkerRef.current = landmarker;
      setIsRunning(true);
      setStatus("Show your hand to the camera");

      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");
      const drawingUtils = new DrawingUtils(context);

      function renderLoop() {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const tracker = landmarkerRef.current;

        if (!video || !canvas || !tracker) return;

        if (
          video.readyState >= 2 &&
          video.currentTime !== lastVideoTimeRef.current
        ) {
          if (
            canvas.width !== video.videoWidth ||
            canvas.height !== video.videoHeight
          ) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
          }

          context.clearRect(0, 0, canvas.width, canvas.height);

          const results = tracker.detectForVideo(
            video,
            performance.now()
          );

          const hands = results.landmarks || [];

          setDetectedHands((previous) =>
            previous === hands.length ? previous : hands.length
          );

          for (const landmarks of hands) {
            drawingUtils.drawConnectors(
              landmarks,
              HandLandmarker.HAND_CONNECTIONS,
              {
                color: "#48E5A3",
                lineWidth: 4,
              }
            );

            drawingUtils.drawLandmarks(landmarks, {
              color: "#FFFFFF",
              fillColor: "#3978F6",
              lineWidth: 2,
              radius: 4,
            });
          }

          lastVideoTimeRef.current = video.currentTime;
        }

        animationRef.current = requestAnimationFrame(renderLoop);
      }

      renderLoop();
    } catch (error) {
      console.error(error);

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }

      if (landmarkerRef.current) {
        landmarkerRef.current.close();
        landmarkerRef.current = null;
      }

      setStatus(
        "Could not start. Check camera permission and internet connection."
      );
    } finally {
      setIsLoading(false);
    }
  }

  function stopCamera() {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (landmarkerRef.current) {
      landmarkerRef.current.close();
      landmarkerRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    if (canvasRef.current) {
      const context = canvasRef.current.getContext("2d");
      context.clearRect(
        0,
        0,
        canvasRef.current.width,
        canvasRef.current.height
      );
    }

    lastVideoTimeRef.current = -1;
    setDetectedHands(0);
    setIsRunning(false);
    setStatus("Camera is off");
  }

  return (
    <main className="app">
      <header className="header">
        <div className="brand">
          <span className="brand-icon">✋</span>
          <span>HandTrack</span>
        </div>
        <span className="version">FOUNDATION V1.0</span>
      </header>

      <section className="intro">
        <p className="eyebrow">REAL-TIME COMPUTER VISION</p>
        <h1>Your hands, <span>in motion.</span></h1>
        <p className="subtitle">
          The shared foundation for AirType and SignLearn.
          Track your hand landmarks live using your webcam.
        </p>
      </section>

      <section className="workspace">
        <div className="camera-panel">
          <div className="panel-heading">
            <span>Live camera</span>
            <span className={isRunning ? "live-dot active" : "live-dot"}>
              {isRunning ? "LIVE" : "OFFLINE"}
            </span>
          </div>

          <div className="camera-view">
            <video
              ref={videoRef}
              className="camera-video"
              playsInline
              muted
            />
            <canvas
              ref={canvasRef}
              className="landmark-canvas"
            />

            {!isRunning && (
              <div className="camera-placeholder">
                <span className="camera-symbol">◎</span>
                <p>Your camera preview will appear here</p>
              </div>
            )}
          </div>

          <div className="camera-controls">
            <button
              className="start-button"
              onClick={startCamera}
              disabled={isRunning || isLoading}
            >
              {isLoading ? "Starting..." : "Start tracking"}
            </button>

            <button
              className="stop-button"
              onClick={stopCamera}
              disabled={!isRunning && !isLoading}
            >
              Stop
            </button>
          </div>
        </div>

        <aside className="info-panel">
          <div className="info-card">
            <p className="card-label">SYSTEM STATUS</p>
            <p className="status-text">{status}</p>
          </div>

          <div className="info-card">
            <p className="card-label">HANDS DETECTED</p>
            <p className="metric">{detectedHands}<span> / 2</span></p>
          </div>

          <div className="info-card">
            <p className="card-label">LANDMARKS PER HAND</p>
            <p className="metric">21</p>
            <p className="small-note">
              Fingertips, joints and wrist
            </p>
          </div>

          <div className="info-card next-card">
            <p className="card-label">COMING NEXT</p>
            <p>⌨️ AirType</p>
            <p>🤟 SignLearn</p>
            <p className="small-note">
              One tracking foundation, two applications.
            </p>
          </div>
        </aside>
      </section>

      <footer>
        Camera processing runs in your browser. Camera access is only
        requested when you start tracking.
      </footer>
    </main>
  );
}

export default App;
