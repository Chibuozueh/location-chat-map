import { Toaster } from "@/components/ui/sonner";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
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

// Fire-and-forget side-effect import for the platform client. Loaded
// asynchronously so it cannot block render.
void import("@vly-ai/integrations").catch((err) => {
  console.warn(
    "[atlas] @vly-ai/integrations failed to load, continuing without it:",
    err,
  );
});

// Simple loading fallback — visible so unconditional suspensions anywhere
// in the tree commit something usable to the DOM instead of leaving it
// blank. With React 18 + createRoot, any child component throwing a
// Promise (a Suspense throw) without a <Suspense> ancestor will silently
// abort the entire commit, so we wrap the whole <AppRoot /> in a
// top-level <Suspense> with this fallback as a guarantee.
function RouteLoading() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#FAF8F5",
        color: "#7f1d1d",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: "14px",
      }}
    >
      Loading Atlas…
    </div>
  );
}

/** Silent error boundary — if VlyToolbar crashes it renders nothing. */
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
 *  cannot itself crash on a non-Error throw and wipe the DOM. */
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
      <ToolbarErrorBoundary>
        <VlyToolbar />
      </ToolbarErrorBoundary>
      <ConvexAuthProvider client={convex}>
        <BrowserRouter>
          <RouteSyncer />
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<LandingRoute />} />
              <Route path="/auth" element={<AuthPage redirectAfterAuth="/" />} />
              <Route
                path="*"
                element={<NotFound />}
              />
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
// `_leaflet_id` from the DOM container on cleanup, which causes "Map
// container is already initialized." when React double-invokes the
// layout effect in StrictMode dev.
const isProd = import.meta.env.PROD;

const rootEl = document.getElementById("root");
if (!rootEl) {
  document.body.innerHTML =
    '<div style="position:fixed;inset:0;padding:32px;background:#fff1f2;color:#7f1d1d;font:14px ui-monospace,monospace;">#root element missing from index.html</div>';
} else {
  try {
    createRoot(rootEl).render(
      // CRITICAL: top-level <Suspense> wraps the entire AppRoot so any
      // descendant that throws a Promise (ConvexAuthProvider, a lazy
      // module load, Convex useQuery, …) commits SOMETHING to the DOM
      // — the visible RouteLoading fallback — instead of silently
      // wiping the commit. This is THE previous regression: React 18
      // createRoot + unhandled suspense = empty #root.
      <Suspense fallback={<RouteLoading />}>
        {isProd ? (
          <StrictMode>
            <AppRoot />
          </StrictMode>
        ) : (
          <AppRoot />
        )}
      </Suspense>,
    );
    // Tag the root so the index.html "did not mount" timer knows React
    // committed at least once and shouldn't show its diagnostic overlay.
    rootEl.setAttribute("data-react-mounted", "1");
  } catch (err) {
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
