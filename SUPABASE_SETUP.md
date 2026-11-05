# WalletZen — Supabase setup and sync behavior

WalletZen uses Supabase Auth for email/password and Google OAuth. The finance data is stored locally first in the browser's existing `walletzen_v2` key, then backed up to the authenticated user's private row in `public.walletzen_data`.

## Project connection

- Project dashboard: https://supabase.com/dashboard/project/djytqqgaydbpfyhchfkh
- Project URL: `https://djytqqgaydbpfyhchfkh.supabase.co`
- The frontend uses a public publishable key. Never put a `service_role` or secret key in browser code.
- Google OAuth still requires a Google OAuth Client ID and Client Secret configured in Supabase.

## Database and row-level security

The existing `public.walletzen_data` table is retained. RLS must remain enabled, with SELECT, INSERT, UPDATE, and DELETE policies restricting each row to `user_id = auth.uid()`. The reproducible policy definitions are in `supabase/schema.sql`.

The sync repair does not delete, truncate, reset, or rewrite existing user rows. It uses conditional updates against the row's current `updated_at` value so a concurrent device update cannot be silently overwritten.

## Authentication configuration

In Authentication > URL Configuration, set the Site URL to `https://walletzen.vercel.app` (or the active deployment URL). Add `https://walletzen.vercel.app/**` and any local development URL you use to Redirect URLs. Confirm Email is enabled as intended.

For Google login:
1. Enable Google under Authentication > Sign In / Providers.
2. Create a Google OAuth client in Google Cloud Console.
3. Add the callback URL shown by Supabase to the OAuth client's authorized redirect URIs.
4. Add the client ID and secret in Supabase provider settings, not in this repository.

## Sync safety behavior

- Every app save writes the main local data key first. The sync module then persists a small pending marker and local revision in `localStorage` before attempting the network request.
- Pending writes retry after reconnection, when the app becomes visible, and at the next authenticated launch. Page lifecycle events trigger a best-effort immediate flush, but the durable local marker—not the lifecycle callback—is the recovery mechanism.
- Each cloud write uses an optimistic concurrency check against the row's current `updated_at`. If another device changes the row first, WalletZen does not overwrite it.
- On older installations with no prior sync checkpoint, two different non-empty copies are treated as a conflict. The app asks whether to keep the device copy or the cloud copy. It downloads a JSON backup of the copy being replaced before applying the choice.
- If a device contains meaningful legacy data but no cloud row exists and no account ownership marker is present, WalletZen pauses before uploading it to the newly signed-in account. The user must explicitly choose to keep and upload the device copy. If no cloud copy exists, the cloud-choice button is not shown.
- A legacy local copy is not automatically assigned to a new account. When one device account is switched to another, the prior device snapshot is saved under an account-specific local backup key and the app restarts with an isolated local store.
- Offline changes remain in the browser and are retried later. They are not guaranteed to reach Supabase until a successful sync is confirmed.

## PWA update

The service worker cache is versioned as `walletzen-v5`. Close the installed WalletZen app completely, open it while connected to the internet, and allow the new service worker to activate. If an older shell remains open, close and reopen it once more.

## Verification checklist

1. Sign in and confirm the dashboard opens.
2. Add a test transaction; confirm the account panel reports that the cloud backup is up to date.
3. Reopen WalletZen and confirm the transaction remains present.
4. On another browser/device using the same account, sign in and confirm the cloud data loads.
5. Turn off the network, add a test record, close and reopen while offline if the app shell and Supabase SDK have been cached, then reconnect. Confirm the pending status clears after upload.
6. Test a concurrent edit from two devices. WalletZen should display the two-copy resolution prompt rather than silently replacing either copy.
7. Sign out and sign in with a different account on the same browser. The previous local account's data must not appear in the new account.

## Data export

Before changing devices or clearing browser data, use Settings > Data Management > Export JSON. Keep the backup outside the app's browser storage.
