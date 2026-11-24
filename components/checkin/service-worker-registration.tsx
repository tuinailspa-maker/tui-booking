"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/checkin" }).catch(() => {
      // The kiosk works without the worker; it only adds installability and an offline screen.
    });
  }, []);
  return null;
}
