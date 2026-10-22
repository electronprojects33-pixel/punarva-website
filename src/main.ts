import './style.css';
import confetti from 'canvas-confetti';
import { APP_CONFIG } from './config';
import { ClassificationCategory, SorterState } from './types';
import { soundEffects } from './services/audio';
import { wakeLockManager } from './services/wakelock';
import { firebaseService } from './services/firebase';
import { plasticClassifier } from './services/detector';
import { HudRenderer } from './ui/hud';

class SorterApp {
  private state: SorterState = 'DISARMED';
  private currentStream: MediaStream | null = null;
  private hudRenderer: HudRenderer;
  private audioEnabled: boolean = APP_CONFIG.enableAudio;

  // DOM Elements
  private videoEl!: HTMLVideoElement;
  private canvasEl!: HTMLCanvasElement;
  private stateBadgeEl!: HTMLElement;
  private stateTextEl!: HTMLElement;
  private stageOverlayEl!: HTMLElement;
  private overlayTitleEl!: HTMLElement;
  private overlayDescEl!: HTMLElement;
  private btnArmStageEl!: HTMLButtonElement;
  private btnToggleArmEl!: HTMLButtonElement;
  private btnToggleArmLabel!: HTMLElement;
  private btnFlipCamEl!: HTMLButtonElement;
  private btnToggleSoundEl!: HTMLButtonElement;
  private pillRtdbEl!: HTMLElement;
  private pillWakeLockEl!: HTMLElement;

  // Telemetry DOM
  private statTotalBottlesEl!: HTMLElement;
  private statModelLatencyEl!: HTMLElement;
  private statStreamFpsEl!: HTMLElement;

  // Runtime Tracking
  private frameCount: number = 0;
  private lastFpsCalcTime: number = performance.now();
  private currentFps: number = 0;
  private totalBottlesDetected: number = 0;
  private lastDetectionTime: number = 0;
  private animationFrameId: number | null = null;
  private isProcessingFrame: boolean = false;
  private currentFacingMode: 'environment' | 'user' = APP_CONFIG.cameraFacingMode;

  constructor() {
    this.bindDom();
    this.hudRenderer = new HudRenderer(this.canvasEl);
    this.setupListeners();
    this.initFirebase();
    this.initPWA();
    this.updateUIForState('DISARMED');
  }

  private bindDom() {
    this.videoEl = document.getElementById('camera-video') as HTMLVideoElement;
    this.canvasEl = document.getElementById('hud-canvas') as HTMLCanvasElement;
    this.stateBadgeEl = document.getElementById('system-state-badge')!;
    this.stateTextEl = document.getElementById('system-state-text')!;
    this.stageOverlayEl = document.getElementById('stage-overlay')!;
    this.overlayTitleEl = document.getElementById('overlay-title')!;
    this.overlayDescEl = document.getElementById('overlay-desc')!;
    this.btnArmStageEl = document.getElementById('btn-arm-stage') as HTMLButtonElement;
    this.btnToggleArmEl = document.getElementById('btn-toggle-arm') as HTMLButtonElement;
    this.btnToggleArmLabel = document.getElementById('btn-toggle-arm-label')!;
    this.btnFlipCamEl = document.getElementById('btn-flip-camera') as HTMLButtonElement;
    this.btnToggleSoundEl = document.getElementById('btn-toggle-sound') as HTMLButtonElement;
    this.pillRtdbEl = document.getElementById('pill-rtdb')!;
    this.pillWakeLockEl = document.getElementById('pill-wakelock')!;

    this.statTotalBottlesEl = document.getElementById('stat-total-bottles')!;
    this.statModelLatencyEl = document.getElementById('stat-model-latency')!;
    this.statStreamFpsEl = document.getElementById('stat-stream-fps')!;
  }

  private setupListeners() {
    // Arm / Disarm controls
    const toggleArmHandler = () => {
      if (this.state === 'DISARMED') {
        this.armSystem();
      } else {
        this.disarmSystem();
      }
    };

    this.btnArmStageEl.addEventListener('click', toggleArmHandler);
    this.btnToggleArmEl.addEventListener('click', toggleArmHandler);

    // Flip camera
    this.btnFlipCamEl.addEventListener('click', async () => {
      this.currentFacingMode = this.currentFacingMode === 'environment' ? 'user' : 'environment';
      if (this.state !== 'DISARMED') {
        await this.startCamera();
      }
    });

    // Sound toggle
    this.btnToggleSoundEl.addEventListener('click', () => {
      this.audioEnabled = !this.audioEnabled;
      soundEffects.setEnabled(this.audioEnabled);
      this.btnToggleSoundEl.style.opacity = this.audioEnabled ? '1' : '0.4';
    });

    // Wake lock status changes
    wakeLockManager.onStatusChange((active) => {
      this.pillWakeLockEl.innerText = active ? 'ON' : 'OFF';
      this.pillWakeLockEl.style.color = active ? '#059669' : '#64748b';
    });
  }

  private initFirebase() {
    const initResult = firebaseService.initialize();
    console.log('Firebase Init:', initResult);

    // RTDB Trigger listener
    firebaseService.onTriggerChange((triggered) => {
      this.handleRtdbTriggerChange(triggered);
    });

    // Update connection status
    this.updateRtdbIndicator();
  }

  private updateRtdbIndicator() {
    const rtdbReady = firebaseService.isRTDBReady();
    if (rtdbReady) {
      this.pillRtdbEl.innerText = 'ONLINE';
      this.pillRtdbEl.className = 'tel-val status-connected';
    } else {
      this.pillRtdbEl.innerText = 'WAITING';
      this.pillRtdbEl.className = 'tel-val status-waiting';
    }
  }

  // Transitions state when RTDB trigger changes
  private handleRtdbTriggerChange(triggered: boolean) {
    if (this.state === 'DISARMED') {
      console.info('RTDB triggered, but camera is disarmed. Awaiting user arming gesture.');
      return;
    }

    if (triggered) {
      console.log('RTDB trigger changed to TRUE: Activating frame classification loop');
      soundEffects.playScannerActive();
      this.state = 'SCANNING';
      this.updateUIForState('SCANNING');
    } else {
      console.log('RTDB trigger changed to FALSE: Pausing classification loop to Standby');
      this.state = 'STANDBY';
      this.hudRenderer.clear();
      this.updateUIForState('STANDBY');
    }
  }

  // Arm the system (requests camera, wake lock, loads model)
  public async armSystem() {
    this.overlayTitleEl.innerText = 'Starting Camera...';
    this.overlayDescEl.innerText = 'Acquiring display lock and loading Teachable Machine model...';
    this.btnArmStageEl.disabled = true;

    try {
      // 1. Acquire Screen Wake Lock
      await wakeLockManager.requestLock();

      // 2. Start Camera
      await this.startCamera();

      // 3. Load Teachable Machine Classifier Model
      if (!plasticClassifier.isReady()) {
        const modelRes = await plasticClassifier.initialize(
          APP_CONFIG.modelUrl,
          APP_CONFIG.labelsUrl
        );
        if (!modelRes.success) {
          console.warn('Model initialization notice:', modelRes.message);
        }
      }

      soundEffects.playArmedChime();

      // Check if RTDB trigger is already true
      if (firebaseService.getTriggerState()) {
        this.state = 'SCANNING';
        this.updateUIForState('SCANNING');
      } else {
        this.state = 'STANDBY';
        this.updateUIForState('STANDBY');
      }

      this.updateRtdbIndicator();

      // Start continuous frame pipeline
      this.startFramePipeline();
    } catch (err: any) {
      console.error('Failed to arm system:', err);
      alert('Camera access denied or hardware error: ' + (err.message || err));
      this.disarmSystem();
    } finally {
      this.btnArmStageEl.disabled = false;
    }
  }

  // Disarms camera and releases resources
  public disarmSystem() {
    this.state = 'DISARMED';
    soundEffects.playDisarmSound();
    wakeLockManager.releaseLock();

    if (this.currentStream) {
      this.currentStream.getTracks().forEach((t) => t.stop());
      this.currentStream = null;
    }
    this.videoEl.srcObject = null;
    this.hudRenderer.clear();

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.updateUIForState('DISARMED');
  }

  private async startCamera() {
    if (this.currentStream) {
      this.currentStream.getTracks().forEach((t) => t.stop());
    }

    const constraints: MediaStreamConstraints = {
      video: {
        facingMode: this.currentFacingMode,
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30 }
      },
      audio: false
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.currentStream = stream;
    this.videoEl.srcObject = stream;
    await this.videoEl.play();

    this.videoEl.onloadedmetadata = () => {
      const vw = this.videoEl.videoWidth;
      const vh = this.videoEl.videoHeight;
      this.hudRenderer.syncSize(vw, vh);
    };
  }

  // Real-time camera frame classification pipeline
  private startFramePipeline() {
    const loop = (timestamp: number) => {
      this.calculateFps(timestamp);

      if (this.videoEl.videoWidth > 0) {
        this.hudRenderer.syncSize(this.videoEl.videoWidth, this.videoEl.videoHeight);
      }

      // Process only if in SCANNING or DETECTED states
      if (this.state === 'SCANNING' || this.state === 'DETECTED' || this.state === 'COOLDOWN') {
        this.hudRenderer.clear();
        this.hudRenderer.drawScanningGuide(this.state === 'SCANNING');

        if (!this.isProcessingFrame && plasticClassifier.isReady()) {
          this.isProcessingFrame = true;

          const result = plasticClassifier.classifyFrame(this.videoEl, timestamp);
          if (result) {
            const { categories, topCategory, inferenceMs } = result;

            // Update latency displays
            this.statModelLatencyEl.innerText = `${inferenceMs}`;

            // Check if plastic bottle exceeds threshold
            const targetName = APP_CONFIG.targetClassName.toLowerCase();
            const bottleMatch = categories.find((cat) => {
              const name = cat.categoryName.toLowerCase();
              return (name === targetName || name.includes('bottle')) &&
                     cat.score >= APP_CONFIG.confidenceThreshold;
            });

            const isBottleTriggered = !!bottleMatch;
            this.hudRenderer.renderClassification(
              categories, 
              topCategory, 
              isBottleTriggered, 
              APP_CONFIG.targetClassName
            );

            if (bottleMatch) {
              this.onBottleDetected(bottleMatch);
            }
          }

          this.isProcessingFrame = false;
        }
      }

      this.animationFrameId = requestAnimationFrame(loop);
    };

    this.animationFrameId = requestAnimationFrame(loop);
  }

  // Triggered when a bottle is recognized by the classifier
  private onBottleDetected(bottle: ClassificationCategory) {
    const now = performance.now();

    // Check debounce / cooldown
    if (now - this.lastDetectionTime < APP_CONFIG.cooldownMs) {
      return;
    }

    this.lastDetectionTime = now;
    this.totalBottlesDetected++;
    this.statTotalBottlesEl.innerText = `${this.totalBottlesDetected}`;

    // Audio chime
    soundEffects.playDetectionChime();

    // Confetti burst
    confetti({
      particleCount: 20,
      spread: 60,
      origin: { y: 0.65 },
      colors: ['#059669', '#10b981', '#38bdf8']
    });

    // Non-blocking Firestore dispatch in background (no UI blocking)
    firebaseService.recordBottleDetection(bottle);

    // Briefly pulse status badge to DETECTED
    this.state = 'DETECTED';
    this.updateUIForState('DETECTED');

    setTimeout(() => {
      if (this.state === 'DETECTED' && firebaseService.getTriggerState()) {
        this.state = 'SCANNING';
        this.updateUIForState('SCANNING');
      }
    }, 600);
  }

  private calculateFps(timestamp: number) {
    this.frameCount++;
    const delta = timestamp - this.lastFpsCalcTime;
    if (delta >= 1000) {
      this.currentFps = Math.round((this.frameCount * 1000) / delta);
      this.statStreamFpsEl.innerText = `${this.currentFps}`;
      this.frameCount = 0;
      this.lastFpsCalcTime = timestamp;
    }
  }

  private updateUIForState(st: SorterState) {
    this.stateBadgeEl.className = 'state-badge ' + st.toLowerCase();
    this.stateTextEl.innerText = st;

    if (st === 'DISARMED') {
      this.stageOverlayEl.classList.remove('hidden');
      this.overlayTitleEl.innerText = 'Camera Disarmed';
      this.overlayDescEl.innerText = 'Tap below to arm camera. Live classification activates automatically when Realtime Database trigger turns true.';
      this.btnToggleArmLabel.innerText = 'Arm System';
      this.btnToggleArmEl.className = 'btn btn-primary btn-pill';
    } else if (st === 'STANDBY') {
      this.stageOverlayEl.classList.add('hidden');
      this.btnToggleArmLabel.innerText = 'Disarm';
      this.btnToggleArmEl.className = 'btn btn-danger btn-pill';
    } else if (st === 'SCANNING') {
      this.stageOverlayEl.classList.add('hidden');
      this.btnToggleArmLabel.innerText = 'Disarm';
      this.btnToggleArmEl.className = 'btn btn-danger btn-pill';
    }
  }

  private initPWA() {
    if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
          .then((reg) => console.log('Service Worker registered with scope:', reg.scope))
          .catch((err) => console.warn('Service Worker registration skipped/failed:', err));
      });
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new SorterApp();
});
