import { Toaster } from "@/components/ui/sonner";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import "./index.css";

// Landing is the root route — eager-import it so the dev server cannot fall
// back to a dynamic-import that the proxy occasionally fails to ship. AuthPage
// and NotFound stay lazy because they aren't on the cold path.
import LandingRoute from "./pages/Landing.tsx";
const AuthPage = lazy(() => import("./pages/Auth.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

// ---- Detach volatile platform integrations from the synchronous module
// graph so a 502 / timeout on the proxy cannot block React from ever
// mounting. Two things previously hung or were silently swallowed here:
//
//   1. `import '@vly-ai/integrations'` — a side-effect-only dependency
//      whose module evaluation could hang or 502. Module-load failures
//      fire the `error` event on the <script> tag (and ONLY there),
//      bypassing window.onerror / onunhandledrejection — which is why
//      every diagnostic we added before looked blank.
//
//   2. `import { VlyToolbar } from "../vly-toolbar-readonly.tsx"` — this
//      file pulls framer-motion, zumer/snapdom, and runtime svg/iframe
//      generation. If the upstream daemon is wedged or the dev-server
//      can't transform it, the topo-await around `<VlyToolbar />`
//      leaves #root permenantly empty.
//
// Both are now loaded asynchronously, with a try/catch + Suspense fallback
// wrapper so a stalled or refused fetch falls through to a working app.

// Fire-and-forget side-effect import. We don't `await` it so it can never
// block the rest of the entry script. If it errors, we log and continue.
// The original `import '@vly-ai/integrations'` is removed entirely —
// the platform integration is best-effort, not part of the render path.
void import("@vly-ai/integrations").catch((err) => {
  console.warn(
    "[atlas] @vly-ai/integrations failed to load, continuing without it:",
    err,
  );
});

// Lazy wrapper around VlyToolbar. Catches module-load failures and
// resolves to a no-op component so a hung or 502 toolbar cannot blank the
// whole tree.
const VlyToolbar = lazy(async () => {
  try {
    const mod = await import("../vly-toolbar-readonly.tsx");
    return { default: (mod as { VlyToolbar: React.ComponentType })
      .VlyToolbar ?? (() => null) };
  } catch (err) {
    console.warn("[atlas] VlyToolbar failed to load, hiding toolbar:", err);
    return { default: () => null };
  }
});

// Simple loading fallback for route transitions
function RouteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}

/** Silent error boundary — if VlyToolbar crashes it renders nothing instead of
 *  crashing the whole app. */
class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch() {
    // intentionally no-op — silent recovery
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/** Hard guard so runtime errors never leave the preview as a blank page.
 *
 *  Defensive `getDerivedStateFromError(error: unknown)` so the boundary
 *  cannot itself crash on a non-Error throw. Uses SOLID inline colors for
 *  the error UI so it's always visible regardless of the theme loading. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: unknown) {
    let message = "Unknown runtime error";
    let stack = "";
    if (error instanceof Error) {
      message = error.message || message;
      stack = error.stack || "";
    } else if (typeof error === "string") {
      message = error;
    } else if (error && typeof error === "object") {
      try {
        message =
          (error as { message?: unknown }).message
            ? String((error as { message: unknown }).message)
            : JSON.stringify(error);
      } catch {
        message = "Non-serializable thrown value";
      }
    } else if (error !== undefined && error !== null) {
      message = String(error);
    }
    return { hasError: true, message, stack };
  }
  componentDidCatch(error: unknown) {
    try {
      console.error("[WebContainer preview] Root crash:", error);
    } catch {
      /* ignore */
    }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 999999,
            overflow: "auto",
            padding: "32px",
            background: "#fff1f2",
            color: "#7f1d1d",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontSize: "14px",
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          <strong style={{ color: "#7f1d1d" }}>Preview runtime error</strong>
          {"\n\n"}
          {this.state.message}
          {this.state.stack && (
            <>
              {"\n\n----\n"}
              <span style={{ color: "#6b7280" }}>{this.state.stack}</span>
            </>
          )}
          {"\n\n----\n"}
          <a
            href="/"
            style={{ color: "#7f1d1d", textDecoration: "underline" }}
          >
            Reload the page
          </a>{" "}
          after fixing the underlying error.
        </div>
      );
    }
    return this.props.children;
  }
}

const convex = new ConvexReactClient(
  (import.meta.env.VITE_CONVEX_URL as string) || "https://placeholder.invalid",
);

function AppRoot() {
  return (
    <RootErrorBoundary>
      {/* VlyToolbar is wrapped in its own Suspense because it's lazy and
          must never be allowed to suspend the rest of the render tree. */}
      <Suspense fallback={null}>
        <ToolbarErrorBoundary>
          <VlyToolbar />
        </ToolbarErrorBoundary>
      </Suspense>
      <ConvexAuthProvider client={convex}>
        <BrowserRouter>
          <RouteSyncer />
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<LandingRoute />} />
              <Route path="/auth" element={<AuthPage redirectAfterAuth="/" />} /> {/* TODO: change redirect after auth to correct page */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster />
      </ConvexAuthProvider>
    </RootErrorBoundary>
  );
}

function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}

// NOTE: <StrictMode> is intentionally disabled in development because
// react-leaflet@4.2.1's `MapContainer` does not clear the Leaflet
// `_leaflet_id` from the DOM container on cleanup, which causes
// "Map container is already initialized." when React double-invokes the
// layout effect in StrictMode dev. We still wrap in StrictMode in
// production to keep the dev-safety net for the rest of the app.
const isProd = import.meta.env.PROD;

const rootEl = document.getElementById("root");
if (!rootEl) {
  document.body.innerHTML =
    '<div style="position:fixed;inset:0;padding:32px;background:#fff1f2;color:#7f1d1d;font:14px ui-monospace,monospace;">#root element missing from index.html</div>';
} else {
  try {
    createRoot(rootEl).render(
      isProd ? (
        <StrictMode>
          <AppRoot />
        </StrictMode>
      ) : (
        <AppRoot />
      ),
    );
    // Tag the root so the index.html "did not mount" timer knows React
    // committed at least once and shouldn't show its diagnostic overlay.
    rootEl.setAttribute("data-react-mounted", "1");
  } catch (err) {
    // createRoot or sync render threw — write directly to root so the
    // user sees the actual exception instead of a blank page.
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack || "" : "";
    rootEl.innerHTML =
      '<div style="position:fixed;inset:0;overflow:auto;padding:32px;background:#fff1f2;color:#7f1d1d;font:14px ui-monospace,monospace;white-space:pre-wrap;word-break:break-word;">' +
      "<strong>createRoot / render threw:</strong>\n\n" +
      message +
      (stack ? "\n\n----\n" + stack : "") +
      "</div>";
  }
}
