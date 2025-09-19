/* app.js - shared JS for all pages
   IMPORTANT: paste your Firebase config into firebaseConfig below.
   Uses Firebase Realtime Database + Auth via CDN.
   Also relies on Chart.js (chart pages include the CDN)
*/

/* ---- Load Firebase SDKs dynamically so we keep html files simple ---- */
(function loadFirebase(){
  const base = "https://www.gstatic.com/firebasejs/9.22.2/";
  const scripts = [
    base + "firebase-app-compat.js", // compat makes it easier for vanilla usage
    base + "firebase-auth-compat.js",
    base + "firebase-database-compat.js",
    // storage not used here but you can add firebase-storage-compat.js
  ];
  for(const s of scripts){
    const el = document.createElement('script'); el.src=s; el.defer=true; document.head.appendChild(el);
  }
})();

/* ---- App namespace ---- */
const app = (function(){
  // PLACEHOLDER: put your Firebase config here. DO NOT commit keys publicly.
  const firebaseConfig = {
    apiKey: "PASTE_YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
    projectId: "YOUR_PROJECT",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "...",
    appId: "..."
  };

  // internal state
  let firebaseInitialized = false;
  let authReadyCallbacks = [];
  let currentUser = null;

  async function initOnce(){
    if(window.firebase && !firebaseInitialized){
      firebase.initializeApp(firebaseConfig);
      firebaseInitialized = true;
      firebase.auth().onAuthStateChanged(user => {
        currentUser = user;
        // call callbacks
        authReadyCallbacks.forEach(cb=>cb(user));
        // clear one-time callbacks after firing
        authReadyCallbacks = [];
      });
    }
  }

  // utilities for waiting until firebase scripts loaded
  function whenFirebaseLoaded(){
    return new Promise((resolve)=>{
      const max=5000; const t0=Date.now();
      (function check(){
        if(window.firebase){
          initOnce().then(()=>resolve());
        } else if(Date.now()-t0 > max){
          console.error("Firebase SDK not loaded. Make sure internet available.");
          resolve(); // still resolve to avoid hang
        } else setTimeout(check,100);
      })();
    });
  }

  // auth functions
  async function authSignIn(email,pw){
    await whenFirebaseLoaded();
    try{
      await firebase.auth().signInWithEmailAndPassword(email,pw);
      location.href = 'dashboard.html';
    }catch(e){ alert('Login error: '+e.message) }
  }
  async function authSignUp(email,pw){
    await whenFirebaseLoaded();
    try{
      const cred = await firebase.auth().createUserWithEmailAndPassword(email,pw);
      // create user profile placeholder
      const uid = cred.user.uid;
      await firebase.database().ref('users/'+uid).set({ createdAt: Date.now() });
      location.href = 'user_info.html';
    }catch(e){ alert('Signup error: '+e.message) }
  }
  function signOut(){ firebase.auth().signOut(); location.href='index.html'; }

  function onAuthReady(cb){
    authReadyCallbacks.push(cb);
    // if currentUser known, call immediately
    if(currentUser) cb(currentUser);
  }

  // save/load user profile
  async function saveUserProfile(data){
    await whenFirebaseLoaded();
    if(!firebase.auth().currentUser) { return {error:true,message:'Not signed in'}; }
    const uid = firebase.auth().currentUser.uid;
    await firebase.database().ref('users/'+uid).update(data);
    return {message:'Profile saved'};
  }
  async function loadUserProfile(){
    await whenFirebaseLoaded();
    if(!firebase.auth().currentUser) return null;
    const uid = firebase.auth().currentUser.uid;
    const snap = await firebase.database().ref('users/'+uid).get();
    return snap.exists()? snap.val() : null;
  }

  // create placeholders for stables/horses
  async function createPlaceholders(numStables, numHorses, male, female){
    await whenFirebaseLoaded();
    if(!firebase.auth().currentUser) return {error:true,message:'Sign in first'};
    const uid = firebase.auth().currentUser.uid;
    // create stable entries
    const stablesRef = firebase.database().ref('stables');
    const horsesRef = firebase.database().ref('horses');
    const updates = {};
    for(let i=1;i<=numStables;i++){
      const sid = `stable${i}_${Date.now().toString().slice(-4)}`;
      updates[`stables/${sid}`] = { name:`Stable ${i}`, location:'Unknown', sensors:{temperature:0,humidity:0,h2s:0}, horses:{} };
    }
    // horses: distribute among stables
    const stableIds = Object.keys(updates).map(k=>{
      const path=k.split('/')[1];
      return path;
    });
    for(let j=1;j<=numHorses;j++){
      const hid = `horse${j}_${Date.now().toString().slice(-4)}`;
      const st = stableIds[(j-1) % stableIds.length];
      const sex = j <= male ? 'male' : 'female';
      updates[`horses/${hid}`] = {
        name: `Horse ${j}`,
        age: Math.floor(Math.random()*10)+2,
        sex,
        breed:'',
        height:null,weight:null,
        todayFoodKg:0,todayWaterL:0,
        temp:null,heartRate:null,
        locationStable: st
      };
      updates[`stables/${st}/horses/${hid}`] = true;
    }
    await firebase.database().ref().update(updates);
    return {message:'Placeholders created'};
  }

  // data getters
  async function getAllStables(){
    await whenFirebaseLoaded();
    const snap = await firebase.database().ref('stables').get();
    return snap.exists()? snap.val() : {};
  }
  async function getAllHorses(){
    await whenFirebaseLoaded();
    const snap = await firebase.database().ref('horses').get();
    return snap.exists()? snap.val() : {};
  }
  async function getHorse(id){
    await whenFirebaseLoaded();
    const snap = await firebase.database().ref('horses/'+id).get();
    return snap.exists()? snap.val() : {};
  }

  // history helpers (these functions are simplified; adapt to your stored history format)
  async function getHorseDailyHistory(horseId){
    // return { labels: [...], food: [...], water: [...], temp: [...], hr: [...] }
    await whenFirebaseLoaded();
    // naive: read last 7 days from horses/<id>/history
    const snap = await firebase.database().ref(`horses/${horseId}/history`).get();
    const data = snap.exists()? snap.val() : {};
    const labels=[],food=[],water=[],temp=[],hr=[];
    const keys = Object.keys(data||{}).sort(); // dates
    keys.slice(-7).forEach(k=>{
      labels.push(k);
      const d = data[k] || {};
      food.push(d.foodKg || 0);
      water.push(d.waterL || 0);
      temp.push(d.avgTemp || 0);
      hr.push(d.avgHR || 0);
    });
    // if empty, push placeholders
    if(!labels.length){
      for(let i=6;i>=0;i--){
        const d = new Date(); d.setDate(d.getDate()-i);
        labels.push(d.toISOString().slice(0,10));
        food.push(0); water.push(0); temp.push(0); hr.push(0);
      }
    }
    return {labels,food,water,temp,hr};
  }
  async function getHorseWeeklyHistory(horseId){
    // alias to daily for now
    return getHorseDailyHistory(horseId);
  }

  // Alerts: a basic pattern - writes to /alerts when value out of expected range.
  // Simulated listen functions:
  function listenAlerts(cb){
    // listens to global alerts list
    whenFirebaseLoaded().then(()=>{
      firebase.database().ref('alerts').limitToLast(20).on('child_added',snap=>{
        cb(snap.val());
      });
    });
  }
  function listenStableAlerts(stableId, cb){
    // listen to alerts filtered by stableId
    whenFirebaseLoaded().then(()=>{
      firebase.database().ref('alerts').orderByChild('stableId').equalTo(stableId).limitToLast(10).on('child_added',snap=>{
        cb(snap.val());
      });
    });
  }

  // helpers to insert an alert (used by backend/cloud functions or test)
  async function pushAlert(obj){
    await whenFirebaseLoaded();
    const ref = firebase.database().ref('alerts').push();
    obj.time = Date.now();
    await ref.set(obj);
  }

  // quick signIn check function
  async function authCheckAndRedirect(){
    await whenFirebaseLoaded();
    const user = firebase.auth().currentUser;
    if(!user) location.href='index.html';
  }

  // convenience: wait for auth and then resolve
  function ensureAuth(){
    return new Promise((resolve)=>{
      whenFirebaseLoaded().then(()=>{
        firebase.auth().onAuthStateChanged(user=>{
          if(user) resolve(user);
          else location.href='index.html';
        });
      });
    });
  }

  // convenience wrapper to allow pages to call onAuthReady easily
  function onAuthReadyWrapper(cb){
    whenFirebaseLoaded().then(()=>{
      if(firebase.auth().currentUser) cb(firebase.auth().currentUser);
      else {
        firebase.auth().onAuthStateChanged(user=>{
          if(user) cb(user);
          else location.href='index.html';
        });
      }
    });
  }

  // expose public API
  return {
    whenFirebaseLoaded,
    initOnce,
    authSignIn,
    authSignUp,
    signOut,
    onAuthReady: onAuthReadyWrapper,
    onAuthReadyPromise: whenFirebaseLoaded,
    saveUserProfile,
    loadUserProfile,
    createPlaceholders,
    getAllStables,
    getAllHorses,
    getHorse,
    getHorseDailyHistory,
    getHorseWeeklyHistory,
    listenAlerts,
    listenStableAlerts,
    pushAlert,
    authCheckAndRedirect,
    ensureAuth,
    // lightweight wrapper to call from simple pages
    onAuthReady: onAuthReadyWrapper,
    authSignIn: authSignIn,
    authSignUp: authSignUp,
    signOut: signOut
  };
})();
window.app = app; // expose globally for page scripts
