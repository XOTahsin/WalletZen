# WalletZen Firebase setup

## Configure Firebase
1. Open https://console.firebase.google.com/ and create or select a project.
2. Project settings > General > Your apps: register a Web app and copy its config into `firebase-config.js`.
3. Authentication > Sign-in method: enable **Email/Password** and **Google**.
4. Authentication > Settings > Authorized domains: add the hostname used by your deployed app.
5. Create a Cloud Firestore database.

## Deploy security rules
Install Firebase CLI and run:
```sh
firebase login
firebase use --add
firebase deploy --only firestore:rules,storage
```
Review and test rules in the Firebase Emulator Suite before putting real financial data in the cloud. The rules limit each user to their own `users/{uid}/walletzen/data` document. Storage is denied by default because the current app has no file-upload feature.

## Local-first behavior
- WalletZen continues saving to its existing `walletzen_v2` localStorage key.
- Sign in to sync the current data object to Firestore.
- If the cloud backup already exists, it becomes the account's active data on sign-in. Export a JSON backup before first sign-in if local and cloud records may differ.
- Without Firebase config or during network failures, local data remains available.
- Cloud sync writes the existing app state as one Firestore document. Consider splitting collections if the dataset grows substantially.

## Important
Firebase project creation, provider enablement, authorized domains, and deployment require actions in your own Firebase account. The repository intentionally contains no private service-account key. Until you replace the placeholders, the app remains local-only.
