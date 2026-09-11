import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext, HeadContent, Scripts, Link, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { auth } from "@/integrations/backend/auth";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import appCss from "../styles.css?url";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1" },
      { title: "Operon" },
      { name: "description", content: "Lightweight execution, analytics, and workload management for operational teams." },
      { name: "theme-color", content: "#4f46e5" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/icon.svg" },
      { rel: "manifest", href: "/manifest.json" },
      { rel: "apple-touch-icon", href: "/icon-192.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: () => (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
      <div className="text-center">
        <h1 className="text-5xl font-bold">404</h1>
        <p className="mt-2 text-muted-foreground">Page not found</p>
        <Link to="/" className="mt-4 inline-block text-primary underline">Go home</Link>
      </div>
    </div>
  ),
  errorComponent: ({ error }) => {
    const isChunkError =
      error?.message?.includes("Failed to fetch dynamically imported module") ||
      error?.message?.includes("Importing a module script failed");

    if (isChunkError && typeof window !== "undefined") {
      if (!sessionStorage.getItem("chunk_reload_attempted")) {
        sessionStorage.setItem("chunk_reload_attempted", "true");
        window.location.reload();
        return null;
      }
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-4">
        <div className="text-center max-w-md">
          <h1 className="text-xl font-semibold">
            {isChunkError ? "A new update is available" : "Something went wrong"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {isChunkError
              ? "Please reload the page to get the latest version."
              : error.message}
          </p>
          {isChunkError && (
            <button
              onClick={() => {
                sessionStorage.removeItem("chunk_reload_attempted");
                window.location.reload();
              }}
              className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Reload Page
            </button>
          )}
        </div>
      </div>
    );
  },
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head><HeadContent /></head>
      <body className="bg-background text-foreground">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

import { useState } from "react";

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  const [initialized, setInitialized] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const { data: { subscription } } = auth.onAuthStateChange(() => {
      setInitialized(true);
      router.invalidate();
      queryClient.invalidateQueries();
    });
    return () => subscription.unsubscribe();
  }, [router, queryClient]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const toastMsg = params.get("toast_message");
      const toastErr = params.get("toast_error");
      if (toastMsg) {
        toast.success(toastMsg);
        params.delete("toast_message");
      }
      if (toastErr) {
        toast.error(toastErr);
        params.delete("toast_error");
      }
      if (toastMsg || toastErr) {
        const newSearch = params.toString();
        const cleanUrl = window.location.pathname + (newSearch ? `?${newSearch}` : "") + window.location.hash;
        window.history.replaceState({}, document.title, cleanUrl);
      }
    }
  }, [router.state.location]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const handlePreloadError = () => {
        if (!sessionStorage.getItem("chunk_reload_attempted")) {
          sessionStorage.setItem("chunk_reload_attempted", "true");
          window.location.reload();
        }
      };
      window.addEventListener("vite:preloadError", handlePreloadError);
      return () => window.removeEventListener("vite:preloadError", handlePreloadError);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      const handleRegister = () => {
        navigator.serviceWorker
          .register("/sw.js")
          .then((registration) => {
            console.log("Service Worker registered with scope:", registration.scope);
          })
          .catch((error) => {
            console.error("Service Worker registration failed:", error);
          });
      };
      
      if (document.readyState === "complete") {
        handleRegister();
      } else {
        window.addEventListener("load", handleRegister);
        return () => window.removeEventListener("load", handleRegister);
      }
    }
  }, []);

  if (!initialized && mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster position="top-right" />
    </QueryClientProvider>
  );
}
