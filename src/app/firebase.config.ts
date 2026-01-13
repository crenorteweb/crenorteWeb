import { getApp, getApps, initializeApp } from 'firebase/app';
import { getStorage } from 'firebase/storage';
import { getFirestore } from 'firebase/firestore';
import { firebaseConfig } from '../environments/firebase.config';

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// NADA de App Check aqui
export const db = getFirestore(app);
export const storage = getStorage(app);
