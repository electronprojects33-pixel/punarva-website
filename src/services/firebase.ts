import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { 
  getDatabase, 
  ref, 
  onValue, 
  Unsubscribe,
  Database
} from 'firebase/database';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  serverTimestamp,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  Firestore
} from 'firebase/firestore';
import { FIREBASE_CONFIG, APP_CONFIG } from '../config';
import { BottleDetectionEvent, ClassificationCategory } from '../types';

export class FirebaseService {
  private app: FirebaseApp | null = null;
  private rtdb: Database | null = null;
  private firestore: Firestore | null = null;
  private triggerUnsubscribe: Unsubscribe | null = null;
  private onTriggerCallback: ((triggered: boolean) => void) | null = null;
  private onSyncStatusCallback: ((event: BottleDetectionEvent) => void) | null = null;

  private currentTriggerValue: boolean = false;
  private isConnectedRTDB: boolean = false;
  private isConnectedFirestore: boolean = false;

  public initialize(): { success: boolean; message: string } {
    this.cleanup();

    if (!FIREBASE_CONFIG.apiKey || FIREBASE_CONFIG.apiKey === "YOUR_API_KEY") {
      console.warn('Firebase configuration contains placeholder keys. Please update src/config.ts with your real Firebase keys.');
      return { 
        success: false, 
        message: 'Replace placeholder keys in src/config.ts to connect.' 
      };
    }

    try {
      const existingApps = getApps();
      this.app = existingApps.length > 0 ? existingApps[0] : initializeApp(FIREBASE_CONFIG);

      // Initialize Realtime Database
      this.rtdb = getDatabase(this.app, FIREBASE_CONFIG.databaseURL);
      this.isConnectedRTDB = true;

      // Initialize Firestore with offline persistence
      try {
        this.firestore = initializeFirestore(this.app, {
          localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager()
          })
        });
      } catch (cacheErr) {
        this.firestore = getFirestore(this.app);
      }
      this.isConnectedFirestore = true;

      // Subscribe to Realtime Database trigger
      this.listenToTrigger(APP_CONFIG.rtdbTriggerPath);

      return { success: true, message: 'Connected to Firebase' };
    } catch (err: any) {
      console.error('Firebase initialization error:', err);
      this.isConnectedRTDB = false;
      this.isConnectedFirestore = false;
      return { success: false, message: err.message || 'Firebase initialization failed' };
    }
  }

  public listenToTrigger(path: string) {
    if (this.triggerUnsubscribe) {
      this.triggerUnsubscribe();
      this.triggerUnsubscribe = null;
    }

    if (!this.rtdb) return;

    try {
      const triggerRef = ref(this.rtdb, path);
      this.triggerUnsubscribe = onValue(
        triggerRef, 
        (snapshot) => {
          const val = snapshot.val();
          const isTriggered = val === true || val === 'true' || val === 1;
          this.currentTriggerValue = isTriggered;
          if (this.onTriggerCallback) {
            this.onTriggerCallback(isTriggered);
          }
        }, 
        (error) => {
          console.error('RTDB Trigger listener error:', error);
        }
      );
    } catch (err) {
      console.error('Error attaching RTDB listener:', err);
    }
  }

  // Non-blocking fire-and-forget write to Firestore
  public recordBottleDetection(classification: ClassificationCategory): BottleDetectionEvent {
    const startTime = performance.now();
    const eventId = 'det_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const eventTime = new Date();

    const detectionRecord: BottleDetectionEvent = {
      id: eventId,
      timestamp: Date.now(),
      formattedTime: eventTime.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      category: classification.categoryName,
      confidence: Math.round(classification.score * 100),
      status: this.firestore ? 'PENDING' : 'SYNCED',
      latencyMs: 0
    };

    if (!this.firestore) {
      detectionRecord.latencyMs = Math.round(performance.now() - startTime);
      if (this.onSyncStatusCallback) {
        this.onSyncStatusCallback(detectionRecord);
      }
      return detectionRecord;
    }

    // Fire-and-forget asynchronous write without delaying camera frame processing
    const colRef = collection(this.firestore, APP_CONFIG.firestoreCollection);
    const payload = {
      detectedAt: serverTimestamp(),
      clientTimestamp: Date.now(),
      category: classification.categoryName,
      confidence: classification.score,
      appVersion: '1.0.0-pwa'
    };

    addDoc(colRef, payload)
      .then((docRef) => {
        detectionRecord.status = 'SYNCED';
        detectionRecord.firestoreDocId = docRef.id;
        detectionRecord.latencyMs = Math.round(performance.now() - startTime);
        if (this.onSyncStatusCallback) {
          this.onSyncStatusCallback(detectionRecord);
        }
      })
      .catch((err) => {
        console.error('Firestore non-blocking write error:', err);
        detectionRecord.status = 'FAILED';
        detectionRecord.latencyMs = Math.round(performance.now() - startTime);
        if (this.onSyncStatusCallback) {
          this.onSyncStatusCallback(detectionRecord);
        }
      });

    return detectionRecord;
  }

  public onTriggerChange(cb: (triggered: boolean) => void) {
    this.onTriggerCallback = cb;
  }

  public onSyncStatus(cb: (event: BottleDetectionEvent) => void) {
    this.onSyncStatusCallback = cb;
  }

  public getTriggerState(): boolean {
    return this.currentTriggerValue;
  }

  public isRTDBReady(): boolean {
    return this.isConnectedRTDB;
  }

  public isFirestoreReady(): boolean {
    return this.isConnectedFirestore;
  }

  public cleanup() {
    if (this.triggerUnsubscribe) {
      this.triggerUnsubscribe();
      this.triggerUnsubscribe = null;
    }
    this.isConnectedRTDB = false;
    this.isConnectedFirestore = false;
  }
}

export const firebaseService = new FirebaseService();
