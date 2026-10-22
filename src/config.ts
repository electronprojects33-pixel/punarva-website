
 // AEROSORT AI & GOOGLE GEMINI CONFIGURATION

export const GEMINI_API_KEY =
  import.meta.env.VITE_GEMINI_API_KEY || "YOUR_GEMINI_API_KEY_HERE";

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
  // Firebase Realtime Database trigger
  rtdbTriggerPath:
    import.meta.env.VITE_RTDB_TRIGGER_PATH || "object_detected",

  // Firestore bottle detection records
  firestoreCollection:
    import.meta.env.VITE_FIRESTORE_COLLECTION || "bottle_detections",
  firestoreStatsDoc: "summary",

  // Gemini Vision API
  geminiApiKey: GEMINI_API_KEY,
  geminiModel:
    import.meta.env.VITE_GEMINI_MODEL || "gemini-2.5-flash",

  confidenceThreshold: 0.70,
  cooldownMs: 1500,

  // Camera
  cameraFacingMode: "environment" as "environment" | "user",
  enableAudio: true
};
