import { initializeApp, cert, getApps, getApp } from "firebase-admin/app";
import serviceAccount from "../config/firebase-service-account.json" with { type: "json" };

const app = getApps().length
  ? getApp()
  : initializeApp({
      credential: cert(serviceAccount)
    });

export default app;