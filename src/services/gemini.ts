import { APP_CONFIG } from '../config';
import { GeminiVisionResult } from '../types';

const WS_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

const SYSTEM_PROMPT = `
You are the vision sensor of a plastic bottle counting machine, watching a live camera feed.
When you are asked to check the camera, look at the most recent video frames.
- If a real PLASTIC BOTTLE (water, soda, juice, detergent bottle, etc.) is clearly visible, call the function report_plastic_bottle exactly once.
- Hands, motion blur, glare, empty background, cans, glass bottles, paper, cups or dark/black frames are NOT plastic bottles.
- If there is no plastic bottle, answer with the single word "no". Never describe the scene.
`.trim();

const CHECK_PROMPT =
  'Check the camera now. If a plastic bottle is clearly visible call report_plastic_bottle, otherwise say "no".';

type Listener<T> = (payload: T) => void;

/**
 * Google Gemini Live API client (WebSocket / BidiGenerateContent).
 * Streams camera frames as realtime video input and listens for a
 * `report_plastic_bottle` tool call from the model.
 */
export class GeminiLiveVisionService {
  private ws: WebSocket | null = null;
  private ready: boolean = false;
  private connecting: Promise<void> | null = null;
  private offscreenCanvas: HTMLCanvasElement;
  private offscreenCtx: CanvasRenderingContext2D | null;
  private turnStartedAt: number = 0;
  private toolCalledInTurn: boolean = false;
  private awaitingTurn: boolean = false;
  private lastInferenceMs: number = 0;

  public onDetection: Listener<GeminiVisionResult> | null = null;
  public onNoBottle: Listener<GeminiVisionResult> | null = null;
  public onStatus: Listener<string> | null = null;
  public onClose: Listener<string> | null = null;

  constructor() {
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });
  }

  public getApiKey(): string {
    return (APP_CONFIG.geminiApiKey || '').trim();
  }

  public hasApiKey(): boolean {
    const key = this.getApiKey();
    return key.length > 10 && !key.includes('YOUR_GEMINI_API_KEY');
  }

  public isConnected(): boolean {
    return this.ready && !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  public isBusy(): boolean {
    if (this.awaitingTurn && performance.now() - this.turnStartedAt > 10000) {
      console.warn('⚠️ [GEMINI LIVE] Turn timed out, releasing.');
      this.awaitingTurn = false;
    }
    return this.awaitingTurn;
  }

  public getInferenceLatency(): number {
    return this.lastInferenceMs;
  }

  // Opens the Live API WebSocket session and resolves once setupComplete is received
  public connect(): Promise<void> {
    if (this.isConnected()) return Promise.resolve();
    if (this.connecting) return this.connecting;

    this.connecting = new Promise<void>((resolve, reject) => {
      const model = APP_CONFIG.geminiModel;
      console.log(`🔌 [GEMINI LIVE] Connecting WebSocket (model: ${model})...`);

      const ws = new WebSocket(`${WS_URL}?key=${this.getApiKey()}`);
      this.ws = ws;
      let settled = false;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            setup: {
              model: `models/${model}`,
              generationConfig: { responseModalities: ['AUDIO'] },
              contextWindowCompression: { slidingWindow: {} },
              systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
              tools: [
                {
                  functionDeclarations: [
                    {
                      name: 'report_plastic_bottle',
                      description: 'Call when a real plastic bottle is clearly visible in the camera feed.',
                      parameters: {
                        type: 'OBJECT',
                        properties: {
                          confidence: { type: 'NUMBER', description: 'Confidence between 0.0 and 1.0' },
                          reason: { type: 'STRING', description: 'Very short description of the bottle seen' }
                        },
                        required: ['confidence']
                      }
                    }
                  ]
                }
              ]
            }
          })
        );
      };

      ws.onmessage = async (event) => {
        let raw: string;
        try {
          raw = typeof event.data === 'string' ? event.data : await (event.data as Blob).text();
        } catch {
          return;
        }

        let msg: any;
        try {
          msg = JSON.parse(raw);
        } catch {
          return;
        }

        if (msg.setupComplete) {
          this.ready = true;
          this.connecting = null;
          console.log('✅ [GEMINI LIVE] Session ready');
          this.onStatus?.('Gemini Live connected');
          if (!settled) {
            settled = true;
            resolve();
          }
          return;
        }

        if (msg.toolCall?.functionCalls) {
          for (const call of msg.toolCall.functionCalls) {
            if (call.name === 'report_plastic_bottle') {
              this.toolCalledInTurn = true;
              const confidence =
                typeof call.args?.confidence === 'number' ? call.args.confidence : 0.9;
              const reason: string = call.args?.reason || 'Plastic bottle detected';
              const result = this.buildResult(true, confidence, reason);
              console.log('🍾 [GEMINI LIVE] Tool call report_plastic_bottle', call.args);
              this.onDetection?.(result);
            }
          }
          // Acknowledge tool calls so the model can continue
          this.send({
            toolResponse: {
              functionResponses: msg.toolCall.functionCalls.map((c: any) => ({
                id: c.id,
                name: c.name,
                response: { result: 'recorded' }
              }))
            }
          });
          return;
        }

        if (msg.serverContent?.turnComplete) {
          if (this.awaitingTurn && !this.toolCalledInTurn) {
            const result = this.buildResult(false, 0, 'No plastic bottle in view');
            console.log(`👁️ [GEMINI LIVE] No bottle (${result.inferenceMs}ms)`);
            this.onNoBottle?.(result);
          }
          this.awaitingTurn = false;
          this.toolCalledInTurn = false;
        }
      };

      ws.onerror = () => {
        console.error('❌ [GEMINI LIVE] WebSocket error');
        if (!settled) {
          settled = true;
          this.connecting = null;
          reject(new Error('WebSocket connection failed'));
        }
      };

      ws.onclose = (event) => {
        const reason = `Gemini Live closed (${event.code}) ${event.reason || ''}`.trim();
        console.warn(`🔌 [GEMINI LIVE] ${reason}`);
        this.ready = false;
        this.awaitingTurn = false;
        this.connecting = null;
        if (this.ws === ws) this.ws = null;
        if (!settled) {
          settled = true;
          reject(new Error(reason));
        }
        this.onClose?.(reason);
      };
    });

    return this.connecting;
  }

  public disconnect() {
    if (this.ws) {
      this.ws.onclose = null;
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
    }
    this.ws = null;
    this.ready = false;
    this.connecting = null;
    this.awaitingTurn = false;
    this.toolCalledInTurn = false;
  }

  // Captures a frame, streams it as realtime video. Returns average brightness (0-255) or -1 if no frame.
  public sendFrame(video: HTMLVideoElement): number {
    if (!this.isConnected() || !this.offscreenCtx) return -1;
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return -1;

    const targetW = 480;
    const targetH = Math.round((video.videoHeight / video.videoWidth) * targetW) || 360;
    if (this.offscreenCanvas.width !== targetW || this.offscreenCanvas.height !== targetH) {
      this.offscreenCanvas.width = targetW;
      this.offscreenCanvas.height = targetH;
    }

    this.offscreenCtx.drawImage(video, 0, 0, targetW, targetH);

    // Brightness check: skip black / not-yet-exposed camera frames
    const sample = this.offscreenCtx.getImageData(0, 0, targetW, targetH).data;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < sample.length; i += 64) {
      sum += (sample[i] + sample[i + 1] + sample[i + 2]) / 3;
      count++;
    }
    const brightness = count ? sum / count : 0;
    if (brightness < 8) return brightness;

    const dataUrl = this.offscreenCanvas.toDataURL('image/jpeg', 0.7);
    const comma = dataUrl.indexOf(',');
    if (comma === -1) return brightness;

    this.send({
      realtimeInput: { video: { data: dataUrl.substring(comma + 1), mimeType: 'image/jpeg' } }
    });
    return brightness;
  }

  // Asks the model to evaluate the most recent frames
  public requestCheck() {
    if (!this.isConnected() || this.awaitingTurn) return;
    this.awaitingTurn = true;
    this.toolCalledInTurn = false;
    this.turnStartedAt = performance.now();
    this.send({ realtimeInput: { text: CHECK_PROMPT } });
  }

  private buildResult(isPlasticBottle: boolean, confidence: number, reason: string): GeminiVisionResult {
    this.lastInferenceMs = Math.round(performance.now() - this.turnStartedAt);
    return {
      isPlasticBottle,
      confidence,
      reason,
      inferenceMs: this.lastInferenceMs,
      timestamp: Date.now()
    };
  }

  private send(payload: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }
}

export const geminiVision = new GeminiLiveVisionService();
