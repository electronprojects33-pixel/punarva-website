import './style.css';
import confetti from 'canvas-confetti';
import { APP_CONFIG } from './config';
import { DetectedBottle, SorterState } from './types';
import { soundEffects } from './services/audio';
import { wakeLockManager } from './services/wakelock';
import { firebaseService } from './services/firebase';
import { plasticDetector } from './services/detector';
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
  private scrollableContainerEl!: HTMLElement;
  private stageOverlayEl!: HTMLElement;
  private overlayDisarmedContentEl!: HTMLElement;
  private overlayStandbyContentEl!: HTMLElement;
  private adminResetSectionEl!: HTMLElement;
  private resetSectionCountEl!: HTMLElement;
  private btnResetCounterEl!: HTMLButtonElement;
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
    this.scrollableContainerEl = document.getElementById('scrollable-container')!;
    this.stageOverlayEl = document.getElementById('stage-overlay')!;
    this.overlayDisarmedContentEl = document.getElementById('overlay-disarmed-content')!;
    this.overlayStandbyContentEl = document.getElementById('overlay-standby-content')!;
    this.adminResetSectionEl = document.getElementById('admin-reset-section')!;
    this.resetSectionCountEl = document.getElementById('reset-section-count')!;
    this.btnResetCounterEl = document.getElementById('btn-reset-counter') as HTMLButtonElement;
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

    // Tap RTDB indicator to manually toggle object_detected signal for easy testing
    this.pillRtdbEl.style.cursor = 'pointer';
    this.pillRtdbEl.title = 'Click to toggle object_detected signal ON/OFF';
    this.pillRtdbEl.addEventListener('click', async () => {
      const current = firebaseService.getTriggerState();
      const next = !current;
      console.log(`Manually toggling RTDB object_detected to ${next}`);
      await firebaseService.setTriggerValue(next);
    });

    // Reset bottle counter button (accessible when scrolled down and disarmed)
    this.btnResetCounterEl.addEventListener('click', async () => {
      if (this.state !== 'DISARMED') {
        alert('Please disarm the sorter system before resetting the counter.');
        return;
      }
      if (confirm('Are you sure you want to reset the Firestore bottles_count to zero?')) {
        this.btnResetCounterEl.disabled = true;
        this.btnResetCounterEl.innerText = 'Resetting...';
        await firebaseService.resetBottleCount();
        this.totalBottlesDetected = 0;
        this.statTotalBottlesEl.innerText = '0';
        this.resetSectionCountEl.innerText = '0';
        this.btnResetCounterEl.disabled = false;
        this.btnResetCounterEl.innerText = 'Reset Bottle Count to Zero';
      }
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

    // RTDB Trigger listener for object_detected
    firebaseService.onTriggerChange((triggered) => {
      this.handleRtdbTriggerChange(triggered);
    });

    // Real-time bottle count listener from Firestore
    firebaseService.listenToBottleCount((count) => {
      this.totalBottlesDetected = count;
      this.statTotalBottlesEl.innerText = `${count}`;
      this.resetSectionCountEl.innerText = `${count}`;
    });

    this.updateRtdbIndicator();
  }

  private updateRtdbIndicator() {
    const isTriggered = firebaseService.getTriggerState();
    if (isTriggered) {
      this.pillRtdbEl.innerText = 'Signal: ON';
      this.pillRtdbEl.className = 'tel-val status-connected';
    } else {
      this.pillRtdbEl.innerText = 'Signal: OFF';
      this.pillRtdbEl.className = 'tel-val status-waiting';
    }
  }

  // Transitions state when RTDB object_detected attribute changes
  private handleRtdbTriggerChange(triggered: boolean) {
    this.updateRtdbIndicator();

    if (this.state === 'DISARMED') {
      console.info('RTDB object_detected changed, but system is disarmed. Awaiting user arming.');
      return;
    }

    if (triggered) {
      console.log('Signal received: object_detected == true. Activating camera viewfinder and multi-bottle detection!');
      soundEffects.playScannerActive();
      this.state = 'SCANNING';
      this.updateUIForState('SCANNING');
    } else {
      console.log('Signal ended: object_detected == false. Returning camera view to standby.');
      this.state = 'STANDBY';
      this.hudRenderer.clear();
      this.updateUIForState('STANDBY');
    }
  }

  // Arm the system (requests camera, wake lock, loads model)
  public async armSystem() {
    this.btnArmStageEl.disabled = true;

    try {
      // 1. Acquire Screen Wake Lock
      await wakeLockManager.requestLock();

      // 2. Start Camera
      await this.startCamera();

      // 3. Load Teachable Machine Detection Model (with dynamic bounding boxes)
      if (!plasticDetector.isReady()) {
        const modelRes = await plasticDetector.initialize(APP_CONFIG.modelUrl, APP_CONFIG.labelsUrl);
        if (!modelRes.success) {
          console.warn('Model notice:', modelRes.message);
        }
      }

      soundEffects.playArmedChime();

      // Check if RTDB trigger is already true
      if (firebaseService.getTriggerState()) {
        this.state = 'SCANNING';
        this.updateUIForState('SCANNING');
      } else {
        // Armed, but signal hasn't arrived: show Standby shutter screen
        this.state = 'STANDBY';
        this.updateUIForState('STANDBY');
      }

      this.updateRtdbIndicator();

      // Start continuous frame detection pipeline
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
      this.hudRenderer.syncSize(this.videoEl);
    };
  }

  // Real-time camera frame detection pipeline (actively draws multiple bounding boxes)
  private startFramePipeline() {
    const loop = (timestamp: number) => {
      this.calculateFps(timestamp);

      if (this.videoEl.videoWidth > 0) {
        this.hudRenderer.syncSize(this.videoEl);
      }

      // MODEL RUNS IN SCANNING / DETECTED (when object_detected == true)
      if (this.state === 'SCANNING' || this.state === 'DETECTED') {
        this.hudRenderer.clear();
        this.hudRenderer.drawScanningGuide(true);

        if (!this.isProcessingFrame && plasticDetector.isReady()) {
          this.isProcessingFrame = true;

          const result = plasticDetector.detectFrame(this.videoEl, timestamp);
          if (result) {
            const { bottles, inferenceMs } = result;

            this.statModelLatencyEl.innerText = `${inferenceMs}`;

            // Draw bounding boxes around all detected bottles
            this.hudRenderer.renderDetections(bottles, this.videoEl);

            if (bottles.length > 0) {
              this.onBottlesDetected(bottles);
            }
          }

          this.isProcessingFrame = false;
        }
      }

      this.animationFrameId = requestAnimationFrame(loop);
    };

    this.animationFrameId = requestAnimationFrame(loop);
  }

  // Triggered when one or more plastic bottles are recognized
  private onBottlesDetected(bottles: DetectedBottle[]) {
    const now = performance.now();

    // Check debounce / cooldown
    if (now - this.lastDetectionTime < APP_CONFIG.cooldownMs) {
      return;
    }

    this.lastDetectionTime = now;

    // Audio chime
    soundEffects.playDetectionChime();

    // Confetti burst
    confetti({
      particleCount: 22,
      spread: 60,
      origin: { y: 0.65 },
      colors: ['#059669', '#10b981', '#38bdf8']
    });

    // Non-blocking Firestore update: increments bottles_count by number of bottles found
    firebaseService.recordBottleDetection(bottles);

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

  // Updates UI state, overlays, and scroll permissions
  private updateUIForState(st: SorterState) {
    this.stateBadgeEl.className = 'state-badge ' + st.toLowerCase();
    this.stateTextEl.innerText = st;

    if (st === 'DISARMED') {
      // 1. Allow scrolling down to the reset button only when disarmed
      this.scrollableContainerEl.classList.remove('locked');
      this.adminResetSectionEl.classList.remove('hidden-when-armed');

      // 2. Show Disarmed overlay, hide Standby overlay
      this.stageOverlayEl.classList.remove('hidden');
      this.overlayDisarmedContentEl.classList.remove('hidden');
      this.overlayStandbyContentEl.classList.add('hidden');

      this.btnToggleArmLabel.innerText = 'Arm System';
      this.btnToggleArmEl.className = 'btn btn-primary btn-pill';
    } else if (st === 'STANDBY') {
      // Pin to top, lock scrolling so reset button cannot be reached during operation
      this.scrollableContainerEl.scrollTo({ top: 0, behavior: 'smooth' });
      this.scrollableContainerEl.classList.add('locked');
      this.adminResetSectionEl.classList.add('hidden-when-armed');

      // Show Standby screen masking camera feed until signal arrives
      this.stageOverlayEl.classList.remove('hidden');
      this.overlayDisarmedContentEl.classList.add('hidden');
      this.overlayStandbyContentEl.classList.remove('hidden');

      this.btnToggleArmLabel.innerText = 'Disarm';
      this.btnToggleArmEl.className = 'btn btn-danger btn-pill';
    } else if (st === 'SCANNING') {
      // Pin to top, lock scrolling
      this.scrollableContainerEl.scrollTo({ top: 0, behavior: 'smooth' });
      this.scrollableContainerEl.classList.add('locked');
      this.adminResetSectionEl.classList.add('hidden-when-armed');

      // SIGNAL IS HERE: Camera feed revealed! Shutter screen dissolves away smoothly
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
