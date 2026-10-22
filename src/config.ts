// ==============================================================================
// AEROMODEL & GOOGLE GEMINI CONFIGURATION
// Add your Gemini API key directly in code below or in your .env file
// ==============================================================================

// Paste your Google Gemini API Key here (or use .env: VITE_GEMINI_API_KEY)
export const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || "YOUR_GEMINI_API_KEY_HERE";

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

  // Google Gemini Vision Live Feed Settings (Quota-Aware: max 15 RPM / 500 RPD)
  geminiApiKey: GEMINI_API_KEY,
  geminiModel: import.meta.env.VITE_GEMINI_MODEL || "gemini-3.5-flash-lite",
  confidenceThreshold: 0.70, // 70% minimum confidence
  cooldownMs: 1500,          // Debounce interval between count updates
  feedIntervalMs: 2000,      // Conservative sampling interval (avoids 15 RPM limit)
  maxChecksPerTrigger: 3,    // Limit requests per object_detected event to preserve 500 RPD budget

  // Camera Settings
  cameraFacingMode: "environment" as "environment" | "user", // "environment" for rear camera
  enableAudio: true          // Synthesized audio chime on detection
};
