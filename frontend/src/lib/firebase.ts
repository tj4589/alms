import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  type Auth,
} from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const missingConfigKeys = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

export const firebaseConfigured = missingConfigKeys.length === 0;
export const firebaseConfigError = firebaseConfigured
  ? ''
  : `Firebase Authentication is not configured. Add the VITE_FIREBASE_* values (${missingConfigKeys.join(', ')}).`;

const firebaseApp = firebaseConfigured
  ? (getApps().length > 0 ? getApp() : initializeApp(firebaseConfig))
  : null;

export const firebaseAuth: Auth | null = firebaseApp ? getAuth(firebaseApp) : null;

export const googleProvider: GoogleAuthProvider | null = firebaseConfigured
  ? (() => {
      const provider = new GoogleAuthProvider();
      provider.addScope('email');
      provider.addScope('profile');
      // This is a UX hint only. The API validates the signed Google `hd`
      // claim for both allowed Covenant University domains.
      provider.setCustomParameters({ prompt: 'select_account' });
      return provider;
    })()
  : null;
