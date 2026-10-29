# WalletZen — Supabase setup

The app uses Supabase Auth for email/password and Google OAuth, with a persistent browser session. The dashboard is hidden behind the sign-in screen until a saved Supabase session is restored. Existing local WalletZen data remains in the browser; first sign-in uploads it if that user has no cloud row. If a cloud row already exists, it is loaded onto this device.

## 1. Create a Supabase project
1. Open https://supabase.com/dashboard and create a project.
2. Open Project Settings > API (or API Keys).
3. Copy the Project URL and the **publishable key** (or legacy anon/public key).
4. Put those values in `supabase-config.js`. Never use a service_role/secret key in browser code.

## 2. Create the private data table
1. In Supabase, open SQL Editor > New query.
2. Open this repository's `supabase/schema.sql`, copy the entire file into the SQL editor and Run it.
3. Confirm the `walletzen_data` table exists and RLS is enabled. The policies limit all row operations to the authenticated user's own `user_id`.

## 3. Configure email authentication
In Authentication > URL Configuration, set Site URL to your deployed WalletZen URL. Add the exact production URL and local development URL, if used, to Redirect URLs. In Authentication > Sign In / Providers, enable Email. Depending on your confirmation settings, new users may need to confirm their email before they can sign in.

## 4. Enable Google login
1. In Supabase Authentication > Sign In / Providers > Google, enable the provider.
2. Follow the Supabase provider instructions to create a Google OAuth client in Google Cloud Console.
3. Add the callback URL shown in Supabase to the Google OAuth client's authorized redirect URIs.
4. Put the Google client ID/secret in Supabase's provider settings (not in this GitHub repo).
5. Save, and ensure your deployed WalletZen URL is listed in Supabase Auth Redirect URLs.

## 5. Deploy and verify
Deploy the latest `main` branch on the hosting service connected to this repository. If you're using an installed PWA, close the app completely and reopen it after the deployment; the service worker cache was bumped to v4. A hard refresh (Ctrl+F5) can help on desktop.
Test:
- New account creation and email confirmation if enabled.
- Email/password login.
- Google OAuth sign-in and return redirect.
- Refresh/reopen while signed in: it should restore the session and open the dashboard, not ask again.
- First login with an empty cloud row: existing local data should be uploaded.
- Another device login: it should retrieve the cloud data for the same user.
- Sign out: it returns to the sign-in screen; the local device data stays saved.
- Network unavailable: local work remains possible once a session has already opened the app; cloud updates queue until a save is triggered again.

## Data behavior and safety
- Each user's entire current WalletZen data object is stored as one JSONB row. This is simple for a small single-user finance app; it may be split into per-collection rows later.
- Existing cloud data takes precedence over local data on a device when that account signs in. Export a JSON backup first if the two copies may differ.
- The browser always saves to the pre-existing `walletzen_v2` localStorage key first.
- The Supabase URL and publishable/anon key are intended for browser use; access is controlled by Auth and RLS. Do not commit service-role secrets.
- The app's sign-in screen is styled responsively; adjust `--wz-auth-card-max`, `--wz-auth-layout-max`, and `--wz-auth-card-padding` in the CSS to change the login card's maximum width and spacing.
