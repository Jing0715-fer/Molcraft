"use client";

import { useEffect, useState } from "react";
import type { MolstarGlobal } from "@/lib/molstar/types";

/**
 * Loads the prebuilt Molstar bundle (`/molstar.js`) and exposes the
 * `window.molstar` global. The bundle is an IIFE that assigns to
 * `window.molstar`, so we just inject a <script> tag and wait.
 */
export function useMolstarLoader() {
  const [molstar, setMolstar] = useState<MolstarGlobal | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let script: HTMLScriptElement | null = null;

    function check() {
      if (cancelled) return;
      if (typeof window === "undefined") return;
      const m = window.molstar;
      if (m && m.Viewer) {
        setMolstar(m);
        return true;
      }
      return false;
    }

    if (check()) return;

    script = document.createElement("script");
    script.src = "/molstar.js";
    script.async = true;
    script.onload = () => {
      // Give the IIFE a tick to assign the global.
      setTimeout(() => {
        if (!check()) {
          setError("Molstar bundle loaded but global not found");
        }
      }, 50);
    };
    script.onerror = () => setError("Failed to load /molstar.js");
    document.head.appendChild(script);

    return () => {
      cancelled = true;
      if (script && script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, []);

  return { molstar, error };
}
