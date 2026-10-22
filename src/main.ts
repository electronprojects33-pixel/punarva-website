import './style.css';
import confetti from 'canvas-confetti';
import { APP_CONFIG } from './config';
import { GeminiVisionResult, SorterState } from './types';
import { soundEffects } from './services/audio';
import { wakeLockManager } from './services/wakelock';
import { firebaseService } from './services/firebase';
import { geminiVision } from './services/gemini';
import { HudRenderer } from './ui/hud';

const ADMIN_PASSWORD = 'punarva123';
const THANK_YOU_DURATION_MS = 4000;

class SorterApp {
  private state: SorterState = 'DISARMED';
  private currentStream: MediaStream | null = null;
  private hudRenderer!: HudRenderer;
  private audioEnabled = APP_CONFIG.enableAudio;
  private adminAuthenticated = false;
  private thankYouTimer: ReturnType<typeof setTimeout> | null = null;

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

  private statTotalBottlesEl!: HTMLElement;
  private adminStatTotalBottlesEl!: HTMLElement;
  private statLivePredictionEl!: HTMLElement;
  private statModelLatencyEl!: HTMLElement;
  private statStreamFpsEl!: HTMLElement;

  private tickerDotEl!: HTMLElement;
  private tickerClassNameEl!: HTMLElement;
  private tickerScoreEl!: HTMLElement;
  private tickerBarFillEl!: HTMLElement;
  private tickerLogMsgEl!: HTMLElement;

  private publicScreenEl!: HTMLElement;
  private adminLoginScreenEl!: HTMLElement;
  private adminScreenEl!: HTMLElement;
  private adminPasswordInputEl!: HTMLInputElement;
  private adminLoginErrorEl!: HTMLElement;
  private publicStatusEl!: HTMLElement;
  private publicStatusTextEl!: HTMLElement;
  private publicThankYouEl!: HTMLElement;

  private frameCount = 0;
  private lastFpsCalcTime = performance.now();
  private totalBottlesDetected = 0;
  private lastDetectionTime = 0;
  private animationFrameId: number | null = null;
  private currentFacingMode: 'environment' | 'user' =
    APP_CONFIG.cameraFacingMode;
  private hasDetectedForCurrentTrigger = false;
  private lastBottleResult: GeminiVisionResult | null = null;
  private lastBottleResultAt = 0;

  constructor() {
    this.bindDom();
    this.hudRenderer = new HudRenderer(this.canvasEl);
    this.setupListeners();
    this.initFirebase();
    this.initPWA();
    this.updateUIForState('DISARMED');
    this.updatePublicStatus();
    this.logDiagnostic('SYSTEM', 'Punarva initialized with Google Gemini REST API.');
  }

  private getElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Required HTML element not found: #${id}`);
    }
    return element as T;
  }

  private bindDom() {
    this.videoEl = this.getElement<HTMLVideoElement>('camera-video');
    this.canvasEl = this.getElement<HTMLCanvasElement>('hud-canvas');
    this.stateBadgeEl = this.getElement('system-state-badge');
    this.stateTextEl = this.getElement('system-state-text');
    this.scrollableContainerEl = this.getElement('scrollable-container');
    this.stageOverlayEl = this.getElement('stage-overlay');
    this.overlayDisarmedContentEl = this.getElement('overlay-disarmed-content');
    this.overlayStandbyContentEl = this.getElement('overlay-standby-content');
    this.adminResetSectionEl = this.getElement('admin-reset-section');
    this.resetSectionCountEl = this.getElement('reset-section-count');
    this.btnResetCounterEl = this.getElement<HTMLButtonElement>('btn-reset-counter');
    this.btnArmStageEl = this.getElement<HTMLButtonElement>('btn-arm-stage');
    this.btnToggleArmEl = this.getElement<HTMLButtonElement>('btn-toggle-arm');
    this.btnToggleArmLabel = this.getElement('btn-toggle-arm-label');
    this.btnFlipCamEl = this.getElement<HTMLButtonElement>('btn-flip-camera');
    this.btnToggleSoundEl = this.getElement<HTMLButtonElement>('btn-toggle-sound');
    this.pillRtdbEl = this.getElement('pill-rtdb');
    this.pillWakeLockEl = this.getElement('pill-wakelock');

    this.statTotalBottlesEl = this.getElement('stat-total-bottles');
    this.adminStatTotalBottlesEl = this.getElement('admin-stat-total-bottles');
    this.statLivePredictionEl = this.getElement('stat-live-prediction');
    this.statModelLatencyEl = this.getElement('stat-model-latency');
    this.statStreamFpsEl = this.getElement('stat-stream-fps');

    this.tickerDotEl = this.getElement('ticker-dot');
    this.tickerClassNameEl = this.getElement('ticker-class-name');
    this.tickerScoreEl = this.getElement('ticker-score');
    this.tickerBarFillEl = this.getElement('ticker-bar-fill');
    this.tickerLogMsgEl = this.getElement('ticker-log-msg');

    this.publicScreenEl = this.getElement('public-screen');
    this.adminLoginScreenEl = this.getElement('admin-login-screen');
    this.adminScreenEl = this.getElement('admin-screen');
    this.adminPasswordInputEl = this.getElement<HTMLInputElement>('admin-password');
    this.adminLoginErrorEl = this.getElement('admin-login-error');
    this.publicStatusEl = this.getElement('public-live-status');
    this.publicStatusTextEl = this.getElement('public-system-status-text');
    this.publicThankYouEl = this.getElement('public-thank-you');
  }

  private logDiagnostic(tag: string, message: string, data?: unknown) {
    const timeStr = new Date().toLocaleTimeString([], {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    const formatted = `[${timeStr}] [${tag}] ${message}`;

    if (data !== undefined) console.log(formatted, data);
    else console.log(formatted);

    if (this.tickerLogMsgEl) {
      this.tickerLogMsgEl.innerText = formatted;
    }
  }

  private setupListeners() {
    // Public/admin navigation
    this.getElement<HTMLButtonElement>('btn-open-admin')
      .addEventListener('click', () => {
        this.showScreen('login');
        this.adminPasswordInputEl.value = '';
        this.adminLoginErrorEl.classList.add('hidden');
        this.adminPasswordInputEl.focus();
      });

    this.getElement<HTMLButtonElement>('btn-cancel-admin')
      .addEventListener('click', () => this.showScreen('public'));

    this.getElement<HTMLFormElement>('admin-login-form')
      .addEventListener('submit', (event) => {
        event.preventDefault();

        if (this.adminPasswordInputEl.value === ADMIN_PASSWORD) {
          this.adminAuthenticated = true;
          this.adminLoginErrorEl.classList.add('hidden');
          this.adminPasswordInputEl.value = '';
          this.showScreen('admin');
          this.logDiagnostic('ADMIN', 'Administrator authenticated.');
        } else {
          this.adminLoginErrorEl.classList.remove('hidden');
          this.adminPasswordInputEl.value = '';
          this.adminPasswordInputEl.focus();
        }
      });

    this.getElement<HTMLButtonElement>('btn-admin-logout')
      .addEventListener('click', () => {
        if (this.state !== 'DISARMED') {
          this.disarmSystem();
        }
        this.adminAuthenticated = false;
        this.showScreen('public');
        this.logDiagnostic('ADMIN', 'Administrator logged out.');
      });

    const toggleArmHandler = () => {
      if (!this.adminAuthenticated) {
        alert('Please log in as administrator first.');
        return;
      }

      if (this.state === 'DISARMED') {
        void this.armSystem();
      } else {
        this.disarmSystem();
      }
    };

    this.btnArmStageEl.addEventListener('click', toggleArmHandler);
    this.btnToggleArmEl.addEventListener('click', toggleArmHandler);

    this.btnFlipCamEl.addEventListener('click', async () => {
      if (!this.adminAuthenticated) return;

      this.currentFacingMode =
        this.currentFacingMode === 'environment' ? 'user' : 'environment';

      this.logDiagnostic('CAMERA', `Switched camera to ${this.currentFacingMode}.`);

      if (this.state !== 'DISARMED') {
        try {
          await this.startCamera();
        } catch (error) {
          this.logDiagnostic('CAMERA ERROR', String(error));
          alert('Unable to switch camera.');
        }
      }
    });

    this.btnToggleSoundEl.addEventListener('click', () => {
      this.audioEnabled = !this.audioEnabled;
      soundEffects.setEnabled(this.audioEnabled);
      this.btnToggleSoundEl.style.opacity = this.audioEnabled ? '1' : '0.4';
      this.logDiagnostic('AUDIO', `Sound ${this.audioEnabled ? 'enabled' : 'muted'}.`);
    });

    this.pillRtdbEl.style.cursor = 'pointer';
    this.pillRtdbEl.title = 'Toggle object_detected signal for testing';
    this.pillRtdbEl.addEventListener('click', async () => {
      if (!this.adminAuthenticated) return;

      const next = !firebaseService.getTriggerState();
      this.logDiagnostic(
        'RTDB MANUAL',
        `Setting ${APP_CONFIG.rtdbTriggerPath} to ${next}.`
      );
      await firebaseService.setTriggerValue(next);
    });

    this.btnResetCounterEl.addEventListener('click', async () => {
      if (!this.adminAuthenticated) return;

      if (this.state !== 'DISARMED') {
        alert('Please disarm the sorter system before resetting the counter.');
        return;
      }

      if (!confirm('Are you sure you want to reset the bottle count to zero?')) {
        return;
      }

      this.btnResetCounterEl.disabled = true;
      this.btnResetCounterEl.innerText = 'Resetting...';

      try {
        await firebaseService.resetBottleCount();
        this.totalBottlesDetected = 0;
        this.updateBottleCountDisplays(0);
        this.logDiagnostic('FIRESTORE', 'Bottle count reset requested.');
      } catch (error) {
        this.logDiagnostic('FIRESTORE ERROR', String(error));
        alert('Could not reset the bottle counter. Check the console.');
      } finally {
        this.btnResetCounterEl.disabled = false;
        this.btnResetCounterEl.innerText = 'Reset Bottle Count to Zero';
      }
    });

    wakeLockManager.onStatusChange((active) => {
      this.pillWakeLockEl.innerText = active ? 'ON' : 'OFF';
      this.pillWakeLockEl.style.color = active ? '#059669' : '#64748b';
      this.logDiagnostic(
        'WAKELOCK',
        `Screen wake lock ${active ? 'active' : 'released'}.`
      );
    });
  }

  private showScreen(screen: 'public' | 'login' | 'admin') {
    this.publicScreenEl.classList.toggle('hidden', screen !== 'public');
    this.adminLoginScreenEl.classList.toggle('hidden', screen !== 'login');
    this.adminScreenEl.classList.toggle('hidden', screen !== 'admin');

    if (screen !== 'admin' && this.state !== 'DISARMED') {
      this.disarmSystem();
    }
  }

  private updateBottleCountDisplays(count: number) {
    this.statTotalBottlesEl.innerText = String(count);
    this.adminStatTotalBottlesEl.innerText = String(count);
    this.resetSectionCountEl.innerText = String(count);
  }

  private updatePublicStatus() {
    const signalOn = firebaseService.getTriggerState();

    // This reflects the RTDB trigger, not a separate hardware-health heartbeat.
    this.publicStatusEl.innerText = signalOn ? 'Live' : 'Ready';
    this.publicStatusTextEl.innerText = signalOn ? 'LIVE' : 'READY';
    this.publicStatusTextEl.className = signalOn
      ? 'status-connected'
      : 'status-waiting';
  }

  private showThankYou() {
    this.publicThankYouEl.classList.remove('hidden');

    if (this.thankYouTimer) clearTimeout(this.thankYouTimer);

    this.thankYouTimer = setTimeout(() => {
      this.publicThankYouEl.classList.add('hidden');
      this.thankYouTimer = null;
    }, THANK_YOU_DURATION_MS);
  }

  private initFirebase() {
    const initResult = firebaseService.initialize();
    this.logDiagnostic('FIREBASE', initResult.message);

    firebaseService.onTriggerChange((triggered) => {
      this.handleRtdbTriggerChange(triggered);
      this.updatePublicStatus();
    });

    firebaseService.listenToBottleCount((count) => {
      this.totalBottlesDetected = count;
      this.updateBottleCountDisplays(count);
      this.logDiagnostic('FIRESTORE', `Bottle count updated to ${count}.`);
    });

    this.updateRtdbIndicator();
    this.updatePublicStatus();
  }

  private updateRtdbIndicator() {
    const triggered = firebaseService.getTriggerState();

    this.pillRtdbEl.innerText = triggered ? 'Signal: ON' : 'Signal: OFF';
    this.pillRtdbEl.className = triggered
      ? 'tel-val status-connected'
      : 'tel-val status-waiting';
  }

  private async handleRtdbTriggerChange(triggered: boolean) {
    this.updateRtdbIndicator();

    if (this.state === 'DISARMED') {
      this.logDiagnostic(
        'RTDB',
        `Signal changed (${APP_CONFIG.rtdbTriggerPath}=${triggered}); system is disarmed.`
      );
      return;
    }

    if (triggered) {
      this.hasDetectedForCurrentTrigger = false;
      this.logDiagnostic(
        'RTDB TRIGGER',
        'Signal ON. Capturing image for Gemini analysis.'
      );

      soundEffects.playScannerActive();
      this.state = 'SCANNING';
      this.updateUIForState('SCANNING');
      await this.captureAndAnalyzePhotoWorkflow();
    } else {
      this.hasDetectedForCurrentTrigger = false;
      this.logDiagnostic('RTDB TRIGGER', 'Signal OFF. Ready for next object.');

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

  private async captureAndAnalyzePhotoWorkflow() {
    if (this.state === 'DISARMED' || !firebaseService.getTriggerState()) return;

    if (geminiVision.isBusy()) {
      this.logDiagnostic('GEMINI REST', 'Previous analysis is still in progress.');
      return;
    }

    this.tickerClassNameEl.innerText = 'Capturing & Analyzing Photo...';
    this.tickerScoreEl.innerText = '--';
    this.tickerBarFillEl.style.width = '50%';
    this.tickerBarFillEl.className = 'ticker-bar-fill';
    this.tickerDotEl.className = 'ticker-dot';
    this.statLivePredictionEl.innerText = 'Analyzing...';
    this.statLivePredictionEl.style.color = '#38bdf8';
    this.tickerLogMsgEl.innerText =
      `[Workflow] Capturing photo for Gemini (${APP_CONFIG.geminiModel})...`;

    await new Promise((resolve) => setTimeout(resolve, 250));

    if (!firebaseService.getTriggerState()) {
      this.logDiagnostic('WORKFLOW', 'Trigger cleared before analysis; cancelled.');
      return;
    }

    try {
      const result = await geminiVision.analyzePhoto(this.videoEl);
      this.statModelLatencyEl.innerText = String(result.inferenceMs);
      const scorePct = Math.round(result.confidence * 100);

      if (
        result.isPlasticBottle &&
        result.confidence >= APP_CONFIG.confidenceThreshold
      ) {
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
        this.tickerLogMsgEl.innerText =
          `[Gemini REST] Bottle verified (${scorePct}%): ${result.reason}`;

        this.onBottleIdentified(result);
      } else {
        this.statLivePredictionEl.innerText = 'No Bottle';
        this.statLivePredictionEl.style.color = '#0284c7';
        this.tickerClassNameEl.innerText = result.isPlasticBottle
          ? `Low Confidence (${scorePct}%)`
          : 'Not a Plastic Bottle';
        this.tickerScoreEl.innerText = `${scorePct}%`;
        this.tickerBarFillEl.style.width = '0%';
        this.tickerBarFillEl.className = 'ticker-bar-fill other';
        this.tickerDotEl.className = 'ticker-dot active-other';
        this.tickerLogMsgEl.innerText =
          `[Gemini REST] ${result.reason} (${result.inferenceMs}ms)`;

        this.logDiagnostic(
          'GEMINI REST',
          `Object rejected (${scorePct}% confidence): ${result.reason}`
        );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logDiagnostic('GEMINI ERROR', `Photo analysis failed: ${message}`);
      this.statLivePredictionEl.innerText = 'API Error';
      this.statLivePredictionEl.style.color = '#ef4444';
      this.tickerClassNameEl.innerText = 'Analysis Failed';
      this.tickerLogMsgEl.innerText = `[Error] ${message}`;
    }
  }

  public async armSystem() {
    if (!this.adminAuthenticated) {
      alert('Please log in as administrator first.');
      return;
    }

    if (!geminiVision.hasApiKey()) {
      this.logDiagnostic('GEMINI ERROR', 'Gemini API key is missing.');
      alert('Please configure your Gemini API key in .env.');
      return;
    }

    this.btnArmStageEl.disabled = true;
    this.logDiagnostic('SYSTEM', 'Starting camera and arming sorter...');

    try {
      await wakeLockManager.requestLock();
      await this.startCamera();
      soundEffects.playArmedChime();

      if (firebaseService.getTriggerState()) {
        this.state = 'SCANNING';
        this.updateUIForState('SCANNING');
        this.logDiagnostic('SYSTEM', 'System armed; trigger is already ON.');
        void this.captureAndAnalyzePhotoWorkflow();
      } else {
        this.state = 'STANDBY';
        this.updateUIForState('STANDBY');
        this.logDiagnostic('SYSTEM', 'System armed in standby.');
      }

      this.updateRtdbIndicator();
      this.updatePublicStatus();
      this.startFramePipeline();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logDiagnostic('ERROR', `Failed to arm: ${message}`);
      alert(`Camera access failed: ${message}`);
      this.disarmSystem();
    } finally {
      this.btnArmStageEl.disabled = false;
    }
  }

  public disarmSystem() {
    this.state = 'DISARMED';
    this.lastBottleResult = null;
    soundEffects.playDisarmSound();
    wakeLockManager.releaseLock();

    if (this.currentStream) {
      this.currentStream.getTracks().forEach((track) => track.stop());
      this.currentStream = null;
    }

    this.videoEl.srcObject = null;
    this.hudRenderer.clear();

    if (this.animationFrameId !== null) {
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
    this.updatePublicStatus();
    this.logDiagnostic('SYSTEM', 'System disarmed; camera stopped.');
  }

  private async startCamera() {
    if (this.currentStream) {
      this.currentStream.getTracks().forEach((track) => track.stop());
      this.currentStream = null;
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

    this.logDiagnostic('CAMERA', `Camera running (${this.currentFacingMode}).`);
  }

  private startFramePipeline() {
    const loop = (timestamp: number) => {
      if (this.state === 'DISARMED') {
        this.animationFrameId = null;
        return;
      }

      this.calculateFps(timestamp);

      if (this.videoEl.videoWidth > 0) {
        this.hudRenderer.syncSize(this.videoEl);
      }

      if (this.state === 'SCANNING' || this.state === 'DETECTED') {
        this.hudRenderer.clear();
        this.hudRenderer.drawScanningGuide(!this.hasDetectedForCurrentTrigger);

        const showBanner =
          this.lastBottleResult &&
          performance.now() - this.lastBottleResultAt < 3500;

        this.hudRenderer.renderGeminiVisionHUD(
          showBanner ? this.lastBottleResult : null
        );
      }

      this.animationFrameId = requestAnimationFrame(loop);
    };

    if (this.animationFrameId === null) {
      this.animationFrameId = requestAnimationFrame(loop);
    }
  }

  private onBottleIdentified(result: GeminiVisionResult) {
    const now = performance.now();
    const timeSinceLast = now - this.lastDetectionTime;
    const scorePct = Math.round(result.confidence * 100);

    if (timeSinceLast < APP_CONFIG.cooldownMs) {
      const remainingMs = Math.round(APP_CONFIG.cooldownMs - timeSinceLast);
      console.warn(
        `Bottle detected, but cooldown has ${remainingMs}ms remaining.`
      );
      return;
    }

    this.lastDetectionTime = now;

    this.logDiagnostic(
      'GEMINI DETECTION',
      `Plastic bottle confirmed (${scorePct}%). Recording bottle count.`
    );

    soundEffects.playDetectionChime();

    confetti({
      particleCount: 24,
      spread: 60,
      origin: { y: 0.65 },
      colors: ['#059669', '#10b981', '#38bdf8']
    });

    // Update Firestore using the existing service.
    void firebaseService.recordBottleDetection(result);

    // Display public thank-you message after a confirmed bottle.
    this.showThankYou();

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
      this.statStreamFpsEl.innerText =
        String(Math.round((this.frameCount * 1000) / delta));
      this.frameCount = 0;
      this.lastFpsCalcTime = timestamp;
    }
  }

  private updateUIForState(state: SorterState) {
    this.stateBadgeEl.className = 'state-badge ' + state.toLowerCase();
    this.stateTextEl.innerText = state;

    if (state === 'DISARMED') {
      this.scrollableContainerEl.classList.remove('locked');
      this.adminResetSectionEl.classList.remove('hidden-when-armed');
      this.stageOverlayEl.classList.remove('hidden');
      this.overlayDisarmedContentEl.classList.remove('hidden');
      this.overlayStandbyContentEl.classList.add('hidden');

      this.btnToggleArmLabel.innerText = 'Arm System';
      this.btnToggleArmEl.className = 'btn btn-primary btn-pill';
    } else if (state === 'STANDBY') {
      this.scrollableContainerEl.scrollTo({ top: 0, behavior: 'smooth' });
      this.scrollableContainerEl.classList.add('locked');
      this.adminResetSectionEl.classList.add('hidden-when-armed');
      this.stageOverlayEl.classList.remove('hidden');
      this.overlayDisarmedContentEl.classList.add('hidden');
      this.overlayStandbyContentEl.classList.remove('hidden');

      this.btnToggleArmLabel.innerText = 'Disarm';
      this.btnToggleArmEl.className = 'btn btn-danger btn-pill';
    } else if (state === 'SCANNING' || state === 'DETECTED') {
      this.scrollableContainerEl.scrollTo({ top: 0, behavior: 'smooth' });
      this.scrollableContainerEl.classList.add('locked');
      this.adminResetSectionEl.classList.add('hidden-when-armed');
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
          .then((registration) => {
            console.log('Service Worker registered:', registration.scope);
          })
          .catch((error) => {
            console.warn('Service Worker registration failed:', error);
          });
      });
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new SorterApp();
});