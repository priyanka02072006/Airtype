import { useEffect, useRef, useState } from "react";
import {
  FilesetResolver,
  HandLandmarker,
  DrawingUtils,
} from "@mediapipe/tasks-vision";
import "./App.css";

const rows = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Z", "X", "C", "V", "B", "N", "M"],
  ["SPACE", "BACKSPACE", "CLEAR"],
];

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// Only the middle part of the camera frame is used to cover the whole
// keyboard, so edge keys (Q, P, A, L, Z, M...) are easy to reach.
// Increase a margin if edges are still hard to reach; decrease if too twitchy.
const MARGIN_X = 0.2;
const MARGIN_Y = 0.15;

// Cursor smoothing: 1 = no smoothing, lower = smoother but laggier.
const SMOOTHING = 0.4;

export default function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const keyboardRef = useRef(null);
  const modelRef = useRef(null);
  const frameRef = useRef(0);
  const lastVideoTime = useRef(-1);
  const selectedKey = useRef("");
  const previousKey = useRef("");
  const fistWasClosed = useRef(false);
  const lastConfirmed = useRef(0);
  const smoothed = useRef(null);

  const [text, setText] = useState("");
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [hovered, setHovered] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [message, setMessage] = useState("Starting camera...");

  function typeKey(key) {
    if (key === "SPACE") setText((t) => t + " ");
    else if (key === "BACKSPACE") setText((t) => t.slice(0, -1));
    else if (key === "CLEAR") setText("");
    else if (key) setText((t) => t + key);
  }

  useEffect(() => {
    let active = true;
    let stream = null;
    let drawingUtils = null;

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera access is unavailable.");
        }

        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
        );

        const model = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numHands: 1,
        });

        if (!active) {
          model.close();
          return;
        }

        modelRef.current = model;

        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          model.close();
          return;
        }

        const video = videoRef.current;
        if (!video) throw new Error("Video element is unavailable.");

        video.srcObject = stream;
        await video.play();

        if (!active) return;

        const canvas = canvasRef.current;
        if (canvas) {
          drawingUtils = new DrawingUtils(canvas.getContext("2d"));
        }

        setCameraReady(true);
        setMessage("Point at a key to select it.");
        processFrame();
      } catch (error) {
        console.error("AirType initialization failed:", error);
        if (active) {
          setCameraReady(false);
          setMessage("Camera unavailable. Allow camera access and refresh.");
        }
      }
    }

    function clearSkeleton() {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    function processFrame() {
      if (!active) return;

      const video = videoRef.current;
      const model = modelRef.current;
      const keyboard = keyboardRef.current;
      const canvas = canvasRef.current;

      if (
        video &&
        model &&
        keyboard &&
        canvas &&
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        video.currentTime !== lastVideoTime.current
      ) {
        lastVideoTime.current = video.currentTime;

        // Keep the skeleton canvas at the video's native resolution.
        if (
          canvas.width !== video.videoWidth ||
          canvas.height !== video.videoHeight
        ) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          drawingUtils = new DrawingUtils(canvas.getContext("2d"));
        }

        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const result = model.detectForVideo(video, performance.now());
        const hand = result.landmarks?.[0];

        if (hand) {
          // Draw the hand skeleton. The canvas is mirrored with CSS
          // (see the style prop on the <canvas>) so it matches the video.
          drawingUtils.drawConnectors(hand, HandLandmarker.HAND_CONNECTIONS, {
            color: "#38f9d7",
            lineWidth: 4,
          });

          drawingUtils.drawLandmarks(hand, {
            color: "#ffffff",
            fillColor: "#12b8a6",
            lineWidth: 2,
            radius: 5,
          });

          // Highlight the index fingertip.
          const tip = hand[8];
          ctx.beginPath();
          ctx.arc(
            tip.x * canvas.width,
            tip.y * canvas.height,
            10,
            0,
            Math.PI * 2
          );
          ctx.fillStyle = "#ffcc66";
          ctx.fill();

          const rect = keyboard.getBoundingClientRect();

          // Mirror X to match the mirrored preview, then stretch the
          // central part of the frame across the whole keyboard.
          const mirroredX = 1 - tip.x;
          const nx = clamp(
            (mirroredX - MARGIN_X) / (1 - 2 * MARGIN_X),
            0,
            1
          );
          const ny = clamp(
            (tip.y - MARGIN_Y) / (1 - 2 * MARGIN_Y),
            0,
            1
          );

          const targetX = nx * (rect.width - 1);
          const targetY = ny * (rect.height - 1);

          // Smooth the cursor to reduce jitter.
          if (!smoothed.current) {
            smoothed.current = { x: targetX, y: targetY };
          } else {
            smoothed.current = {
              x: smoothed.current.x + (targetX - smoothed.current.x) * SMOOTHING,
              y: smoothed.current.y + (targetY - smoothed.current.y) * SMOOTHING,
            };
          }

          const x = smoothed.current.x;
          const y = smoothed.current.y;

          setCursor({ x, y });

          const screenX = rect.left + x;
          const screenY = rect.top + y;

          // Test actual key rectangles, including the outermost keys.
          // Small padding makes edge keys easier to hit.
          const PAD = 6;
          const keyElements = keyboard.querySelectorAll("[data-key]");
          let key = "";

          for (const element of keyElements) {
            const keyRect = element.getBoundingClientRect();

            if (
              screenX >= keyRect.left - PAD &&
              screenX <= keyRect.right + PAD &&
              screenY >= keyRect.top - PAD &&
              screenY <= keyRect.bottom + PAD
            ) {
              key = element.dataset.key || "";
              break;
            }
          }

          const distance = (a, b) =>
            Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

          const scale = distance(hand[0], hand[9]);
          const tips = [8, 12, 16, 20];
          const bases = [5, 9, 13, 17];

          const fistClosed =
            scale > 0 &&
            tips.every(
              (id, i) => distance(hand[id], hand[bases[i]]) < scale * 0.65
            );

          // Pointing selects a key; it does not type.
          if (!fistClosed) {
            if (key !== previousKey.current) {
              previousKey.current = key;
              selectedKey.current = key;
              setHovered(key);
            }

            setMessage(
              key
                ? `Selected ${key} — close your hand to type`
                : "Move your index finger over a key."
            );
          }

          // Type once for each new fist-closing gesture.
          if (fistClosed && !fistWasClosed.current) {
            const now = performance.now();

            if (selectedKey.current && now - lastConfirmed.current >= 600) {
              typeKey(selectedKey.current);
              lastConfirmed.current = now;
              setMessage(`Typed ${selectedKey.current}`);
            }
          }

          fistWasClosed.current = fistClosed;
        } else {
          clearSkeleton();
          selectedKey.current = "";
          previousKey.current = "";
          fistWasClosed.current = false;
          smoothed.current = null;
          setHovered("");
          setCursor({ x: 0, y: 0 });
          setMessage("Show one hand to the camera.");
        }
      }

      frameRef.current = requestAnimationFrame(processFrame);
    }

    start();

    return () => {
      active = false;
      cancelAnimationFrame(frameRef.current);

      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }

      modelRef.current?.close();
      modelRef.current = null;
    };
  }, []);

  return (
    <main className="app">
      <header className="app-header">
        <div>
          <h1>
            AirType <span>✦</span>
          </h1>
          <p>Touchless typing, powered by hand tracking</p>
        </div>

        <span className={`status ${cameraReady ? "ready" : ""}`}>
          <i /> {cameraReady ? "Camera connected" : "Connecting camera"}
        </span>
      </header>

      <section className="camera-panel">
        <div className="section-heading">
          <h2>Live camera</h2>
          <span>HAND TRACKING</span>
        </div>

        <div className="camera-feed">
          <video ref={videoRef} autoPlay playsInline muted />
          {/* Mirrored so the skeleton lines up with the mirrored video. */}
          <canvas
            ref={canvasRef}
            className="hand-skeleton"
            style={{ transform: "scaleX(-1)" }}
          />
        </div>

        <p className="camera-message">{message}</p>
      </section>

      <section className="typing-panel">
        <div className="section-heading">
          <h2>Your text</h2>
          <span>{text.length} CHARACTERS</span>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Your letters will appear here..."
          aria-label="Your typed text"
        />

        <div className="actions">
          <button className="secondary-button" onClick={() => setText("")}>
            Clear text
          </button>

          <button
            className="primary-button"
            onClick={() => navigator.clipboard?.writeText(text)}
          >
            Copy text
          </button>
        </div>
      </section>

      <section className="keyboard-wrap">
        <div className="section-heading">
          <h2>Virtual keyboard</h2>
          <span>QWERTY LAYOUT</span>
        </div>

        <div className="keyboard" ref={keyboardRef}>
          {rows.map((row, index) => (
            <div className="key-row" key={index}>
              {row.map((key) => (
                <button
                  key={key}
                  type="button"
                  data-key={key}
                  className={[
                    "key",
                    key.length > 1 ? "special" : "",
                    hovered === key ? "hovered" : "",
                  ].join(" ")}
                  onClick={() => typeKey(key)}
                >
                  {key === "SPACE"
                    ? "SPACE"
                    : key === "BACKSPACE"
                    ? "⌫ BACKSPACE"
                    : key === "CLEAR"
                    ? "CLEAR"
                    : key}
                </button>
              ))}
            </div>
          ))}

          <div
            className="cursor"
            style={{
              left: cursor.x,
              top: cursor.y,
              display: cursor.x === 0 && cursor.y === 0 ? "none" : "block",
            }}
          >
            <span />
          </div>
        </div>

        <div className="instructions">
          <span>①</span> Point to highlight
          <span>②</span> Close hand to type
          <span>③</span> Open hand for the next letter
        </div>
      </section>
    </main>
  );
}