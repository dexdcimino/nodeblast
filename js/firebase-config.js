import { initializeApp } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js";

const isLocal = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';

const prodConfig = {
  apiKey: "AIzaSyAp5t7_4SM_vLSIv-amfGjRSatvZmqHOHs",
  authDomain: "dexnote-d7047.firebaseapp.com",
  projectId: "dexnote-d7047",
  storageBucket: "dexnote-d7047.firebasestorage.app",
  messagingSenderId: "537524975579",
  appId: "1:537524975579:web:a44597ea812025c7b6da8f"
};

const devConfig = {
  apiKey: "AIzaSyAWjkPPSAuyMG9gVfBaBhdesGSBMOmIYDQ",
  authDomain: "dexnote-dev.firebaseapp.com",
  projectId: "dexnote-dev",
  storageBucket: "dexnote-dev.firebasestorage.app",
  messagingSenderId: "477339768",
  appId: "1:477339768:web:placeholder"
};

const app = initializeApp(isLocal ? devConfig : prodConfig);
export { app, isLocal };
