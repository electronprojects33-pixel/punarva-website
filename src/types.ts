export type SorterState = 
  | 'DISARMED'           // Initial state: Camera off, awaiting user activation
  | 'STANDBY'            // Camera armed/pre-warmed, waiting for RTDB trigger = true
  | 'SCANNING'           // RTDB trigger is true: Active inference running on video frames
  | 'DETECTED'           // Bottle detected: visual cue active, Firestore write dispatched
  | 'COOLDOWN'           // Brief interval to prevent duplicate writes for the same object
  | 'ERROR';             // Camera or model initialization failure

export interface BoundingBox {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export interface DetectedBottle {
  category: string;
  score: number;
  boundingBox: BoundingBox;
}

export interface DetectionResult {
  bottles: DetectedBottle[];
  allDetections: DetectedBottle[];
  inferenceMs: number;
}

export interface BottleDetectionEvent {
  id: string;
  timestamp: number;
  formattedTime: string;
  category: string;
  confidence: number;
  count: number;
  status: 'SYNCED' | 'PENDING' | 'FAILED';
  firestoreDocId?: string;
  latencyMs: number;
}

export interface SystemMetrics {
  fps: number;
  inferenceMs: number;
  totalDetected: number;
  wakeLockActive: boolean;
  rtdbConnected: boolean;
  firestoreConnected: boolean;
}
