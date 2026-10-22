import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { 
  getDatabase, 
  ref, 
  onValue, 
  set,
  Unsubscribe,
  Database
} from 'firebase/database';
import { 
  getFirestore, 
  doc, 
  setDoc, 
  increment,
  serverTimestamp,
  onSnapshot,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  Firestore
} from 'firebase/firestore';
import { FIREBASE_CONFIG, APP_CONFIG } from '../config';
import { BottleDetectionEvent, DetectedBottle } from '../types';

export class FirebaseService {
  private app: FirebaseApp | null = null;
  private rtdb: Database | null = null;
  private firestore: Firestore | null = null;
  private triggerUnsubscribe: Unsubscribe | null = null;
  private countUnsubscribe: (() => void) | null = null;
  private onTriggerCallback: ((triggered: boolean) => void) | null = null;

  private currentTriggerValue: boolean = false;
  private isConnectedRTDB: boolean = false;
  private isConnectedFirestore: boolean = false;

  public initialize(): { success: boolean; message: string } {
    this.cleanup();

    if (!FIREBASE_CONFIG.apiKey || FIREBASE_CONFIG.apiKey === "YOUR_API_KEY") {
      console.warn('Firebase configuration contains placeholder keys. Please update .env or src/config.ts with your real Firebase keys.');
      return { 
        success: false, 
        message: 'Replace placeholder keys in .env to connect.' 
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

      // Subscribe to Realtime Database trigger attribute (e.g. "object_detected")
      this.listenToTrigger(APP_CONFIG.rtdbTriggerPath);

      return { success: true, message: 'Connected to Firebase' };
    } catch (err: any) {
      console.error('Firebase initialization error:', err);
      this.isConnectedRTDB = false;
      this.isConnectedFirestore = false;
      return { success: false, message: err.message || 'Firebase initialization failed' };
    }
  }

  // Listens to trigger attribute. If it does not exist, defaults it to false in RTDB
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
          
          // If attribute does not exist in RTDB, create it defaulted to false
          if (val === null) {
            console.log(`Attribute "${path}" not found in RTDB. Initializing default to false.`);
            set(triggerRef, false).catch((err) => console.warn('Could not auto-default RTDB attribute:', err));
            this.currentTriggerValue = false;
            if (this.onTriggerCallback) {
              this.onTriggerCallback(false);
            }
            return;
          }

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

  // Toggles or sets object_detected value directly in Realtime Database
  public async setTriggerValue(val: boolean): Promise<void> {
    this.currentTriggerValue = val;
    if (this.rtdb) {
      try {
        const triggerRef = ref(this.rtdb, APP_CONFIG.rtdbTriggerPath);
        await set(triggerRef, val);
      } catch (e) {
        console.error('Failed to set RTDB value:', e);
      }
    }
  }

  // Non-blocking fire-and-forget write to Firestore: updates bottles_count
  public recordBottleDetection(bottles: DetectedBottle[]): BottleDetectionEvent {
    const startTime = performance.now();
    const eventId = 'det_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const eventTime = new Date();
    const countToAdd = Math.max(1, bottles.length);
    const topScore = bottles.length > 0 ? Math.round(bottles[0].score * 100) : 0;

    const detectionRecord: BottleDetectionEvent = {
      id: eventId,
      timestamp: Date.now(),
      formattedTime: eventTime.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      category: 'plastic_bottle',
      confidence: topScore,
      count: countToAdd,
      status: this.firestore ? 'SYNCED' : 'PENDING',
      latencyMs: 0
    };

    if (!this.firestore) {
      detectionRecord.latencyMs = Math.round(performance.now() - startTime);
      return detectionRecord;
    }

    // Atomically increment bottles_count in Firestore summary document
    const statsDocRef = doc(this.firestore, APP_CONFIG.firestoreCollection, APP_CONFIG.firestoreStatsDoc);
    setDoc(statsDocRef, {
      bottles_count: increment(countToAdd),
      last_detected_at: serverTimestamp(),
      last_count_detected: countToAdd,
      last_confidence: topScore
    }, { merge: true })
      .then(() => {
        detectionRecord.latencyMs = Math.round(performance.now() - startTime);
      })
      .catch((err) => {
        console.error('Firestore bottles_count update error:', err);
      });

    return detectionRecord;
  }

  // Resets bottles_count attribute in Firestore to 0
  public async resetBottleCount(): Promise<boolean> {
    if (!this.firestore) return false;
    try {
      const statsDocRef = doc(this.firestore, APP_CONFIG.firestoreCollection, APP_CONFIG.firestoreStatsDoc);
      await setDoc(statsDocRef, {
        bottles_count: 0,
        last_reset_at: serverTimestamp()
      }, { merge: true });
      console.log('bottles_count successfully reset to 0 in Firestore');
      return true;
    } catch (e) {
      console.error('Failed to reset bottles_count in Firestore:', e);
      return false;
    }
  }

  // Subscribes to real-time bottles_count changes from Firestore
  public listenToBottleCount(cb: (count: number) => void) {
    if (this.countUnsubscribe) {
      this.countUnsubscribe();
      this.countUnsubscribe = null;
    }

    if (!this.firestore) return;

    try {
      const statsDocRef = doc(this.firestore, APP_CONFIG.firestoreCollection, APP_CONFIG.firestoreStatsDoc);
      this.countUnsubscribe = onSnapshot(statsDocRef, (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          if (typeof data.bottles_count === 'number') {
            cb(data.bottles_count);
          }
        }
      }, (err) => {
        console.warn('Snapshot listener error on stats doc:', err);
      });
    } catch (err) {
      console.warn('Could not attach Firestore count listener:', err);
    }
  }

  public onTriggerChange(cb: (triggered: boolean) => void) {
    this.onTriggerCallback = cb;
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
    if (this.countUnsubscribe) {
      this.countUnsubscribe();
      this.countUnsubscribe = null;
    }
    this.isConnectedRTDB = false;
    this.isConnectedFirestore = false;
  }
}

export const firebaseService = new FirebaseService();
