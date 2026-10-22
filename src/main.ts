import './style.css';
import confetti from 'canvas-confetti';
import { APP_CONFIG } from './config';
import { ClassificationCategory, ClassificationResult, SorterState } from './types';
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
  private statLivePredictionEl!: HTMLElement;
  private statModelLatencyEl!: HTMLElement;
  private statStreamFpsEl!: HTMLElement;

  // Live On-Screen AI Diagnostics Ticker
  private aiLiveTickerEl!: HTMLElement;
  private tickerDotEl!: HTMLElement;
  private tickerClassNameEl!: HTMLElement;
  private tickerScoreEl!: HTMLElement;
  private tickerBarFillEl!: HTMLElement;
  private tickerLogMsgEl!: HTMLElement;

  // Runtime Tracking
  private frameCount: number = 0;
  private lastFpsCalcTime: number = performance.now();
  private currentFps: number = 0;
  private totalBottlesDetected: number = 0;
  private lastDetectionTime: number = 0;
  private lastPeriodicLogTime: number = 0;
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
    this.logDiagnostic('SYSTEM', 'Application initialized. Awaiting user arming.');
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
    this.statLivePredictionEl = document.getElementById('stat-live-prediction')!;
    this.statModelLatencyEl = document.getElementById('stat-model-latency')!;
    this.statStreamFpsEl = document.getElementById('stat-stream-fps')!;

    this.aiLiveTickerEl = document.getElementById('ai-live-ticker')!;
    this.tickerDotEl = document.getElementById('ticker-dot')!;
    this.tickerClassNameEl = document.getElementById('ticker-class-name')!;
    this.tickerScoreEl = document.getElementById('ticker-score')!;
    this.tickerBarFillEl = document.getElementById('ticker-bar-fill')!;
    this.tickerLogMsgEl = document.getElementById('ticker-log-msg')!;
  }

  // Centralized diagnostic logging for console & live mobile screen
  private logDiagnostic(tag: string, message: string, data?: any) {
    const timeStr = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const formatted = `[${timeStr}] [${tag}] ${message}`;

    if (data !== undefined) {
      console.log(formatted, data);
    } else {
      console.log(formatted);
    }

    if (this.tickerLogMsgEl) {
      this.tickerLogMsgEl.innerText = formatted;
    }
  }

  private setupListeners() {
    // Arm / Disarm toggle controls
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
      this.logDiagnostic('CAMERA', `Switched camera facing mode to: ${this.currentFacingMode}`);
      if (this.state !== 'DISARMED') {
        await this.startCamera();
      }
    });

    // Sound toggle
    this.btnToggleSoundEl.addEventListener('click', () => {
      this.audioEnabled = !this.audioEnabled;
      soundEffects.setEnabled(this.audioEnabled);
      this.btnToggleSoundEl.style.opacity = this.audioEnabled ? '1' : '0.4';
      this.logDiagnostic('AUDIO', `Sound effects ${this.audioEnabled ? 'enabled' : 'muted'}`);
    });

    // Tap RTDB indicator to manually toggle object_detected signal for easy testing
    this.pillRtdbEl.style.cursor = 'pointer';
    this.pillRtdbEl.title = 'Click to toggle object_detected signal ON/OFF';
    this.pillRtdbEl.addEventListener('click', async () => {
      const current = firebaseService.getTriggerState();
      const next = !current;
      this.logDiagnostic('RTDB MANUAL', `Toggling RTDB "${APP_CONFIG.rtdbTriggerPath}" to: ${next}`);
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
        this.logDiagnostic('FIRESTORE', 'Resetting bottles_count to 0...');
        await firebaseService.resetBottleCount();
        this.totalBottlesDetected = 0;
        this.statTotalBottlesEl.innerText = '0';
        this.resetSectionCountEl.innerText = '0';
        this.btnResetCounterEl.disabled = false;
        this.btnResetCounterEl.innerText = 'Reset Bottle Count to Zero';
        this.logDiagnostic('FIRESTORE', 'Bottle count successfully reset to 0');
      }
    });

    // Wake lock status changes
    wakeLockManager.onStatusChange((active) => {
      this.pillWakeLockEl.innerText = active ? 'ON' : 'OFF';
      this.pillWakeLockEl.style.color = active ? '#059669' : '#64748b';
      this.logDiagnostic('WAKELOCK', `Screen wake lock is now: ${active ? 'ACTIVE' : 'RELEASED'}`);
    });
  }

  private initFirebase() {
    const initResult = firebaseService.initialize();
    this.logDiagnostic('FIREBASE', initResult.message);

    // RTDB Trigger listener for object_detected
    firebaseService.onTriggerChange((triggered) => {
      this.handleRtdbTriggerChange(triggered);
    });

    // Real-time bottle count listener from Firestore
    firebaseService.listenToBottleCount((count) => {
      this.totalBottlesDetected = count;
      this.statTotalBottlesEl.innerText = `${count}`;
      this.resetSectionCountEl.innerText = `${count}`;
      this.logDiagnostic('FIRESTORE', `Live sync: bottles_count is now ${count}`);
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
      this.logDiagnostic('RTDB', `Signal changed (${APP_CONFIG.rtdbTriggerPath}=${triggered}), awaiting system arming.`);
      return;
    }

    if (triggered) {
      this.logDiagnostic('RTDB TRIGGER', `Signal ON (${APP_CONFIG.rtdbTriggerPath}=true) -> Activating camera feed & AI classification!`);
      soundEffects.playScannerActive();
      this.state = 'SCANNING';
      this.updateUIForState('SCANNING');
    } else {
      this.logDiagnostic('RTDB TRIGGER', `Signal OFF (${APP_CONFIG.rtdbTriggerPath}=false) -> Pausing classification, camera in standby.`);
      this.state = 'STANDBY';
      this.hudRenderer.clear();
      this.updateUIForState('STANDBY');
    }
  }

  // Arm the system (requests camera, wake lock, loads model)
  public async armSystem() {
    this.btnArmStageEl.disabled = true;
    this.logDiagnostic('SYSTEM', 'Arming system: requesting camera and loading AI model...');

    try {
      // 1. Acquire Screen Wake Lock
      await wakeLockManager.requestLock();

      // 2. Start Camera
      await this.startCamera();

      // 3. Load Teachable Machine Image Classifier
      if (!plasticClassifier.isReady()) {
        this.logDiagnostic('MODEL', `Loading TFLite model from ${APP_CONFIG.modelUrl}...`);
        const modelRes = await plasticClassifier.initialize(APP_CONFIG.modelUrl, APP_CONFIG.labelsUrl);
        if (!modelRes.success) {
          this.logDiagnostic('MODEL WARNING', modelRes.message);
        } else {
          this.logDiagnostic('MODEL READY', 'Teachable Machine model loaded successfully!');
        }
      }

      soundEffects.playArmedChime();

      // Check if RTDB trigger is already true
      if (firebaseService.getTriggerState()) {
        this.state = 'SCANNING';
        this.updateUIForState('SCANNING');
        this.logDiagnostic('SYSTEM', 'System ARMED & active (RTDB signal already ON)');
      } else {
        // Armed, but signal hasn't arrived: show Standby shutter screen
        this.state = 'STANDBY';
        this.updateUIForState('STANDBY');
        this.logDiagnostic('SYSTEM', 'System ARMED in STANDBY. Waiting for RTDB object_detected = true');
      }

      this.updateRtdbIndicator();

      // Start continuous frame detection pipeline
      this.startFramePipeline();
    } catch (err: any) {
      this.logDiagnostic('ERROR', `Failed to arm system: ${err.message || err}`);
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

    this.statLivePredictionEl.innerText = '--';
    this.statLivePredictionEl.style.color = '';
    this.tickerClassNameEl.innerText = 'System Disarmed';
    this.tickerScoreEl.innerText = '--';
    this.tickerBarFillEl.style.width = '0%';
    this.tickerBarFillEl.className = 'ticker-bar-fill';
    this.tickerDotEl.className = 'ticker-dot';

    this.updateUIForState('DISARMED');
    this.logDiagnostic('SYSTEM', 'System DISARMED. Camera and AI stopped.');
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

    this.logDiagnostic('CAMERA', `Camera stream running (${this.currentFacingMode})`);
  }

  // Real-time camera classification pipeline (pure image classification, no bounding boxes)
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

        if (!this.isProcessingFrame && plasticClassifier.isReady()) {
          this.isProcessingFrame = true;

          const result: ClassificationResult | null = plasticClassifier.classifyFrame(this.videoEl, timestamp);
          if (result) {
            const { categories, topCategory, inferenceMs } = result;

            this.statModelLatencyEl.innerText = `${inferenceMs}`;

            // Locate Plastic_Bottle category
            const plasticCategory = categories.find((c) =>
              c.categoryName.toLowerCase().includes('bottle') ||
              c.categoryName.toLowerCase().includes('plastic')
            ) || (topCategory.categoryName.toLowerCase().includes('plastic') ? topCategory : null);

            const plasticScore = plasticCategory ? plasticCategory.score : 0;
            const plasticPct = Math.round(plasticScore * 100);
            const topPct = Math.round(topCategory.score * 100);

            // Is plastic bottle identified above confidence threshold?
            const isBottleIdentified = plasticScore >= APP_CONFIG.confidenceThreshold;

            // 1. Update on-screen telemetry prediction chip
            const displayLabel = isBottleIdentified
              ? `Bottle ${plasticPct}%`
              : `${topCategory.categoryName.replace('_', ' ')} ${topPct}%`;
            this.statLivePredictionEl.innerText = displayLabel;
            this.statLivePredictionEl.style.color = isBottleIdentified ? '#059669' : '#0284c7';

            // 2. Update Live Diagnostics Ticker card
            if (isBottleIdentified) {
              this.tickerClassNameEl.innerText = 'Plastic Bottle Detected';
              this.tickerScoreEl.innerText = `${plasticPct}%`;
              this.tickerBarFillEl.style.width = `${plasticPct}%`;
              this.tickerBarFillEl.className = 'ticker-bar-fill plastic';
              this.tickerDotEl.className = 'ticker-dot active-plastic';
            } else {
              this.tickerClassNameEl.innerText = topCategory.categoryName.replace('_', ' ');
              this.tickerScoreEl.innerText = `${topPct}%`;
              this.tickerBarFillEl.style.width = `${topPct}%`;
              this.tickerBarFillEl.className = 'ticker-bar-fill other';
              this.tickerDotEl.className = 'ticker-dot active-other';
            }

            // 3. Render HUD on canvas (viewfinder brackets + detection banner, no bounding boxes)
            this.hudRenderer.renderClassificationHUD(result, isBottleIdentified, plasticPct);

            // 4. Periodic diagnostic log to avoid console flood (every 1.2s during normal scanning)
            const now = performance.now();
            if (now - this.lastPeriodicLogTime > 1200) {
              this.lastPeriodicLogTime = now;
              const categoriesSummary = categories.map((c) => `${c.categoryName}: ${(c.score * 100).toFixed(1)}%`).join(' | ');
              console.log(`🔍 [AI CLASSIFIER] [${inferenceMs}ms] ${categoriesSummary} (Threshold: ${APP_CONFIG.confidenceThreshold * 100}%)`);
            }

            // 5. Handle Plastic Bottle Detection
            if (isBottleIdentified) {
              this.onBottleIdentified(plasticCategory || topCategory, inferenceMs);
            }
          }

          this.isProcessingFrame = false;
        }
      }

      this.animationFrameId = requestAnimationFrame(loop);
    };

    this.animationFrameId = requestAnimationFrame(loop);
  }

  // Triggered when plastic bottle is classified
  private onBottleIdentified(category: ClassificationCategory, inferenceMs: number) {
    const now = performance.now();
    const timeSinceLast = now - this.lastDetectionTime;
    const scorePct = Math.round(category.score * 100);

    // Check debounce / cooldown window
    if (timeSinceLast < APP_CONFIG.cooldownMs) {
      const remainingMs = Math.round(APP_CONFIG.cooldownMs - timeSinceLast);
      // Helpful log for why increment wasn't sent yet
      if (Math.random() < 0.2) { // sample to avoid console log spam
        console.warn(`⏳ [COOLDOWN ACTIVE] Plastic bottle detected (${scorePct}%), but cooldown has ${remainingMs}ms left.`);
      }
      return;
    }

    this.lastDetectionTime = now;

    // Verbose log for successful detection
    this.logDiagnostic(
      'DETECTION RESULT',
      `🍾 PLASTIC BOTTLE CONFIRMED! Score: ${scorePct}% (Threshold: ${Math.round(APP_CONFIG.confidenceThreshold * 100)}%) | Latency: ${inferenceMs}ms -> Incrementing Firestore bottles_count (+1)...`
    );

    // Audio chime
    soundEffects.playDetectionChime();

    // Confetti burst
    confetti({
      particleCount: 24,
      spread: 60,
      origin: { y: 0.65 },
      colors: ['#059669', '#10b981', '#38bdf8']
    });

    // Non-blocking Firestore update: increments bottles_count by 1
    firebaseService.recordBottleDetection(category);

    // Briefly pulse status badge to DETECTED
    this.state = 'DETECTED';
    this.updateUIForState('DETECTED');

    setTimeout(() => {
      if (this.state === 'DETECTED' && firebaseService.getTriggerState()) {
        this.state = 'SCANNING';
        this.updateUIForState('SCANNING');
      }
    }, 700);
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
    } else if (st === 'SCANNING' || st === 'DETECTED') {
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
