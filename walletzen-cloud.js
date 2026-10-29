import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";
const $ = id => document.getElementById(id);
let auth=null, db=null, sdk=null, user=null, syncing=false, timer=null;
const status = s => { if($("cloudStatus")) $("cloudStatus").textContent=s; };
const message = (s,t="") => { if($("authMessage")) { $("authMessage").textContent=s; $("authMessage").className="auth-message"+(t?" "+t:""); } };
const localData = () => typeof window.WalletZenGetData==="function" ? window.WalletZenGetData() : null;
const ref = () => sdk.doc(db,"users",user.uid,"walletzen","data");
function userUI(u) {
  user=u;
  if($("authSignedIn")) $("authSignedIn").style.display=u?"":"none";
  if($("authSignedOut")) $("authSignedOut").style.display=u?"none":"";
  if($("authTitle")) $("authTitle").textContent=u?"Account connected":"Your WalletZen account";
  if($("authSubtitle")) $("authSubtitle").textContent=u?"Cloud sync is enabled for this account.":"Sign in to securely sync your finance data across devices.";
  if($("authUserSummary")) $("authUserSummary").textContent=(u.displayName||u.email||"Signed in")+" · "+(u.email||"")+"\nPrivate cloud backup enabled.";
  if($("accountButton")) $("accountButton").textContent=u?(u.displayName||"Account"):"Log in";
  status(u?"Signed in · "+(u.email||"cloud account"):"Local data · not signed in");
}
function friendly(e) {
  const map={
   "auth/email-already-in-use":"An account already exists for this email. Try logging in.",
   "auth/invalid-email":"Enter a valid email address.",
   "auth/weak-password":"Choose a stronger password (at least 6 characters).",
   "auth/invalid-credential":"Email or password is incorrect.",
   "auth/popup-closed-by-user":"Google sign-in was closed before completion.",
   "auth/unauthorized-domain":"Add this website hostname to Firebase Authentication's authorized domains.",
   "auth/operation-not-allowed":"Enable this sign-in method in Firebase Console.",
   "permission-denied":"Firestore denied access. Deploy the included rules to your Firebase project."
  };
  return map[e?.code]||("Could not complete the request: "+(e?.code||e?.message||"unknown error"));
}
async function syncNow() {
 if(!user||!db||syncing)return;
 syncing=true;status("Syncing cloud data…");
 try {
  const document=ref(), snap=await sdk.getDoc(document);
  if(snap.exists()) {
   const cloud=snap.data().data;
   if(cloud&&typeof cloud==="object"&&typeof window.WalletZenSetCloudData==="function") window.WalletZenSetCloudData(cloud);
  } else {
   const local=localData();
   if(local) await sdk.setDoc(document,{data:local,updatedAt:sdk.serverTimestamp()});
  }
  status("Cloud synced · "+new Date().toLocaleTimeString());
 } catch(e) {
  console.error("WalletZen cloud sync failed",e);status("Sync error · local data is safe");
  message("Cloud sync failed; local data is still available. Check Firebase setup, network, and Firestore rules. "+(e.code||""),"error");
 } finally {syncing=false;}
}
function queueSync(data) {
 if(!user||!db||!data)return;
 if(timer)clearTimeout(timer);
 timer=setTimeout(async()=>{
  try { await sdk.setDoc(ref(),{data,updatedAt:sdk.serverTimestamp()});status("Cloud synced · "+new Date().toLocaleTimeString()); }
  catch(e){console.error("WalletZen cloud write failed",e);status("Sync paused · local data is safe");}
 },800);
}
window.WalletZenCloud={queueSync};
window.openWalletZenAccount=()=>{if($("accountModal"))$("accountModal").classList.add("open");message("");};
window.closeAccountModal=()=>{if($("accountModal"))$("accountModal").classList.remove("open");};
window.walletZenEmailAction=async action=>{
 if(!auth){message("Firebase is not configured. Add your Firebase web settings in firebase-config.js first.","error");return;}
 const email=($("authEmail")?.value||"").trim(), password=$("authPassword")?.value||"";
 if(!email||!password){message("Enter your email and password.","error");return;}
 if(password.length<6){message("Password must be at least 6 characters.","error");return;}
 try {
  if($("authEmailSubmit"))$("authEmailSubmit").disabled=true;
  if(action==="signup") await sdk.createUserWithEmailAndPassword(auth,email,password);
  else await sdk.signInWithEmailAndPassword(auth,email,password);
  message("Signed in successfully.","success");
 } catch(e){message(friendly(e),"error");}
 finally{if($("authEmailSubmit"))$("authEmailSubmit").disabled=false;}
};
window.walletZenGoogleLogin=async()=>{
 if(!auth){message("Configure Firebase first in firebase-config.js.","error");return;}
 try{await sdk.signInWithPopup(auth,new sdk.GoogleAuthProvider());message("Google sign-in successful.","success");}
 catch(e){message(friendly(e),"error");}
};
window.walletZenResetPassword=async()=>{
 if(!auth){message("Configure Firebase first.","error");return;}
 const email=($("authEmail")?.value||"").trim();
 if(!email){message("Enter your email address first.","error");return;}
 try{await sdk.sendPasswordResetEmail(auth,email);message("If the account exists, a reset email has been sent.","success");}
 catch(e){message(friendly(e),"error");}
};
window.walletZenSyncNow=syncNow;
window.walletZenSignOut=async()=>{try{if(auth)await sdk.signOut(auth);message("Logged out. Local data remains on this device.","success");}catch(e){message(friendly(e),"error");}};
async function init() {
 if(!isFirebaseConfigured()){status("Local-only mode · configure Firebase for cloud sync");if($("accountButton"))$("accountButton").textContent="Set up cloud";return;}
 try {
  const appSdk=await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js");
  const authSdk=await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js");
  const storeSdk=await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js");
  sdk={...authSdk,...storeSdk};const app=appSdk.initializeApp(firebaseConfig);
  auth=sdk.getAuth(app);db=sdk.getFirestore(app);
  sdk.onAuthStateChanged(auth,async u=>{userUI(u);if(u){await syncNow();message("Account ready. Your data will sync when connected.","success");}});
 } catch(e){console.error("Firebase initialization failed",e);status("Firebase unavailable · local data is safe");}
}
document.addEventListener("DOMContentLoaded",init);
