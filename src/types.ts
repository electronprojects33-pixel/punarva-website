export type SorterState = 
  | 'DISARMED'           // Initial state: Camera off, awaiting user activation
  | 'STANDBY'            // Camera armed/pre-warmed, waiting for RTDB trigger = true
  | 'SCANNING'           // RTDB trigger is true: Active Gemini Live visual analysis running on frames
  | 'DETECTED'           // Bottle detected: visual cue active, Firestore write dispatched
  | 'COOLDOWN'           // Brief interval to prevent duplicate writes for the same object
  | 'ERROR';             // Camera or API failure

export interface GeminiVisionResult {
  isPlasticBottle: boolean;
  confidence: number; // 0.0 to 1.0
  reason: string;     // Reasoning from Gemini (e.g., "PET water bottle in center", "Hand in motion", "Empty background")
  inferenceMs: number;
  timestamp: number;
}

export interface BottleDetectionEvent {
  id: string;
  timestamp: number;
  formattedTime: string;
  category: string;
  confidence: number;
  reason: string;
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
