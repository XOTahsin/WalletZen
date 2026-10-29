import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { supabaseUrl, supabaseAnonKey, isSupabaseConfigured } from "./supabase-config.js";

const $ = id => document.getElementById(id);
let supabase = null;
let activeUser = null;
let authMode = "login";
let syncBusy = false;
let pendingSnapshot = null;
let syncTimer = null;
let lastLoadedUserId = null;
let authEventQueue = Promise.resolve();

function gateMessage(text, type = "") {
  const element = $("authGateMessage");
  if (!element) return;
  element.textContent = text;
  element.className = "wz-auth-message" + (type ? " " + type : "");
}
function setFormBusy(busy) {
  ["authGateSubmit", "authGateGoogle", "authGateModeToggle", "authGateForgot"].forEach(id => {
    const element = $(id);
    if (element) element.disabled = !!busy;
  });
  if ($("authGateSubmitText")) $("authGateSubmitText").textContent = busy ? "Please wait…" : (authMode === "signup" ? "Create account" : "Sign in");
}
function configureGateMode(mode) {
  authMode = mode;
  const signup = mode === "signup";
  const recovery = mode === "recovery";
  if ($("authGateTitle")) $("authGateTitle").innerHTML = recovery ? 'Set a new <span>password.</span>' : signup ? 'Create your <span>account.</span>' : 'Welcome <span>back.</span>';
  if ($("authGateSubtitle")) $("authGateSubtitle").textContent = recovery ? "Choose a new password for your WalletZen account." : signup ? "Start organizing your money in one private space." : "Sign in to pick up where you left off.";
  if ($("authGateSubmitText")) $("authGateSubmitText").textContent = recovery ? "Update password" : signup ? "Create account" : "Sign in";
  if ($("authGateModeToggle")) $("authGateModeToggle").textContent = recovery ? "Back to sign in" : signup ? "Sign in" : "Create account";
  if ($("authGateToggleText")) $("authGateToggleText").textContent = recovery ? "Remembered your password?" : signup ? "Already have an account?" : "Don't have an account?";
  if ($("authGatePassword")) {
    $("authGatePassword").autocomplete = signup || recovery ? "new-password" : "current-password";
    $("authGatePassword").placeholder = recovery ? "Enter your new password" : signup ? "Create a password" : "Enter your password";
  }
  if ($("authGatePasswordLabel")) $("authGatePasswordLabel").textContent = recovery ? "New password" : "Password";
  if ($("authGateEmailLabel")) $("authGateEmailLabel").style.display = recovery ? "none" : "";
  if ($("authGateEmailWrap")) $("authGateEmailWrap").style.display = recovery ? "none" : "";
  if ($("authGateEmail")) $("authGateEmail").required = !recovery;
  if ($("authGateForgot")) $("authGateForgot").style.visibility = signup || recovery ? "hidden" : "visible";
  if ($("authGateGoogle")) $("authGateGoogle").style.display = recovery ? "none" : "";
  if ($("authGateDivider")) $("authGateDivider").style.display = recovery ? "none" : "";
  gateMessage("");
}
function showSignIn(setupMessage = false) {
  const gate = $("walletzenAuthGate");
  const app = $("walletzenApp");
  if (app) app.hidden = true;
  if (gate) gate.hidden = false;
  if ($("authGateChecking")) $("authGateChecking").style.display = "none";
  if ($("authGateForm")) $("authGateForm").style.display = "";
  if ($("authSetupNote")) $("authSetupNote").style.display = setupMessage ? "" : "none";
}
function showApp(user) {
  activeUser = user;
  const gate = $("walletzenAuthGate");
  const app = $("walletzenApp");
  if (app) app.hidden = false;
  if (gate) gate.hidden = true;
  if ($("wzAccountEmail")) $("wzAccountEmail").textContent = user.email || user.user_metadata?.full_name || "Signed in with Google";
  if ($("cloudStatus")) $("cloudStatus").textContent = user.email ? "Cloud account · " + user.email : "Cloud account connected";
  const accountButton = $("accountButton");
  if (accountButton) accountButton.textContent = "Account";
}
function syncMessage(text) {
  const element = $("wzAccountSync");
  if (element) element.textContent = text;
}
function localWalletData() {
  return typeof window.WalletZenGetData === "function" ? window.WalletZenGetData() : null;
}
function applyWalletData(data) {
  if (data && typeof data === "object" && typeof window.WalletZenSetCloudData === "function") {
    window.WalletZenSetCloudData(data);
  }
}
function friendlyError(error) {
  const message = error?.message || String(error || "Unknown error");
  if (/Invalid login credentials/i.test(message)) return "Email or password is incorrect.";
  if (/already registered/i.test(message)) return "An account with this email already exists. Try signing in.";
  if (/Password should be at least/i.test(message)) return "Choose a password with at least 6 characters.";
  if (/Email not confirmed/i.test(message)) return "Check your email and confirm your account before signing in.";
  if (/redirect/i.test(message)) return message + " Check the Supabase Auth URL configuration.";
  if (/row-level security|permission denied/i.test(message)) return "Supabase denied the database request. Run the SQL setup in SUPABASE_SETUP.md.";
  return message;
}
async function syncWalletData() {
  if (!activeUser || !supabase || syncBusy) return;
  syncBusy = true;
  syncMessage("Checking your cloud data…");
  if ($("cloudStatus")) $("cloudStatus").textContent = "Syncing cloud data…";
  try {
    const { data: row, error } = await supabase
      .from("walletzen_data")
      .select("data, updated_at")
      .eq("user_id", activeUser.id)
      .maybeSingle();
    if (error) throw error;
    if (row && row.data && typeof row.data === "object") {
      // Existing cloud state wins on this device. Export a local JSON backup first
      // if local and cloud data may differ.
      applyWalletData(row.data);
      syncMessage("Cloud data loaded · " + (row.updated_at ? new Date(row.updated_at).toLocaleString() : "latest copy"));
    } else {
      // First login for this account: upload this browser's existing local data.
      const local = localWalletData();
      if (local) {
        const { error: writeError } = await supabase.from("walletzen_data").upsert({
          user_id: activeUser.id,
          data: local,
          updated_at: new Date().toISOString()
        }, { onConflict: "user_id" });
        if (writeError) throw writeError;
      }
      syncMessage("Your existing local data is now backed up to your cloud account.");
    }
    if ($("cloudStatus")) $("cloudStatus").textContent = "Cloud synced · " + new Date().toLocaleTimeString();
  } catch (error) {
    console.error("WalletZen Supabase sync error:", error);
    syncMessage("Cloud sync is unavailable. Your local data remains on this device. " + friendlyError(error));
    if ($("cloudStatus")) $("cloudStatus").textContent = "Offline / sync error · local data is safe";
  } finally {
    syncBusy = false;
  }
}
async function pushWalletData(snapshot) {
  if (!supabase || !activeUser || !snapshot) return;
  pendingSnapshot = snapshot;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    const latest = pendingSnapshot;
    pendingSnapshot = null;
    if (!latest || !activeUser) return;
    try {
      const { error } = await supabase.from("walletzen_data").upsert({
        user_id: activeUser.id,
        data: latest,
        updated_at: new Date().toISOString()
      }, { onConflict: "user_id" });
      if (error) throw error;
      syncMessage("Cloud backup up to date · " + new Date().toLocaleTimeString());
      if ($("cloudStatus")) $("cloudStatus").textContent = "Cloud synced · " + new Date().toLocaleTimeString();
    } catch (error) {
      console.error("WalletZen Supabase write error:", error);
      syncMessage("Cloud sync failed; changes are still saved locally. " + friendlyError(error));
      if ($("cloudStatus")) $("cloudStatus").textContent = "Sync error · local data is safe";
    }
  }, 850);
}
window.WalletZenCloud = { queueSync: pushWalletData };
window.openWalletZenAccount = () => {
  const modal = $("wzAccountModal");
  if (modal) modal.classList.add("open");
  syncMessage("WalletZen is signed in with " + (activeUser?.email || "your Supabase account") + ".");
};
window.closeWalletZenAccount = () => $("wzAccountModal")?.classList.remove("open");
window.walletZenToggleMode = () => configureGateMode(authMode === "signup" ? "login" : authMode === "recovery" ? "login" : "signup");
window.walletZenTogglePassword = () => {
  const field = $("authGatePassword");
  if (!field) return;
  const show = field.type === "password";
  field.type = show ? "text" : "password";
  if ($("authGatePasswordToggle")) $("authGatePasswordToggle").setAttribute("aria-label", show ? "Hide password" : "Show password");
};
window.walletZenSupabaseSubmit = async () => {
  if (!supabase) {
    gateMessage("Supabase is not configured yet. Follow SUPABASE_SETUP.md and add your project URL and public key.", "error");
    return;
  }
  const email = ($("authGateEmail")?.value || "").trim();
  const password = $("authGatePassword")?.value || "";
  if (!password || (authMode !== "recovery" && !email)) {
    gateMessage(authMode === "recovery" ? "Enter your new password." : "Enter your email address and password.", "error");
    return;
  }
  if (password.length < 6) {
    gateMessage("Choose a password with at least 6 characters.", "error");
    return;
  }
  setFormBusy(true);
  gateMessage(authMode === "signup" ? "Creating your account…" : authMode === "recovery" ? "Updating your password…" : "Signing in securely…");
  try {
    if (authMode === "recovery") {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      gateMessage("Password updated. Opening WalletZen…", "success");
      configureGateMode("login");
      if (activeUser) {
        showApp(activeUser);
        if (lastLoadedUserId !== activeUser.id) {
          lastLoadedUserId = activeUser.id;
          await syncWalletData();
        }
      }
    } else if (authMode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin + window.location.pathname }
      });
      if (error) throw error;
      if (!data.session) {
        gateMessage("Account created. Check your email to confirm it, then return here to sign in.", "success");
      } else {
        gateMessage("Account created successfully.", "success");
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (error) {
    gateMessage(friendlyError(error), "error");
  } finally {
    setFormBusy(false);
  }
};
window.walletZenSupabaseGoogle = async () => {
  if (!supabase) {
    gateMessage("Supabase is not configured yet. Follow SUPABASE_SETUP.md first.", "error");
    return;
  }
  setFormBusy(true);
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + window.location.pathname }
    });
    if (error) throw error;
  } catch (error) {
    gateMessage(friendlyError(error), "error");
    setFormBusy(false);
  }
};
window.walletZenSupabaseReset = async () => {
  if (!supabase) {
    gateMessage("Configure Supabase before resetting passwords.", "error");
    return;
  }
  const email = ($("authGateEmail")?.value || "").trim();
  if (!email) {
    gateMessage("Enter your email address first, then choose Forgot password.", "error");
    return;
  }
  try {
    setFormBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname
    });
    if (error) throw error;
    gateMessage("If the account is registered, a password reset email will be sent.", "success");
  } catch (error) {
    gateMessage(friendlyError(error), "error");
  } finally {
    setFormBusy(false);
  }
};
window.walletZenSupabaseSignOut = async () => {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) {
    syncMessage(friendlyError(error));
    return;
  }
  $("wzAccountModal")?.classList.remove("open");
  gateMessage("You have signed out. Sign in again to open your finance dashboard.", "success");
};
async function handleAuthSession(session, event) {
  const nextUser = session?.user || null;
  if (event === "PASSWORD_RECOVERY" && nextUser) {
    activeUser = nextUser;
    showSignIn(false);
    configureGateMode("recovery");
    gateMessage("Set a new password to finish recovering your account.", "success");
    if ($("authGatePassword")) $("authGatePassword").focus();
    return;
  }
  if (!nextUser) {
    activeUser = null;
    lastLoadedUserId = null;
    showSignIn(!isSupabaseConfigured());
    configureGateMode("login");
    return;
  }
  const needsInitialSync = lastLoadedUserId !== nextUser.id;
  showApp(nextUser);
  if (needsInitialSync) {
    lastLoadedUserId = nextUser.id;
    await syncWalletData();
  }
}
function initializeSupabase() {
  if (!isSupabaseConfigured()) {
    showSignIn(true);
    configureGateMode("login");
    if ($("authGateChecking")) $("authGateChecking").style.display = "none";
    if ($("authSetupNote")) $("authSetupNote").style.display = "";
    return;
  }
  try {
    supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    // Do not reveal the app until the persisted session has been restored.
    supabase.auth.onAuthStateChange((event, session) => {
      authEventQueue = authEventQueue.then(() => handleAuthSession(session, event)).catch(error => {
        console.error("WalletZen auth-state error:", error);
        showSignIn(false);
      });
    });
  } catch (error) {
    console.error("Could not initialize Supabase:", error);
    showSignIn(true);
    gateMessage("Could not start Supabase. Check supabase-config.js. " + friendlyError(error), "error");
  }
}
function start() {
  if ($("authGateChecking")) $("authGateChecking").style.display = "";
  if ($("authGateForm")) $("authGateForm").style.display = "none";
  initializeSupabase();
}
document.addEventListener("DOMContentLoaded", start);
