import { initializeApp, cert, getApps, getApp } from "firebase-admin/app";
import { createRequire } from "module";

let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  const require = createRequire(import.meta.url);
  serviceAccount = require("../config/firebase-service-account.json");
}

const app = getApps().length
  ? getApp()
  : initializeApp({
      credential: cert(serviceAccount)
    });

export default app;