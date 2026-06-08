/**
 * Local MediaPipe vision pipeline (eye + hand modes). Runs in the offscreen
 * document - the only context that may open the camera under MV3. Camera frames
 * are processed entirely on-device; only derived features leave this module.
 *
 * One camera stream feeds one active tracker at a time:
 *   - 'face' → FaceLandmarker (478 landmarks incl. iris 468–477) → gaze feature,
 *              brow-raise + blink (via blendshapes)
 *   - 'hand' → HandLandmarker (21 landmarks) → index fingertip + gesture
 *
 * WASM + model assets are loaded locally (see public/models/README.md). The
 * MediaPipe wasm fileset must live at /public/mediapipe-wasm/.
 */
import {
  FaceLandmarker,
  FilesetResolver,
  HandLandmarker,
  type FaceLandmarkerResult,
  type HandLandmarkerResult,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision';
import { sendRuntime, type HandGesture, type VisionFrameData, type VisionTracker } from '@shared/messages';
import { classifyGesture } from './gestures';

const WASM_PATH = '/public/mediapipe-wasm';
const FACE_MODEL = '/public/models/face_landmarker.task';
const HAND_MODEL = '/public/models/hand_landmarker.task';

// KI-02: official Google-hosted fallback, used when the .task file wasn't
// bundled locally. MediaPipe's `modelAssetPath` accepts a URL directly and
// fetches it itself, so the browser's normal HTTP cache gives us "download
// once, reuse after" for free - no manual caching needed.
const FACE_MODEL_CDN =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task';
const HAND_MODEL_CDN =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task';

/** Use the bundled local model if present; otherwise fall back to the CDN. */
export async function resolveModelPath(localPath: string, cdnUrl: string): Promise<string> {
  try {
    const res = await fetch(localPath, { method: 'HEAD' });
    if (res.ok) return localPath;
  } catch {
    // Local fetch failing (e.g. not bundled) just means we fall through to the CDN.
  }
  return cdnUrl;
}

export class Vision {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private face: FaceLandmarker | null = null;
  private hand: HandLandmarker | null = null;
  private tracker: VisionTracker | null = null;
  private rafId: number | null = null;
  private lastVideoTime = -1;

  async start(tracker: VisionTracker): Promise<void> {
    if (this.tracker === tracker) return;
    await this.stop();
    this.tracker = tracker;

    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    if (tracker === 'face') {
      const modelAssetPath = await resolveModelPath(FACE_MODEL, FACE_MODEL_CDN);
      this.face = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true, // brow-raise + blink come from blendshapes
      });
    } else {
      const modelAssetPath = await resolveModelPath(HAND_MODEL, HAND_MODEL_CDN);
      this.hand = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath },
        runningMode: 'VIDEO',
        numHands: 1,
      });
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, frameRate: 30 },
    });
    this.video = document.createElement('video');
    this.video.srcObject = this.stream;
    this.video.muted = true;
    await this.video.play();
    this.loop();
  }

  async stop(): Promise<void> {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video?.remove();
    this.video = null;
    this.face?.close();
    this.face = null;
    this.hand?.close();
    this.hand = null;
    this.tracker = null;
    this.lastVideoTime = -1;
  }

  private loop = (): void => {
    const video = this.video;
    if (!video) return;
    if (video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = video.currentTime;
      const ts = performance.now();
      if (this.tracker === 'face' && this.face) {
        this.emit(faceFeatures(this.face.detectForVideo(video, ts)));
      } else if (this.tracker === 'hand' && this.hand) {
        this.emit(handFeatures(this.hand.detectForVideo(video, ts)));
      }
    }
    this.rafId = requestAnimationFrame(this.loop);
  };

  private emit(data: VisionFrameData | null): void {
    if (data) sendRuntime({ type: 'VISION_FRAME', target: 'background', data });
  }
}

/* --------------------------- feature extraction --------------------------- */

// MediaPipe FaceMesh iris + eye-corner landmark indices.
const RIGHT_IRIS = 468;
const LEFT_IRIS = 473;
const RIGHT_EYE_L = 33;
const RIGHT_EYE_R = 133;
const RIGHT_EYE_T = 159;
const RIGHT_EYE_B = 145;
const LEFT_EYE_L = 362;
const LEFT_EYE_R = 263;
const LEFT_EYE_T = 386;
const LEFT_EYE_B = 374;

function faceFeatures(result: FaceLandmarkerResult): VisionFrameData | null {
  const lm = result.faceLandmarks?.[0];
  if (!lm) return null;

  // Iris position within each eye socket, 0..1 on each axis.
  const rx = ratio(lm[RIGHT_IRIS].x, lm[RIGHT_EYE_L].x, lm[RIGHT_EYE_R].x);
  const lx = ratio(lm[LEFT_IRIS].x, lm[LEFT_EYE_L].x, lm[LEFT_EYE_R].x);
  const ry = ratio(lm[RIGHT_IRIS].y, lm[RIGHT_EYE_T].y, lm[RIGHT_EYE_B].y);
  const ly = ratio(lm[LEFT_IRIS].y, lm[LEFT_EYE_T].y, lm[LEFT_EYE_B].y);

  // Average both eyes; mirror x so moving eyes right moves cursor right.
  const gaze = { x: 1 - (rx + lx) / 2, y: (ry + ly) / 2 };

  const blend = result.faceBlendshapes?.[0]?.categories ?? [];
  const score = (name: string) => blend.find((c) => c.categoryName === name)?.score ?? 0;

  return {
    tracker: 'face',
    gaze,
    browRaise: score('browInnerUp') > 0.5 || score('browOuterUpLeft') > 0.6,
    blinkLeft: score('eyeBlinkLeft') > 0.5,
    blinkRight: score('eyeBlinkRight') > 0.5,
  };
}

function handFeatures(result: HandLandmarkerResult): VisionFrameData | null {
  const lm = result.landmarks?.[0] as NormalizedLandmark[] | undefined;
  if (!lm) return null;
  const tip = lm[8]; // index fingertip
  const gesture: HandGesture = classifyGesture(lm);
  return {
    tracker: 'hand',
    fingertip: { x: 1 - tip.x, y: tip.y }, // mirror x
    gesture,
  };
}

/** Position of v between a and b, clamped to 0..1. */
function ratio(v: number, a: number, b: number): number {
  if (b === a) return 0.5;
  return Math.min(1, Math.max(0, (v - a) / (b - a)));
}
