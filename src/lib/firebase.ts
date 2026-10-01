// The league's Firebase project, for the browser.
import { initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInAnonymously, type Auth } from "firebase/auth";
import {
  connectFirestoreEmulator, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, type Firestore,
} from "firebase/firestore";
import { config } from "./firebaseConfig";

/** Browser tests and local development run against the Firebase emulators instead. */
const EMULATOR = import.meta.env.VITE_FIREBASE_EMULATOR === "true";

let app: FirebaseApp | undefined, db: Firestore | undefined, auth: Auth | undefined;

export function firebase() {
  if (!app) {
    app = initializeApp(EMULATOR ? { ...config, projectId: "demo-eupa-stats", apiKey: "demo-key" } : config);
    // Firestore keeps its own copy on the device: reads work offline, and writes made offline
    // are queued and sent when a signal returns.
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      ignoreUndefinedProperties: true,   // a season's optional fields are often undefined
    });
    auth = getAuth(app);
    if (EMULATOR) {
      connectFirestoreEmulator(db, "127.0.0.1", 8085);
      connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    }
  }
  return { app: app!, db: db!, auth: auth! };
}

/** Every visitor gets an invisible anonymous identity, which is what a device's unlock is tied to. */
export async function deviceId(): Promise<string> {
  const { auth } = firebase();
  await auth.authStateReady();
  if (auth.currentUser) return auth.currentUser.uid;
  return (await signInAnonymously(auth)).user.uid;
}
