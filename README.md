# AeroSort AI - Plastic Bottle Classifier PWA
### Edge Teachable Machine TFLite Classifier with Firebase Realtime Sync

A clean, modern, light-themed Progressive Web App built with **TypeScript**, **Vite**, **MediaPipe Tasks Vision** (`ImageClassifier`), and **Firebase Realtime Database & Firestore**.

---

## 🔑 Firebase Configuration (.env)

Add your Firebase project credentials directly in the **[`.env`](file:///c:/Users/Sajadh/Desktop/plastic_sorter/.env)** file:

```env
# Firebase Web SDK Configuration
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://your-project-default-rtdb.firebaseio.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=1234567890
VITE_FIREBASE_APP_ID=1:1234567890:web:abcdef

# Database Paths
VITE_RTDB_TRIGGER_PATH=sorter/trigger_camera
VITE_FIRESTORE_COLLECTION=bottle_detections
```

---

## ⚡ Workflow

1. **User Arms System:** User taps *"Arm Sorter System"* once to grant camera access and activate the **Screen Wake Lock**.
2. **RTDB Trigger (`false` → `true`):** Listens to Firebase Realtime Database path (`sorter/trigger_camera`). When it turns `true`, real-time classification engages immediately.
3. **Edge Inference:** Uses `@mediapipe/tasks-vision`'s WebGPU/WASM `ImageClassifier` to evaluate frames at 30+ FPS (`Plastic_Bottle` vs `Other_Object`).
4. **Non-Blocking Firestore Sync:** When `Plastic_Bottle` exceeds 70% confidence:
   - Zero-latency synthesized chime plays.
   - Emerald "TARGET LOCKED" banner appears.
   - Fire-and-forget asynchronous write logs to Firestore (`bottle_detections`) without dropping video frames.
   - Cooldown window prevents duplicate counts.

---

## 🚀 Running the Project

```bash
npm run dev
```
Open [http://localhost:5173/](http://localhost:5173/) on desktop or on your mobile device via local network (`http://192.168.1.44:5173/`).
