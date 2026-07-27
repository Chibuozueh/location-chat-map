import '@vly-ai/integrations';
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

// Simple loading fallback for route transitions
function RouteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}

/** Silent error boundary — if VlyToolbar crashes it renders nothing instead of
 *  crashing the whole app (e.g. hook errors in WebContainer environment). */
class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: Error) {
    console.warn("[VlyToolbar] Caught error, toolbar disabled:", err.message);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/** Hard guard so runtime errors never leave the preview as a blank page.
 *  Uses SOLID inline colors so the error UI is always visible regardless of
 *  whether the theme CSS has loaded. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
      stack: error.stack || "",
    };
  }
  componentDidCatch(err: Error) {
    console.error("[WebContainer preview] Root crash:", err);
  }
  render() {
    if (this.state.hasError) {
      // Inline styles guarantee visibility even if Tailwind/theme CSS hasn't
      // loaded or resolves to near-white-on-white colors.
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

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

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

createRoot(document.getElementById("root")!).render(
  isProd ? (
    <StrictMode>
      <AppRoot />
    </StrictMode>
  ) : (
    <AppRoot />
  ),
);
