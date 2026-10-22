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
  // Firebase Realtime Database path to watch (true/false)
  rtdbTriggerPath: import.meta.env.VITE_RTDB_TRIGGER_PATH || "sorter/trigger_camera",

  // Firestore collection to record bottle detection logs
  firestoreCollection: import.meta.env.VITE_FIRESTORE_COLLECTION || "bottle_detections",

  // Model & Classification Settings
  modelUrl: "/models/model_unquant.tflite",
  labelsUrl: "/models/labels.txt",
  targetClassName: "Plastic_Bottle", // Primary class to trigger bottle sort
  confidenceThreshold: 0.70,        // 70% confidence threshold
  cooldownMs: 1500,                  // 1.5s debounce between bottle counts

  // Camera Settings
  cameraFacingMode: "environment" as "environment" | "user", // "environment" for rear camera
  enableAudio: true                  // Synthesized audio chime on detection
};
