# WalletZen — Supabase setup

The app uses Supabase Auth for email/password and Google OAuth, with a persistent browser session. The dashboard is hidden behind the sign-in screen until a saved Supabase session is restored. Existing local WalletZen data remains in the browser; first sign-in uploads it if that user has no cloud row. If a cloud row already exists, it is loaded onto this device.

## 1. Project and client connection
The WalletZen Supabase project has been created and the public project URL/publishable key are already configured in `supabase-config.js`.
- Project dashboard: https://supabase.com/dashboard/project/djytqqgaydbpfyhchfkh
- Project URL: `https://djytqqgaydbpfyhchfkh.supabase.co`
- The frontend uses the publishable key, which is designed for browser clients. Never put a `service_role` or secret key in browser code.
- The project URL and public key are not authentication provider credentials; Google OAuth still needs a Google OAuth Client ID and Client Secret configured in Supabase.

## 2. Database and row-level security
The `public.walletzen_data` table is already created in the connected project and Row Level Security is enabled. Four policies restrict SELECT, INSERT, UPDATE, and DELETE to rows where `user_id = auth.uid()`. The connected database was checked for the expected schema and policies, and current Supabase security/performance advisor checks returned no notices.
The reproducible schema is kept in `supabase/schema.sql`.

## 3. Configure email authentication
In Authentication > URL Configuration, set Site URL to `https://walletzen.vercel.app` (or your actual active deployment URL if different). Add `https://walletzen.vercel.app/**` and any local development URL you use to Redirect URLs. In Authentication > Sign In / Providers, confirm Email is enabled. Depending on your confirmation settings, new users may need to confirm their email before they can sign in.

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
