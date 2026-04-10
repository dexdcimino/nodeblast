// ══════════════════════════════════════════════════════
//  NodeBlast — FIREBASE CONFIG
//  Auto-switches between dev (localhost) and prod (Vercel)
// ══════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js";

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);

const prodConfig = {
  apiKey:            "AIzaSyCU7xuhuILTkbdcP-E2qBH3EnNKT_eWTjA",
  authDomain:        "dexnote-d7047.firebaseapp.com",
  projectId:         "dexnote-d7047",
  storageBucket:     "dexnote-d7047.firebasestorage.app",
  messagingSenderId: "537524975579",
  appId:             "1:537524975579:web:a44597ea812025c7b6da8f"
};

const devConfig = {
  apiKey:            "AIzaSyCxzld2pcXmOJq7w_vtcbg8Jn4htSdF9fU",
  authDomain:        "dexnote-dev.firebaseapp.com",
  databaseURL:       "https://dexnote-dev-default-rtdb.firebaseio.com",
  projectId:         "dexnote-dev",
  storageBucket:     "dexnote-dev.firebasestorage.app",
  messagingSenderId: "338857472728",
  appId:             "1:338857472728:web:8d91dd15dea38f26df1dad",
  measurementId:     "G-R6VK3WE7D8"
};

const app = initializeApp(isLocal ? devConfig : prodConfig);
export { app, isLocal };
