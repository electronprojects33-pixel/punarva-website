// ==============================================================================
// AEROMODEL CONFIGURATION
// Credentials are automatically loaded from .env via Vite (import.meta.env)
// ==============================================================================

export const FIREBASE_CONFIG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || ""
};

export const APP_CONFIG = {
  // Firebase Realtime Database attribute to watch (true/false)
  rtdbTriggerPath: import.meta.env.VITE_RTDB_TRIGGER_PATH || "object_detected",

  // Firestore collection & document to record bottles_count
  firestoreCollection: import.meta.env.VITE_FIRESTORE_COLLECTION || "bottle_detections",
  firestoreStatsDoc: "summary", // Document holding bottles_count attribute

  // Model & Teachable Machine Detection Settings
  modelUrl: "/models/model_unquant.tflite", // Your custom Teachable Machine model
  labelsUrl: "/models/labels.txt",          // Your Teachable Machine labels
  confidenceThreshold: 0.65,                // 65% minimum confidence
  cooldownMs: 1200,                         // Debounce interval between count updates

  // Camera Settings
  cameraFacingMode: "environment" as "environment" | "user", // "environment" for rear camera
  enableAudio: true                              // Synthesized audio chime on detection
};
