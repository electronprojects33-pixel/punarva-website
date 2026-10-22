import { APP_CONFIG } from '../config';
import { GeminiVisionResult } from '../types';

export class GeminiLiveVisionService {
  private apiKey: string = APP_CONFIG.geminiApiKey;
  private modelName: string = APP_CONFIG.geminiModel;
  private offscreenCanvas: HTMLCanvasElement;
  private offscreenCtx: CanvasRenderingContext2D | null;
  private isAnalyzing: boolean = false;
  private lastInferenceMs: number = 0;

  constructor() {
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCanvas.width = 480;
    this.offscreenCanvas.height = 360;
    this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });
  }

  public setApiKey(key: string) {
    this.apiKey = key.trim();
    localStorage.setItem('gemini_api_key', this.apiKey);
    console.log('🔑 [GEMINI] API Key updated and stored.');
  }

  public getApiKey(): string {
    return this.apiKey || localStorage.getItem('gemini_api_key') || '';
  }

  public isReady(): boolean {
    const key = this.getApiKey();
    return typeof key === 'string' && key.trim().length > 10;
  }

  public getInferenceLatency(): number {
    return this.lastInferenceMs;
  }

  // Captures current video frame into a lightweight base64 JPEG
  public captureFrameBase64(video: HTMLVideoElement): string | null {
    if (!this.offscreenCtx || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      return null;
    }

    const targetW = 480;
    const targetH = Math.round((video.videoHeight / video.videoWidth) * targetW) || 360;

    if (this.offscreenCanvas.width !== targetW || this.offscreenCanvas.height !== targetH) {
      this.offscreenCanvas.width = targetW;
      this.offscreenCanvas.height = targetH;
    }

    this.offscreenCtx.drawImage(video, 0, 0, targetW, targetH);
    const dataUrl = this.offscreenCanvas.toDataURL('image/jpeg', 0.65);
    const base64Index = dataUrl.indexOf(',');
    return base64Index !== -1 ? dataUrl.substring(base64Index + 1) : null;
  }

  // Analyzes live visual feed frame using Google Gemini Vision
  public async analyzeFrame(video: HTMLVideoElement): Promise<GeminiVisionResult | null> {
    if (this.isAnalyzing || !this.isReady()) {
      return null;
    }

    const base64Image = this.captureFrameBase64(video);
    if (!base64Image) {
      return null;
    }

    this.isAnalyzing = true;
    const startTime = performance.now();
    const activeKey = this.getApiKey();

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${activeKey}`;

    const promptText = `
You are an expert optical sorting machine vision AI.
Inspect this live camera frame carefully.
Task: Detect if there is a real PLASTIC BOTTLE present (water bottle, soda bottle, detergent bottle, etc.).
Strict Rules:
- If you see a plastic bottle: set is_plastic_bottle = true, assign confidence (0.0 to 1.0), and describe it.
- If it is a hand, motion blur, glare, empty table, can, glass bottle, paper, or clothing: set is_plastic_bottle = false, and describe what is actually in frame.
- Do NOT trigger on hands or blurred backgrounds.
Respond with JSON strictly following this schema:
{
  "is_plastic_bottle": boolean,
  "confidence": number,
  "reason": string
}
`.trim();

    const requestBody = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              inline_data: {
                mime_type: 'image/jpeg',
                data: base64Image
              }
            },
            {
              text: promptText
            }
          ]
        }
      ],
      generationConfig: {
        response_mime_type: 'application/json',
        temperature: 0.1
      }
    };

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      this.lastInferenceMs = Math.round(performance.now() - startTime);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData?.error?.message || `HTTP ${response.status} ${response.statusText}`;
        console.error('❌ [GEMINI VISION ERROR]:', errorMsg);
        this.isAnalyzing = false;
        return {
          isPlasticBottle: false,
          confidence: 0,
          reason: `API Error: ${errorMsg}`,
          inferenceMs: this.lastInferenceMs,
          timestamp: Date.now()
        };
      }

      const data = await response.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!rawText) {
        this.isAnalyzing = false;
        return null;
      }

      let parsed: { is_plastic_bottle?: boolean; confidence?: number; reason?: string } = {};
      try {
        parsed = JSON.parse(rawText.trim());
      } catch (parseErr) {
        console.warn('⚠️ [GEMINI] Failed to parse JSON response:', rawText);
        parsed = {
          is_plastic_bottle: rawText.toLowerCase().includes('"is_plastic_bottle": true'),
          confidence: 0.5,
          reason: rawText
        };
      }

      const isPlasticBottle = Boolean(parsed.is_plastic_bottle);
      const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : (isPlasticBottle ? 0.9 : 0.1);
      const reason = parsed.reason || (isPlasticBottle ? 'Plastic bottle detected' : 'No bottle identified');

      this.isAnalyzing = false;
      return {
        isPlasticBottle,
        confidence,
        reason,
        inferenceMs: this.lastInferenceMs,
        timestamp: Date.now()
      };
    } catch (err: any) {
      this.lastInferenceMs = Math.round(performance.now() - startTime);
      this.isAnalyzing = false;
      console.error('❌ [GEMINI NETWORK ERROR]:', err);
      return null;
    }
  }
}

export const geminiVision = new GeminiLiveVisionService();
