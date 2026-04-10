import { initializeApp } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js";
import { prodConfig, devConfig } from "./firebase-config.local.js";

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);

const app = initializeApp(isLocal ? devConfig : prodConfig);
export { app, isLocal };
