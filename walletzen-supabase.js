import { supabaseUrl, supabaseAnonKey, isSupabaseConfigured } from "./supabase-config.js";

const $ = id => document.getElementById(id);
const APP_DATA_KEY = "walletzen_v2";
const SYNC_META_KEY = "walletzen_sync_meta_v1";
const DEFAULT_META = {
  version: 1,
  ownerUserId: null,
  localRevision: 0,
  lastSyncedLocalRevision: 0,
  lastSyncedCloudUpdatedAt: null,
  pending: false,
  pendingUserId: null
};

let supabase = null;
let activeUser = null;
let authMode = "login";
let syncBusy = false;
let syncTimer = null;
let retryTimer = null;
let retryCount = 0;
let syncRequested = false;
let lastLoadedUserId = null;
let authEventQueue = Promise.resolve();
let applyingRemoteData = false;
let conflictContext = null;

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
function showSignIn() {
  const gate = $("walletzenAuthGate");
  const app = $("walletzenApp");
  if (app) app.hidden = true;
  if (gate) gate.hidden = false;
  if ($("authGateChecking")) $("authGateChecking").style.display = "none";
  if ($("authGateForm")) $("authGateForm").style.display = "";
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
  if (element) {
    element.textContent = text;
    element.setAttribute("role", "status");
    element.setAttribute("aria-live", "polite");
  }
}
function localWalletData() {
  return typeof window.WalletZenGetData === "function" ? window.WalletZenGetData() : null;
}
function cloneData(data) {
  return data && typeof data === "object" ? JSON.parse(JSON.stringify(data)) : {};
}
function applyWalletData(data) {
  if (!data || typeof data !== "object" || typeof window.WalletZenSetCloudData !== "function") return;
  applyingRemoteData = true;
  try {
    window.WalletZenSetCloudData(data, true);
  } finally {
    applyingRemoteData = false;
  }
}
function readSyncMeta() {
  try {
    const raw = localStorage.getItem(SYNC_META_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    return Object.assign({}, DEFAULT_META, saved && typeof saved === "object" ? saved : {});
  } catch (_) {
    return Object.assign({}, DEFAULT_META);
  }
}
function writeSyncMeta(meta) {
  try {
    localStorage.setItem(SYNC_META_KEY, JSON.stringify(Object.assign({}, DEFAULT_META, meta)));
    return true;
  } catch (error) {
    console.error("WalletZen could not persist sync metadata:", error);
    return false;
  }
}
function stableStringify(value) {
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stableStringify(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}
function sameData(a, b) {
  try { return stableStringify(a || {}) === stableStringify(b || {}); }
  catch (_) { return false; }
}
function hasMeaningfulData(data) {
  if (!data || typeof data !== "object") return false;
  const nonEmpty = (value) => Array.isArray(value) && value.length > 0;
  const simpleCollections = ["transactions", "budgets", "goals", "subscriptions", "loans"];
  if (simpleCollections.some(key => nonEmpty(data[key]))) return true;
  if (data.biz && (nonEmpty(data.biz.items) || nonEmpty(data.biz.entries))) return true;

  const defaultAccounts = [
    { name: "cash wallet", type: "cash", balance: 5000, initialBalance: 5000 },
    { name: "bank account", type: "bank", balance: 25000, initialBalance: 25000 },
    { name: "bkash", type: "mobile", balance: 3500, initialBalance: 3500 }
  ];
  const accounts = Array.isArray(data.accounts) ? data.accounts : [];
  if (accounts.length !== defaultAccounts.length) return true;
  for (const expected of defaultAccounts) {
    const found = accounts.find(account => String(account?.name || "").trim().toLowerCase() === expected.name);
    if (!found || found.type !== expected.type ||
      Number(found.initialBalance) !== expected.initialBalance ||
      Number(found.balance) !== expected.balance) return true;
  }

  const defaultExpense = ["food", "transport", "shopping", "bills", "health", "entertainment", "education", "rent", "clothing", "personal", "gifts", "travel", "other"];
  const defaultIncome = ["salary", "freelance", "business", "investment", "gift", "rental", "other"];
  const categoryIds = list => (Array.isArray(list) ? list.map(item => item?.id).filter(Boolean).sort() : []);
  if (stableStringify(categoryIds(data.categories?.expense)) !== stableStringify(defaultExpense.slice().sort())) return true;
  if (stableStringify(categoryIds(data.categories?.income)) !== stableStringify(defaultIncome.slice().sort())) return true;

  const settings = data.settings || {};
  if ((settings.name && settings.name !== "My Finance") ||
      (settings.currency && settings.currency !== "৳") ||
      (settings.palette && settings.palette !== "green") ||
      (settings.gradient && settings.gradient !== "aurora") ||
      settings.pinEnabled === true || !!settings.pin ||
      settings.hideBalance === true) return true;
  return false;
}
function countRecords(data) {
  const count = key => Array.isArray(data?.[key]) ? data[key].length : 0;
  return count("transactions") + count("budgets") + count("goals") +
    count("subscriptions") + count("loans") +
    (Array.isArray(data?.biz?.items) ? data.biz.items.length : 0) +
    (Array.isArray(data?.biz?.entries) ? data.biz.entries.length : 0);
}
function localHasPendingChanges(meta, userId) {
  return !!meta.pending && meta.pendingUserId === userId &&
    Number(meta.localRevision || 0) > Number(meta.lastSyncedLocalRevision || 0);
}
function markSynced(updatedAt, snapshotRevision) {
  const meta = readSyncMeta();
  const revision = Number(snapshotRevision ?? meta.localRevision ?? 0);
  meta.ownerUserId = activeUser?.id || meta.ownerUserId;
  meta.lastSyncedCloudUpdatedAt = updatedAt || meta.lastSyncedCloudUpdatedAt;
  meta.lastSyncedLocalRevision = Math.max(Number(meta.lastSyncedLocalRevision || 0), revision);
  meta.pending = Number(meta.localRevision || 0) > meta.lastSyncedLocalRevision;
  meta.pendingUserId = meta.pending ? activeUser?.id || meta.pendingUserId : null;
  writeSyncMeta(meta);
  if (meta.pending) scheduleSync(500);
}
function friendlyError(error) {
  const message = error?.message || String(error || "Unknown error");
  if (/Invalid login credentials/i.test(message)) return "Email or password is incorrect.";
  if (/already registered/i.test(message)) return "An account with this email already exists. Try signing in.";
  if (/Password should be at least/i.test(message)) return "Choose a password with at least 6 characters.";
  if (/Email not confirmed/i.test(message)) return "Check your email and confirm your account before signing in.";
  if (/redirect/i.test(message)) return message + " Check the Supabase Auth URL configuration.";
  if (/row-level security|permission denied/i.test(message)) return "Supabase denied the database request. Check the table's RLS policies.";
  if (/Failed to fetch|NetworkError|fetch failed|Load failed/i.test(message)) return "Network unavailable. Your changes remain saved on this device.";
  return message;
}
function downloadBackup(data, filename) {
  try {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(() => { URL.revokeObjectURL(url); anchor.remove(); }, 1200);
    return true;
  } catch (error) {
    console.error("WalletZen backup download failed:", error);
    syncMessage("Could not download the backup. Your current device and cloud copies have not been changed.");
    return false;
  }
}
function showSyncConflict(local, row, reason) {
  conflictContext = {
    local: cloneData(local),
    cloud: cloneData(row?.data || {}),
    row: row ? { updated_at: row.updated_at } : null,
    reason
  };
  const localCount = countRecords(local);
  const cloudCount = countRecords(row?.data || {});
  const element = $("wzAccountSync");
  if (element) {
    element.innerHTML =
      '<div style="font-weight:800;margin-bottom:6px;color:var(--text)">' + (row ? 'Two different saved copies were found.' : 'Existing device data needs confirmation.') + '</div>' +
      '<div style="margin-bottom:10px">No data has been overwritten. This device has ' + localCount +
      ' financial records; the cloud copy has ' + cloudCount + '.</div>' +
      '<div style="display:grid;gap:8px">' +
      '<button type="button" class="btn btn-primary" onclick="walletZenResolveSyncConflict(\'device\')">Keep this device\'s copy' + (row ? '' : ' and upload it') + '</button>' +
      (row ? '<button type="button" class="btn btn-secondary" onclick="walletZenResolveSyncConflict(\'cloud\')">Use the cloud copy</button>' : '<div style="font-size:.72rem;color:var(--text3)">No cloud backup exists for this account yet.</div>') +
      '</div>' +
      (row ? '<div style="font-size:.68rem;margin-top:9px;color:var(--text3)">A JSON backup of the copy being replaced will be downloaded before the choice is applied.</div>' : '<div style="font-size:.68rem;margin-top:9px;color:var(--text3)">No cloud data exists for this account yet. Keeping this device copy creates the first cloud backup.</div>');
    element.setAttribute("role", "alert");
    element.setAttribute("aria-live", "assertive");
  }
  if ($("cloudStatus")) $("cloudStatus").textContent = row ? "Sync needs your choice · both copies preserved" : "Confirm device data for cloud backup";
  const modal = $("wzAccountModal");
  if (modal) modal.classList.add("open");
  console.warn("WalletZen sync conflict requires a choice:", reason);
}
function refreshConflictRow(row) {
  const latestLocal = cloneData(localWalletData());
  showSyncConflict(latestLocal, row, "cloud-changed-during-resolution");
}
async function fetchCloudRow() {
  const { data, error } = await supabase
    .from("walletzen_data")
    .select("data, updated_at")
    .eq("user_id", activeUser.id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}
async function insertCloudSnapshot(snapshot) {
  const { data, error } = await supabase
    .from("walletzen_data")
    .insert({ user_id: activeUser.id, data: snapshot })
    .select("data, updated_at")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") return { conflict: true, row: await fetchCloudRow() };
    throw error;
  }
  return { conflict: false, row: data || null };
}
async function compareAndSwapCloudSnapshot(row, snapshot) {
  const previousMs = Date.parse(row.updated_at);
  const nextTimestamp = new Date(Math.max(Date.now(), Number.isFinite(previousMs) ? previousMs + 1 : 0)).toISOString();
  const { data, error } = await supabase
    .from("walletzen_data")
    .update({ data: snapshot, updated_at: nextTimestamp })
    .eq("user_id", activeUser.id)
    .eq("updated_at", row.updated_at)
    .select("updated_at")
    .maybeSingle();
  if (error) throw error;
  return data?.updated_at || null;
}
function scheduleSync(delay = 900) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    syncWalletData();
  }, delay);
}
async function uploadLocalSnapshot(row, snapshot, snapshotRevision) {
  const updatedAt = row
    ? await compareAndSwapCloudSnapshot(row, snapshot)
    : (await insertCloudSnapshot(snapshot)).row?.updated_at || null;
  if (!updatedAt) {
    const latest = await fetchCloudRow();
    if (latest) showSyncConflict(snapshot, latest, "concurrent-cloud-write");
    else syncMessage("Cloud backup could not be confirmed. Your local copy is still saved on this device.");
    return false;
  }
  markSynced(updatedAt, snapshotRevision);
  retryCount = 0;
  syncMessage("Cloud backup up to date · " + new Date().toLocaleTimeString());
  if ($("cloudStatus")) $("cloudStatus").textContent = "Cloud synced · " + new Date().toLocaleTimeString();
  return true;
}
async function syncWalletData() {
  if (!activeUser || !supabase) return false;
  if (syncBusy) {
    syncRequested = true;
    return false;
  }
  if (conflictContext) {
    try {
      const latest = await fetchCloudRow();
      const previousVersion = conflictContext.row?.updated_at || null;
      const latestVersion = latest?.updated_at || null;
      if (previousVersion !== latestVersion) refreshConflictRow(latest);
    } catch (error) {
      syncMessage("The two-copy choice is still waiting. Reconnect to verify the cloud copy before resolving it.");
    }
    return false;
  }

  syncBusy = true;
  syncMessage("Checking your cloud backup…");
  if ($("cloudStatus")) $("cloudStatus").textContent = "Syncing cloud data…";
  try {
    const local = cloneData(localWalletData());
    const meta = readSyncMeta();
    if (meta.ownerUserId && meta.ownerUserId !== activeUser.id) {
      throw new Error("This device's saved data belongs to another account. Reload WalletZen before switching accounts.");
    }
    const snapshotRevision = Number(meta.localRevision || 0);
    const localPending = localHasPendingChanges(meta, activeUser.id);
    let row = await fetchCloudRow();

    if (!row) {
      // Legacy local data with no account association must not silently seed a
      // newly signed-in account. Ask before uploading it to that account.
      if (!meta.ownerUserId && hasMeaningfulData(local)) {
        showSyncConflict(local, null, "unclaimed-local-data");
        return false;
      }
      const inserted = await insertCloudSnapshot(local);
      if (inserted.conflict) row = inserted.row;
      else if (inserted.row) {
        markSynced(inserted.row.updated_at, snapshotRevision);
        retryCount = 0;
        syncMessage("Your device data is now backed up to your cloud account.");
        if ($("cloudStatus")) $("cloudStatus").textContent = "Cloud synced · " + new Date().toLocaleTimeString();
        return true;
      }
      if (!row) throw new Error("Cloud backup could not be created or verified.");
    }

    const cloud = row.data && typeof row.data === "object" ? row.data : {};
    const identical = sameData(local, cloud);
    const hasLocal = hasMeaningfulData(local);
    const hasCloud = hasMeaningfulData(cloud);
    const hasBaseline = !!meta.lastSyncedCloudUpdatedAt;
    const cloudChanged = hasBaseline && row.updated_at !== meta.lastSyncedCloudUpdatedAt;

    if (identical) {
      markSynced(row.updated_at, snapshotRevision);
      retryCount = 0;
      syncMessage("Cloud backup up to date · " + new Date().toLocaleTimeString());
      if ($("cloudStatus")) $("cloudStatus").textContent = "Cloud synced · " + new Date().toLocaleTimeString();
      return true;
    }

    if (hasBaseline) {
      if (localPending && cloudChanged) {
        showSyncConflict(local, row, "both-device-and-cloud-changed");
        return false;
      }
      if (localPending && !cloudChanged) {
        const saved = await uploadLocalSnapshot(row, local, snapshotRevision);
        if (!saved) return false;
        return true;
      }
      if (!localPending && cloudChanged) {
        applyWalletData(cloud);
        markSynced(row.updated_at, snapshotRevision);
        retryCount = 0;
        syncMessage("Cloud changes loaded onto this device.");
        if ($("cloudStatus")) $("cloudStatus").textContent = "Cloud synced · " + new Date().toLocaleTimeString();
        return true;
      }
      // A changed local copy without a matching durable pending marker is ambiguous.
      showSyncConflict(local, row, "untracked-local-change");
      return false;
    }

    // First sync on an older installation: never assume which non-empty copy is newer.
    if (!hasLocal && hasCloud) {
      applyWalletData(cloud);
      markSynced(row.updated_at, snapshotRevision);
      retryCount = 0;
      syncMessage("Cloud data loaded onto this device.");
      if ($("cloudStatus")) $("cloudStatus").textContent = "Cloud synced · " + new Date().toLocaleTimeString();
      return true;
    }
    if (hasLocal && !hasCloud && meta.ownerUserId === activeUser.id && localPending) {
      const saved = await uploadLocalSnapshot(row, local, snapshotRevision);
      return saved;
    }
    if (!hasLocal && !hasCloud) {
      applyWalletData(cloud);
      markSynced(row.updated_at, snapshotRevision);
      retryCount = 0;
      syncMessage("Cloud backup up to date.");
      if ($("cloudStatus")) $("cloudStatus").textContent = "Cloud synced";
      return true;
    }
    showSyncConflict(local, row, "first-sync-legacy-data");
    return false;
  } catch (error) {
    console.error("WalletZen Supabase sync error:", error);
    syncMessage("Cloud sync is unavailable. Your changes remain saved on this device and will retry when you reconnect. " + friendlyError(error));
    if ($("cloudStatus")) $("cloudStatus").textContent = "Sync pending · local copy preserved";
    if (navigator.onLine && !conflictContext) {
      retryCount = Math.min(retryCount + 1, 6);
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        syncWalletData();
      }, Math.min(60000, 1500 * Math.pow(2, retryCount - 1)));
    }
    return false;
  } finally {
    syncBusy = false;
    if (syncRequested) {
      syncRequested = false;
      scheduleSync(300);
    }
  }
}
function queueSync(snapshot) {
  if (applyingRemoteData || !snapshot) return;
  const meta = readSyncMeta();
  meta.localRevision = Number(meta.localRevision || 0) + 1;
  meta.pending = true;
  meta.pendingUserId = activeUser?.id || meta.pendingUserId || meta.ownerUserId || null;
  meta.localModifiedAt = new Date().toISOString();
  const persisted = writeSyncMeta(meta);
  if (!persisted) {
    syncMessage("Saved to this device, but the sync marker could not be stored. Keep the app open and use Sync now after reconnecting.");
    return;
  }
  if (conflictContext) {
    syncMessage("Saved on this device. Resolve the two-copy sync notice before syncing.");
    return;
  }
  syncMessage("Saved on this device · cloud backup pending");
  if ($("cloudStatus")) $("cloudStatus").textContent = "Cloud backup pending";
  if (activeUser && supabase && navigator.onLine) scheduleSync(900);
}
window.WalletZenCloud = { queueSync };
window.walletZenSyncNow = syncWalletData;
window.openWalletZenAccount = () => {
  const modal = $("wzAccountModal");
  if (modal) modal.classList.add("open");
  if (conflictContext) {
    const latest = conflictContext.row ? { data: conflictContext.cloud, updated_at: conflictContext.row.updated_at } : null;
    if (latest) showSyncConflict(conflictContext.local, latest, conflictContext.reason);
  } else {
    syncMessage("WalletZen is signed in with " + (activeUser?.email || "your Supabase account") + ".");
  }
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
window.walletZenResolveSyncConflict = async choice => {
  if (!conflictContext || !activeUser || !supabase) return;
  const context = conflictContext;
  const current = cloneData(localWalletData());
  const meta = readSyncMeta();
  const revision = Number(meta.localRevision || 0);
  try {
    if (choice === "cloud") {
      // Re-check the selected cloud version immediately before applying it.
      const latest = await fetchCloudRow();
      if (!latest) { refreshConflictRow(null); return; }
      if (latest.updated_at !== context.row?.updated_at) {
        refreshConflictRow(latest);
        return;
      }
      if (!downloadBackup(current, "walletzen_device_backup_" + new Date().toISOString().slice(0, 10) + ".json")) return;
      applyWalletData(latest.data);
      conflictContext = null;
      markSynced(latest.updated_at, revision);
      syncMessage("Cloud copy selected. A backup of the previous device copy was downloaded.");
      if ($("cloudStatus")) $("cloudStatus").textContent = "Cloud synced · " + new Date().toLocaleTimeString();
      $("wzAccountModal")?.classList.remove("open");
      return;
    }
    if (choice === "device") {
      if (context.row && !downloadBackup(context.cloud, "walletzen_cloud_backup_" + new Date().toISOString().slice(0, 10) + ".json")) return;
      if (!context.row) {
        const inserted = await insertCloudSnapshot(current);
        if (inserted.conflict && inserted.row) {
          refreshConflictRow(inserted.row);
          return;
        }
        if (!inserted.row) throw new Error("Could not create the cloud copy.");
        markSynced(inserted.row.updated_at, revision);
      } else {
        const latest = await fetchCloudRow();
        if (!latest) {
          const inserted = await insertCloudSnapshot(current);
          if (inserted.conflict && inserted.row) { refreshConflictRow(inserted.row); return; }
          if (!inserted.row) throw new Error("Could not recreate the missing cloud backup.");
          markSynced(inserted.row.updated_at, revision);
        } else if (latest.updated_at !== context.row.updated_at) {
          refreshConflictRow(latest);
          return;
        } else {
          const updatedAt = await compareAndSwapCloudSnapshot(latest, current);
          if (!updatedAt) {
            const newest = await fetchCloudRow();
            refreshConflictRow(newest);
            return;
          }
          markSynced(updatedAt, revision);
        }
      }
      conflictContext = null;
      syncMessage(context.row ? "This device's copy is now the cloud backup. A backup of the previous cloud copy was downloaded." : "This device's copy is now backed up to your cloud account.");
      if ($("cloudStatus")) $("cloudStatus").textContent = "Cloud synced · " + new Date().toLocaleTimeString();
      $("wzAccountModal")?.classList.remove("open");
      return;
    }
  } catch (error) {
    console.error("WalletZen conflict resolution error:", error);
    syncMessage("The conflict was not resolved. Both saved copies remain unchanged. " + friendlyError(error));
  }
};
window.walletZenSupabaseSubmit = async () => {
  if (!supabase) {
    gateMessage("Sign-in is temporarily unavailable. Please try again later.");
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
    gateMessage("Sign-in is temporarily unavailable. Please try again later.");
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
    gateMessage("Configure Supabase before resetting passwords.");
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
  const meta = readSyncMeta();
  if (localHasPendingChanges(meta, activeUser?.id)) {
    await syncWalletData();
    const afterSync = readSyncMeta();
    if (localHasPendingChanges(afterSync, activeUser?.id) &&
        !window.confirm("Some changes are still waiting for cloud backup. They remain on this device. Sign out anyway?")) return;
  }
  const { error } = await supabase.auth.signOut();
  if (error) {
    syncMessage(friendlyError(error));
    return;
  }
  $("wzAccountModal")?.classList.remove("open");
  gateMessage("You have signed out. Sign in again to open your finance dashboard.", "success");
};
function isolateUserStorage(userId) {
  const meta = readSyncMeta();
  if (!meta.ownerUserId || meta.ownerUserId === userId) return false;
  const raw = localStorage.getItem(APP_DATA_KEY);
  if (raw) {
    const backupBase = "walletzen_local_backup_" + meta.ownerUserId;
    const backupKey = localStorage.getItem(backupBase) === null
      ? backupBase
      : backupBase + "_" + new Date().toISOString().replace(/[:.]/g, "-");
    localStorage.setItem(backupKey, raw);
  }
  // Write the new owner marker before removing the old active snapshot. If
  // storage is full, fail closed and leave the previous data in place.
  const nextMeta = Object.assign({}, DEFAULT_META, { ownerUserId: userId });
  if (!writeSyncMeta(nextMeta)) throw new Error("Could not safely persist the new account marker.");
  if (syncTimer) clearTimeout(syncTimer);
  if (retryTimer) clearTimeout(retryTimer);
  localStorage.removeItem(APP_DATA_KEY);
  return true;
}
async function handleAuthSession(session, event) {
  const nextUser = session?.user || null;
  if (event === "PASSWORD_RECOVERY" && nextUser) {
    activeUser = nextUser;
    showSignIn();
    configureGateMode("recovery");
    gateMessage("Set a new password to finish recovering your account.", "success");
    if ($("authGatePassword")) $("authGatePassword").focus();
    return;
  }
  if (!nextUser) {
    activeUser = null;
    lastLoadedUserId = null;
    showSignIn();
    configureGateMode("login");
    return;
  }
  try {
    if (isolateUserStorage(nextUser.id)) {
      // A different account signed in on this browser. Keep the previous local
      // snapshot under its old account key, then restart with a clean local store.
      window.location.reload();
      return;
    }
  } catch (error) {
    console.error("WalletZen local account isolation failed:", error);
    showSignIn();
    gateMessage("This device could not safely switch accounts because its local backup could not be preserved.", "error");
    return;
  }
  const needsInitialSync = lastLoadedUserId !== nextUser.id;
  if (needsInitialSync) {
    activeUser = nextUser;
    if (typeof window.WalletZenStartApp === "function") window.WalletZenStartApp();
    await syncWalletData();
    lastLoadedUserId = nextUser.id;
  }
  showApp(nextUser);
}
async function initializeSupabase() {
  if (!isSupabaseConfigured()) {
    showSignIn();
    configureGateMode("login");
    return;
  }
  try {
    const sdkModule = await import("https://esm.sh/@supabase/supabase-js@2.119.0?bundle");
    supabase = sdkModule.createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    supabase.auth.onAuthStateChange((event, session) => {
      authEventQueue = authEventQueue.then(() => handleAuthSession(session, event)).catch(error => {
        console.error("WalletZen auth-state error:", error);
        showSignIn();
        gateMessage("WalletZen could not restore your session. Please sign in again.", "error");
      });
    });
  } catch (error) {
    console.error("Could not initialize Supabase:", error);
    showSignIn();
    gateMessage("Secure sign-in could not load. Check your connection and reopen WalletZen.", "error");
  }
}
window.addEventListener("online", () => {
  if (activeUser && supabase) syncWalletData();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && activeUser && supabase) syncWalletData();
  if (document.visibilityState === "hidden" && activeUser && supabase) syncWalletData();
});
window.addEventListener("pagehide", () => {
  if (activeUser && supabase) syncWalletData();
});
document.addEventListener("DOMContentLoaded", initializeSupabase);
