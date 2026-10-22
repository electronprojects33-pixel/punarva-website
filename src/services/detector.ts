import { FilesetResolver, ImageClassifier } from '@mediapipe/tasks-vision';
import { APP_CONFIG } from '../config';
import { DetectedBottle, DetectionResult } from '../types';
import { objectLocalizer } from './localizer';

export class TeachableMachineDetectorService {
  private classifier: ImageClassifier | null = null;
  private isInitializing: boolean = false;
  private isInferring: boolean = false;
  private lastInferenceTimeMs: number = 0;
  private labelsMap: Record<number, string> = {
    0: 'Plastic_Bottle',
    1: 'Other_Object'
  };

  public async loadLabels(labelsUrl: string = APP_CONFIG.labelsUrl): Promise<void> {
    try {
      const response = await fetch(labelsUrl);
      if (response.ok) {
        const text = await response.text();
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
        console.log('Loaded class labels for Teachable Machine:', this.labelsMap);
      }
    } catch (e) {
      console.warn('Could not fetch labels.txt, using default map:', e);
    }
  }

  public async initialize(
    modelPath: string = APP_CONFIG.modelUrl,
    labelsPath: string = APP_CONFIG.labelsUrl
  ): Promise<{ success: boolean; message: string }> {
    if (this.isInitializing) {
      return { success: false, message: 'Detector is already initializing' };
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
          maxResults: 2
        });
        console.log('Teachable Machine Classifier initialized with GPU acceleration');
      } catch (gpuErr) {
        console.warn('GPU delegate unavailable, falling back to CPU/WASM:', gpuErr);
        this.classifier = await ImageClassifier.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: modelPath,
            delegate: 'CPU'
          },
          runningMode: 'VIDEO',
          maxResults: 2
        });
        console.log('Teachable Machine Classifier initialized with CPU/WASM');
      }

      this.isInitializing = false;
      return { success: true, message: 'Teachable Machine model loaded successfully' };
    } catch (err: any) {
      this.isInitializing = false;
      console.error('Failed to initialize Teachable Machine Classifier:', err);
      return { 
        success: false, 
        message: err.message || 'Model load failed.' 
      };
    }
  }

  // Classifies frame with Teachable Machine AND calculates real dynamic bounding boxes!
  public detectFrame(
    video: HTMLVideoElement,
    timestampMs: number
  ): DetectionResult | null {
    if (!this.classifier || this.isInferring || video.readyState < 2) {
      return null;
    }

    this.isInferring = true;
    const start = performance.now();

    try {
      const result = this.classifier.classifyForVideo(video, timestampMs);
      this.lastInferenceTimeMs = Math.round(performance.now() - start);

      const bottleDetections: DetectedBottle[] = [];
      const allDetections: DetectedBottle[] = [];

      if (result && result.classifications && result.classifications.length > 0) {
        const topCategories = result.classifications[0].categories;
        
        // Find Plastic_Bottle prediction from Teachable Machine
        let bottleCategory = topCategories.find((cat) => {
          const name = (cat.categoryName && cat.categoryName.trim().length > 0)
            ? cat.categoryName
            : (this.labelsMap[cat.index] || `Class_${cat.index}`);
          return name.toLowerCase().includes('bottle') || name.toLowerCase().includes('plastic');
        });

        // Fallback: check index 0
        if (!bottleCategory && topCategories.length > 0) {
          const top = topCategories[0];
          const mappedName = this.labelsMap[top.index] || '';
          if (mappedName.toLowerCase().includes('bottle') || top.index === 0) {
            bottleCategory = top;
          }
        }

        const score = bottleCategory ? bottleCategory.score : 0;
        const isBottle = score >= APP_CONFIG.confidenceThreshold;

        // When Teachable Machine confirms a Plastic Bottle is in view:
        // Use smart visual localization to generate real dynamic bounding boxes!
        if (isBottle) {
          const candidateBoxes = objectLocalizer.findObjectBoxes(video);
          
          for (const box of candidateBoxes) {
            const detectedItem: DetectedBottle = {
              category: 'Plastic_Bottle',
              score: score,
              boundingBox: box
            };
            bottleDetections.push(detectedItem);
            allDetections.push(detectedItem);
          }
        }
      }

      this.isInferring = false;
      return {
        bottles: bottleDetections,
        allDetections,
        inferenceMs: this.lastInferenceTimeMs
      };
    } catch (err) {
      console.error('Error during video detection:', err);
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

export const plasticDetector = new TeachableMachineDetectorService();
