"use client";

import { useEffect } from "react";

/** Static export cannot use server redirect(); client bounce for / */
export default function Home() {
  useEffect(() => {
    window.location.replace("/setup");
  }, []);
  return (
    <main style={{ fontFamily: "system-ui", padding: 24 }}>
      <p>Redirecting…</p>
      <p>
        <a href="/setup">Setup</a> · <a href="/login">Login</a> · <a href="/chat">Chat</a>
      </p>
    </main>
  );
}
