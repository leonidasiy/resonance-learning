"use client";

import { useEffect, useRef } from "react";

export default function LegacyApp({ shell }) {
  const container = useRef(null);

  // shortcut: Existing screens mutate #app; remove this bridge as screens move to React.
  useEffect(() => {
    if (!container.current || container.current.hasChildNodes()) return;
    container.current.innerHTML = shell;
    const script = document.createElement("script");
    script.type = "module";
    script.src = "/src/app.js";
    document.body.append(script);
  }, [shell]);

  return <>
    <main id="main-content" className="loading-screen next-loading" role="status" aria-live="polite" aria-busy="true">
      Opening your workspace…
    </main>
    <div ref={container} />
  </>;
}
