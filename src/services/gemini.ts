import { APP_CONFIG } from '../config';
import { GeminiVisionResult } from '../types';

const REST_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

const DETECTION_PROMPT = `
You are the vision sensor for an automated plastic bottle sorting machine.
Examine this photo captured by the sorting camera.
Determine whether a PLASTIC BOTTLE is present and clearly visible.

Guidelines:
- Plastic bottles include clear or colored PET water bottles, soda bottles, juice bottles, detergent/shampoo bottles, oil bottles, etc. (with or without caps/labels, crushed or intact).
- NOT plastic bottles: empty background/conveyor, human hands, fingers, skin, metal cans, glass bottles, cups, cartons, paper, packaging, clothes, shadows, or blurry non-bottle items.
- If unsure or no bottle is clearly seen, set is_plastic_bottle to false.

Respond ONLY with a valid JSON object matching this schema:
{
  "is_plastic_bottle": boolean,
  "confidence": number,
  "reason": string
}
`.trim();

/**
 * Google Gemini Vision REST API client.
 * Captures photos from the camera and sends them to Gemini generateContent.
 */
export class GeminiVisionService {
  private offscreenCanvas: HTMLCanvasElement;
  private offscreenCtx: CanvasRenderingContext2D | null;
  private isBusyState: boolean = false;
  private lastInferenceMs: number = 0;

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

  public isBusy(): boolean {
    return this.isBusyState;
  }

  public getInferenceLatency(): number {
    return this.lastInferenceMs;
  }

  /**
   * Captures a photo from the HTMLVideoElement.
   * Checks average frame brightness to prevent sending black/unexposed frames.
   * If the frame is too dark, retries with short delays up to maxRetries.
   */
  public async capturePhoto(
    video: HTMLVideoElement,
    maxRetries: number = 3
  ): Promise<{ base64Data: string; brightness: number }> {
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      throw new Error('Camera video stream is not ready for capture');
    }

    const targetW = 640;
    const targetH = Math.round((video.videoHeight / video.videoWidth) * targetW) || 480;

    if (this.offscreenCanvas.width !== targetW || this.offscreenCanvas.height !== targetH) {
      this.offscreenCanvas.width = targetW;
      this.offscreenCanvas.height = targetH;
    }

    if (!this.offscreenCtx) {
      throw new Error('Canvas 2D context not available');
    }

    let brightness = 0;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      this.offscreenCtx.drawImage(video, 0, 0, targetW, targetH);
      const imgData = this.offscreenCtx.getImageData(0, 0, targetW, targetH).data;

      let sum = 0;
      let count = 0;
      for (let i = 0; i < imgData.length; i += 64) {
        sum += (imgData[i] + imgData[i + 1] + imgData[i + 2]) / 3;
        count++;
      }
      brightness = count ? sum / count : 0;

      // If brightness is reasonable (> 12) or last attempt, accept
      if (brightness >= 12 || attempt === maxRetries) {
        break;
      }
      // Wait briefly for camera sensor auto-exposure to adjust
      await new Promise((r) => setTimeout(r, 200));
    }

    const dataUrl = this.offscreenCanvas.toDataURL('image/jpeg', 0.85);
    const comma = dataUrl.indexOf(',');
    const base64Data = comma !== -1 ? dataUrl.substring(comma + 1) : dataUrl;

    return { base64Data, brightness };
  }

  /**
   * Captures photo from camera video element and sends to Gemini REST API generateContent.
   */
  public async analyzePhoto(video: HTMLVideoElement): Promise<GeminiVisionResult> {
    const key = this.getApiKey();
    if (!key) {
      throw new Error('Gemini API key is not configured');
    }

    this.isBusyState = true;
    const startTime = performance.now();

    try {
      // 1. Capture the photo
      const { base64Data, brightness } = await this.capturePhoto(video);
      console.log(
        `📸 [GEMINI REST] Photo captured (${this.offscreenCanvas.width}x${this.offscreenCanvas.height}, avg brightness: ${Math.round(brightness)})`
      );

      // 2. Call Gemini REST API generateContent
      const model = APP_CONFIG.geminiModel;
      const url = `${REST_BASE_URL}/${model}:generateContent?key=${key}`;

      const payload = {
        contents: [
          {
            parts: [
              { text: DETECTION_PROMPT },
              {
                inline_data: {
                  mime_type: 'image/jpeg',
                  data: base64Data
                }
              }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: 'application/json'
        }
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error('❌ [GEMINI REST] API error response:', res.status, errorText);
        throw new Error(`Gemini API returned ${res.status}: ${errorText}`);
      }

      const json = await res.json();
      const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!rawText) {
        throw new Error('Empty response received from Gemini REST API');
      }

      let parsed: { is_plastic_bottle?: boolean; confidence?: number; reason?: string } = {};
      try {
        parsed = JSON.parse(rawText);
      } catch {
        console.warn('⚠️ [GEMINI REST] JSON parse fallback on raw output:', rawText);
        const isBottleMatch = rawText.match(/"is_plastic_bottle"\s*:\s*(true|false)/i);
        parsed = {
          is_plastic_bottle: isBottleMatch ? isBottleMatch[1].toLowerCase() === 'true' : false,
          confidence: 0.8,
          reason: rawText.substring(0, 60)
        };
      }

      this.lastInferenceMs = Math.round(performance.now() - startTime);

      const result: GeminiVisionResult = {
        isPlasticBottle: Boolean(parsed.is_plastic_bottle),
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : (parsed.is_plastic_bottle ? 0.9 : 0.1),
        reason: parsed.reason || (parsed.is_plastic_bottle ? 'Plastic bottle identified' : 'No plastic bottle detected'),
        inferenceMs: this.lastInferenceMs,
        timestamp: Date.now()
      };

      console.log(`🤖 [GEMINI REST] Result in ${result.inferenceMs}ms:`, result);
      return result;
    } finally {
      this.isBusyState = false;
    }
  }
}

export const geminiVision = new GeminiVisionService();
