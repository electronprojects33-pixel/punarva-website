import { FilesetResolver, ImageClassifier } from '@mediapipe/tasks-vision';
import { ClassificationCategory, ClassificationResult } from '../types';

export class PlasticClassifierService {
  private classifier: ImageClassifier | null = null;
  private isInitializing: boolean = false;
  private isInferring: boolean = false;
  private lastInferenceTimeMs: number = 0;
  private labelsMap: Record<number, string> = {
    0: 'Plastic_Bottle',
    1: 'Other_Object'
  };

  public async loadLabels(labelsUrl: string = '/models/labels.txt'): Promise<void> {
    try {
      const response = await fetch(labelsUrl);
      if (response.ok) {
        const text = await response.text();
        const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
        this.labelsMap = {};
        lines.forEach((line, defaultIndex) => {
          // Teachable Machine labels are typically "0 Plastic_Bottle" or just "Plastic_Bottle"
          const parts = line.split(/\s+/);
          if (parts.length > 1 && !isNaN(Number(parts[0]))) {
            const idx = Number(parts[0]);
            this.labelsMap[idx] = parts.slice(1).join('_');
          } else {
            this.labelsMap[defaultIndex] = line.replace(/\s+/g, '_');
          }
        });
        console.log('Loaded class labels:', this.labelsMap);
      }
    } catch (e) {
      console.warn('Could not fetch labels.txt, using default class map:', e);
    }
  }

  public setLabelsFromText(text: string) {
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    this.labelsMap = {};
    lines.forEach((line, defaultIndex) => {
      const parts = line.split(/\s+/);
      if (parts.length > 1 && !isNaN(Number(parts[0]))) {
        const idx = Number(parts[0]);
        this.labelsMap[idx] = parts.slice(1).join('_');
      } else {
        this.labelsMap[defaultIndex] = line.replace(/\s+/g, '_');
      }
    });
    console.log('Updated class labels from text:', this.labelsMap);
  }

  public async initialize(
    modelPath: string = '/models/model_unquant.tflite',
    labelsPath: string = '/models/labels.txt'
  ): Promise<{ success: boolean; message: string }> {
    if (this.isInitializing) {
      return { success: false, message: 'Classifier is already initializing' };
    }

    this.isInitializing = true;
    await this.loadLabels(labelsPath);

    try {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );

      // Try GPU acceleration first
      try {
        this.classifier = await ImageClassifier.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: modelPath,
            delegate: 'GPU'
          },
          runningMode: 'VIDEO',
          maxResults: 4
        });
        console.log('Teachable Machine ImageClassifier initialized with GPU delegate');
      } catch (gpuErr) {
        console.warn('GPU delegate unavailable, falling back to CPU/WASM delegate:', gpuErr);
        this.classifier = await ImageClassifier.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: modelPath,
            delegate: 'CPU'
          },
          runningMode: 'VIDEO',
          maxResults: 4
        });
        console.log('Teachable Machine ImageClassifier initialized with CPU/WASM');
      }

      this.isInitializing = false;
      return { success: true, message: 'Image Classifier model loaded successfully' };
    } catch (err: any) {
      this.isInitializing = false;
      console.error('Failed to initialize ImageClassifier:', err);
      return { 
        success: false, 
        message: err.message || 'Model load failed. Ensure model_unquant.tflite is in public/models/.' 
      };
    }
  }

  // Runs classification on the current video frame without blocking UI
  public classifyFrame(
    video: HTMLVideoElement,
    timestampMs: number
  ): ClassificationResult | null {
    if (!this.classifier || this.isInferring || video.readyState < 2) {
      return null;
    }

    this.isInferring = true;
    const start = performance.now();

    try {
      const result = this.classifier.classifyForVideo(video, timestampMs);
      this.lastInferenceTimeMs = Math.round(performance.now() - start);

      const parsedCategories: ClassificationCategory[] = [];

      if (result && result.classifications && result.classifications.length > 0) {
        const topCategories = result.classifications[0].categories;
        for (const cat of topCategories) {
          const mappedName = (cat.categoryName && cat.categoryName.trim().length > 0)
            ? cat.categoryName
            : (this.labelsMap[cat.index] || `Class_${cat.index}`);

          parsedCategories.push({
            index: cat.index,
            score: cat.score,
            categoryName: mappedName
          });
        }
      }

      // Sort descending by score
      parsedCategories.sort((a, b) => b.score - a.score);

      const topCategory = parsedCategories.length > 0
        ? parsedCategories[0]
        : { index: -1, score: 0, categoryName: 'Unknown' };

      this.isInferring = false;
      return {
        categories: parsedCategories,
        topCategory,
        inferenceMs: this.lastInferenceTimeMs
      };
    } catch (err) {
      console.error('Error during video classification:', err);
      this.isInferring = false;
      return null;
    }
  }

  public isReady(): boolean {
    return this.classifier !== null;
  }

  public getInferenceLatency(): number {
    return this.lastInferenceTimeMs;
  }

  public getLabels(): Record<number, string> {
    return this.labelsMap;
  }

  public cleanup() {
    if (this.classifier) {
      try {
        this.classifier.close();
      } catch (e) {
        console.warn('Error closing classifier:', e);
      }
      this.classifier = null;
    }
  }
}

export const plasticClassifier = new PlasticClassifierService();
