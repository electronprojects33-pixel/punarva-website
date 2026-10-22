import './style.css';
import confetti from 'canvas-confetti';
import { APP_CONFIG } from './config';
import { GeminiVisionResult, SorterState } from './types';
import { soundEffects } from './services/audio';
import { wakeLockManager } from './services/wakelock';
import { firebaseService } from './services/firebase';
import { geminiVision } from './services/gemini';
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
  private animationFrameId: number | null = null;
  private currentFacingMode: 'environment' | 'user' = APP_CONFIG.cameraFacingMode;
  private hasDetectedForCurrentTrigger: boolean = false;
  private lastBottleResult: GeminiVisionResult | null = null;
  private lastBottleResultAt: number = 0;

  constructor() {
    this.bindDom();
    this.hudRenderer = new HudRenderer(this.canvasEl);
    this.setupListeners();
    this.initFirebase();
    this.initPWA();
    this.updateUIForState('DISARMED');
    this.logDiagnostic('SYSTEM', 'AeroSort initialized with Google Gemini REST API.');
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

    // Telemetry
    this.statTotalBottlesEl = document.getElementById('stat-total-bottles')!;
    this.statLivePredictionEl = document.getElementById('stat-live-prediction')!;
    this.statModelLatencyEl = document.getElementById('stat-model-latency')!;
    this.statStreamFpsEl = document.getElementById('stat-stream-fps')!;

    // Live AI Ticker
    this.aiLiveTickerEl = document.getElementById('ai-live-ticker')!;
    this.tickerDotEl = document.getElementById('ticker-dot')!;
    this.tickerClassNameEl = document.getElementById('ticker-class-name')!;
    this.tickerScoreEl = document.getElementById('ticker-score')!;
    this.tickerBarFillEl = document.getElementById('ticker-bar-fill')!;
    this.tickerLogMsgEl = document.getElementById('ticker-log-msg')!;
  }

  // Centralized diagnostic logging for console & live mobile screen
  private logDiagnostic(tag: string, message: string, data?: any) {
    const timeStr = new Date().toLocaleTimeString([], {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
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
  private async handleRtdbTriggerChange(triggered: boolean) {
    this.updateRtdbIndicator();

    if (this.state === 'DISARMED') {
      this.logDiagnostic(
        'RTDB',
        `Signal changed (${APP_CONFIG.rtdbTriggerPath}=${triggered}), awaiting system arming.`
      );
      return;
    }

    if (triggered) {
      this.hasDetectedForCurrentTrigger = false;
      this.logDiagnostic(
        'RTDB TRIGGER',
        `Signal ON (${APP_CONFIG.rtdbTriggerPath}=true) -> Capturing photo for Gemini REST API analysis...`
      );
      soundEffects.playScannerActive();
      this.state = 'SCANNING';
      this.updateUIForState('SCANNING');

      // Execute photo capture and Gemini REST check workflow
      await this.captureAndAnalyzePhotoWorkflow();
    } else {
      this.hasDetectedForCurrentTrigger = false;
      this.logDiagnostic(
        'RTDB TRIGGER',
        `Signal OFF (${APP_CONFIG.rtdbTriggerPath}=false) -> Ready for next object.`
      );
      this.state = 'STANDBY';
      this.hudRenderer.clear();
      this.updateUIForState('STANDBY');
      this.tickerClassNameEl.innerText = 'Standing by for next object...';
      this.tickerScoreEl.innerText = '--';
      this.tickerBarFillEl.style.width = '0%';
      this.tickerBarFillEl.className = 'ticker-bar-fill';
      this.tickerDotEl.className = 'ticker-dot';
    }
  }

  /**
   * Main workflow: captures a photo from the camera and queries Gemini REST API to verify if it's a bottle
   */
  private async captureAndAnalyzePhotoWorkflow() {
    if (this.state === 'DISARMED' || !firebaseService.getTriggerState()) {
      return;
    }

    if (geminiVision.isBusy()) {
      this.logDiagnostic('GEMINI REST', 'Previous analysis still in progress, waiting...');
      return;
    }

    // Indicate scanning state on UI
    this.tickerClassNameEl.innerText = 'Capturing & Analyzing Photo...';
    this.tickerScoreEl.innerText = '--';
    this.tickerBarFillEl.style.width = '50%';
    this.tickerBarFillEl.className = 'ticker-bar-fill';
    this.tickerDotEl.className = 'ticker-dot';
    this.statLivePredictionEl.innerText = 'Analyzing...';
    this.statLivePredictionEl.style.color = '#38bdf8';
    this.tickerLogMsgEl.innerText = `[Workflow] Capturing photo for Gemini (${APP_CONFIG.geminiModel})...`;

    // Wait a brief 250ms for the physical object to settle in front of the lens
    await new Promise((r) => setTimeout(r, 250));

    // Re-verify still armed and trigger is still true
    if ((this.state as SorterState) === 'DISARMED' || !firebaseService.getTriggerState()) {
      this.logDiagnostic('WORKFLOW', 'Trigger cleared before photo analysis, cancelled.');
      return;
    }

    try {
      const result = await geminiVision.analyzePhoto(this.videoEl);
      this.statModelLatencyEl.innerText = `${result.inferenceMs}`;
      const scorePct = Math.round(result.confidence * 100);

      if (result.isPlasticBottle && result.confidence >= APP_CONFIG.confidenceThreshold) {
        // PLASTIC BOTTLE CONFIRMED!
        this.hasDetectedForCurrentTrigger = true;
        this.lastBottleResult = result;
        this.lastBottleResultAt = performance.now();

        this.statLivePredictionEl.innerText = `Bottle ${scorePct}%`;
        this.statLivePredictionEl.style.color = '#059669';
        this.tickerClassNameEl.innerText = 'Plastic Bottle Detected';
        this.tickerScoreEl.innerText = `${scorePct}%`;
        this.tickerBarFillEl.style.width = `${scorePct}%`;
        this.tickerBarFillEl.className = 'ticker-bar-fill plastic';
        this.tickerDotEl.className = 'ticker-dot active-plastic';
        this.tickerLogMsgEl.innerText = `[Gemini REST] Bottle verified (${scorePct}%): ${result.reason}`;

        this.onBottleIdentified(result);
      } else {
        // NOT A PLASTIC BOTTLE
        this.statLivePredictionEl.innerText = 'No Bottle';
        this.statLivePredictionEl.style.color = '#0284c7';
        this.tickerClassNameEl.innerText = result.isPlasticBottle
          ? `Low Confidence (${scorePct}%)`
          : 'Not a Plastic Bottle';
        this.tickerScoreEl.innerText = `${scorePct}%`;
        this.tickerBarFillEl.style.width = '0%';
        this.tickerBarFillEl.className = 'ticker-bar-fill other';
        this.tickerDotEl.className = 'ticker-dot active-other';
        this.tickerLogMsgEl.innerText = `[Gemini REST] ${result.reason} (${result.inferenceMs}ms)`;
        this.logDiagnostic(
          'GEMINI REST',
          `❌ Object is NOT a bottle (${scorePct}% confidence). Reason: "${result.reason}"`
        );
      }
    } catch (err: any) {
      this.logDiagnostic('GEMINI ERROR', `Photo analysis failed: ${err.message || err}`);
      this.statLivePredictionEl.innerText = 'API Error';
      this.statLivePredictionEl.style.color = '#ef4444';
      this.tickerClassNameEl.innerText = 'Analysis Failed';
      this.tickerLogMsgEl.innerText = `[Error] ${err.message || err}`;
    }
  }

  // Arm the system (requests camera, wake lock, checks Gemini API key)
  public async armSystem() {
    if (!geminiVision.hasApiKey()) {
      this.logDiagnostic(
        'GEMINI ERROR',
        'Gemini API key is missing. Please add your key to GEMINI_API_KEY in src/config.ts or .env'
      );
      alert('Please set your Gemini API key in src/config.ts or .env before arming.');
      return;
    }

    this.btnArmStageEl.disabled = true;
    this.logDiagnostic('SYSTEM', 'Arming system: starting camera feed...');

    try {
      // 1. Acquire Screen Wake Lock
      await wakeLockManager.requestLock();

      // 2. Start Camera
      await this.startCamera();

      soundEffects.playArmedChime();

      // Check if RTDB trigger is already true
      if (firebaseService.getTriggerState()) {
        this.state = 'SCANNING';
        this.updateUIForState('SCANNING');
        this.logDiagnostic('SYSTEM', 'System ARMED & active (RTDB signal already ON)');
        // Trigger workflow immediately
        this.captureAndAnalyzePhotoWorkflow();
      } else {
        // Armed, but signal hasn't arrived: show Standby shutter screen
        this.state = 'STANDBY';
        this.updateUIForState('STANDBY');
        this.logDiagnostic('SYSTEM', 'System ARMED in STANDBY. Waiting for RTDB object_detected = true');
      }

      this.updateRtdbIndicator();

      // Start continuous HUD rendering loop
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
    this.lastBottleResult = null;
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
    this.logDiagnostic('SYSTEM', 'System DISARMED. Camera stopped.');
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

  // Continuous HUD rendering pipeline
  private startFramePipeline() {
    const loop = (timestamp: number) => {
      this.calculateFps(timestamp);

      if (this.videoEl.videoWidth > 0) {
        this.hudRenderer.syncSize(this.videoEl);
      }

      if (this.state === 'SCANNING' || this.state === 'DETECTED') {
        this.hudRenderer.clear();
        this.hudRenderer.drawScanningGuide(!this.hasDetectedForCurrentTrigger);

        // Keep the detection banner visible for a few seconds after a bottle is confirmed
        const showBanner = this.lastBottleResult && performance.now() - this.lastBottleResultAt < 3500;
        this.hudRenderer.renderGeminiVisionHUD(showBanner ? this.lastBottleResult : null);
      }

      this.animationFrameId = requestAnimationFrame(loop);
    };

    this.animationFrameId = requestAnimationFrame(loop);
  }

  // Triggered when plastic bottle is verified by Gemini REST API
  private onBottleIdentified(result: GeminiVisionResult) {
    const now = performance.now();
    const timeSinceLast = now - this.lastDetectionTime;
    const scorePct = Math.round(result.confidence * 100);

    // Check debounce / cooldown window
    if (timeSinceLast < APP_CONFIG.cooldownMs) {
      const remainingMs = Math.round(APP_CONFIG.cooldownMs - timeSinceLast);
      console.warn(
        `⏳ [COOLDOWN ACTIVE] Bottle verified (${scorePct}%), but cooldown has ${remainingMs}ms left.`
      );
      return;
    }

    this.lastDetectionTime = now;

    // Verbose log for successful detection
    this.logDiagnostic(
      'GEMINI DETECTION',
      `🍾 PLASTIC BOTTLE CONFIRMED! (${scorePct}%) Reason: "${result.reason}" | Latency: ${result.inferenceMs}ms -> Dispatching Firestore increment (+1)...`
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
    firebaseService.recordBottleDetection(result);

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
      this.scrollableContainerEl.classList.remove('locked');
      this.adminResetSectionEl.classList.remove('hidden-when-armed');

      this.stageOverlayEl.classList.remove('hidden');
      this.overlayDisarmedContentEl.classList.remove('hidden');
      this.overlayStandbyContentEl.classList.add('hidden');

      this.btnToggleArmLabel.innerText = 'Arm System';
      this.btnToggleArmEl.className = 'btn btn-primary btn-pill';
    } else if (st === 'STANDBY') {
      this.scrollableContainerEl.scrollTo({ top: 0, behavior: 'smooth' });
      this.scrollableContainerEl.classList.add('locked');
      this.adminResetSectionEl.classList.add('hidden-when-armed');

      this.stageOverlayEl.classList.remove('hidden');
      this.overlayDisarmedContentEl.classList.add('hidden');
      this.overlayStandbyContentEl.classList.remove('hidden');

      this.btnToggleArmLabel.innerText = 'Disarm';
      this.btnToggleArmEl.className = 'btn btn-danger btn-pill';
    } else if (st === 'SCANNING' || st === 'DETECTED') {
      this.scrollableContainerEl.scrollTo({ top: 0, behavior: 'smooth' });
      this.scrollableContainerEl.classList.add('locked');
      this.adminResetSectionEl.classList.add('hidden-when-armed');

      // SIGNAL IS HERE: Camera feed revealed!
      this.stageOverlayEl.classList.add('hidden');

      this.btnToggleArmLabel.innerText = 'Disarm';
      this.btnToggleArmEl.className = 'btn btn-danger btn-pill';
    }
  }

  private initPWA() {
    if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('/sw.js')
          .then((reg) => console.log('Service Worker registered with scope:', reg.scope))
          .catch((err) => console.warn('Service Worker registration skipped/failed:', err));
      });
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new SorterApp();
});
