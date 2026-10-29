// Copy web-app values from Firebase Console > Project settings > Your apps.
export const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_FIREBASE_APP_ID"
};
export const isFirebaseConfigured = () =>
  firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("YOUR_") &&
  firebaseConfig.projectId && !firebaseConfig.projectId.startsWith("YOUR_") &&
  firebaseConfig.appId && !firebaseConfig.appId.startsWith("YOUR_");
