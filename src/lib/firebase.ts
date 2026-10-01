// The league's Firebase project. These values identify the project to browsers and are meant to
// be public; what anyone can do with them is decided by firestore.rules.
import { initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInAnonymously, type Auth } from "firebase/auth";
import {
  connectFirestoreEmulator, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, type Firestore,
} from "firebase/firestore";

const config = {
  apiKey: "AIzaSyC53kTEHsAh7uWVPdLBY4XKVUgUdK1Y0mw",
  authDomain: "eupa-stats.firebaseapp.com",
  projectId: "eupa-stats",
  storageBucket: "eupa-stats.firebasestorage.app",
  messagingSenderId: "1056256623242",
  appId: "1:1056256623242:web:76bd60956eff966002a373",
};

/** Browser tests and local development run against the Firebase emulators instead. */
const EMULATOR = import.meta.env.VITE_FIREBASE_EMULATOR === "true";

let app: FirebaseApp | undefined, db: Firestore | undefined, auth: Auth | undefined;

export function firebase() {
  if (!app) {
    app = initializeApp(EMULATOR ? { ...config, projectId: "demo-eupa-stats", apiKey: "demo-key" } : config);
    // Firestore keeps its own copy on the device: reads work offline, and writes made offline
    // are queued and sent when a signal returns.
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
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
