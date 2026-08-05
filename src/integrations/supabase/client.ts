import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { auth as keycloakAuth } from '../backend/auth';
import { subscribeToLocalTaskChanges } from '@/lib/task-events';

function createRealtimeChannel(name: string) {
  const listeners: Array<(payload: any) => void> = [];

  return {
    on(event: string, filterConfig: any, callback: (payload: any) => void) {
      listeners.push(callback);
      return this;
    },
    subscribe(statusCallback?: (status: string) => void) {
      const unsubscribe = subscribeToLocalTaskChanges(() => {
        listeners.forEach((cb) => cb({ eventType: "UPDATE", table: "tasks", timestamp: Date.now() }));
      });

      if (statusCallback) {
        setTimeout(() => statusCallback("SUBSCRIBED"), 0);
      }

      return {
        unsubscribe() {
          unsubscribe();
        },
      };
    },
    unsubscribe() {
      // noop
    },
  };
}

function createSupabaseClient() {
  // Use import.meta.env for client-side (Vite build-time replacement)
  // Fall back to process.env for SSR (server-side rendering)
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    const missing = [
      ...(!SUPABASE_URL ? ['SUPABASE_URL'] : []),
      ...(!SUPABASE_PUBLISHABLE_KEY ? ['SUPABASE_PUBLISHABLE_KEY'] : []),
    ];
    const message = `Missing Supabase environment variable(s): ${missing.join(', ')}. Connect Supabase in Lovable Cloud.`;
    console.error(`[Supabase] ${message}`);
    throw new Error(message);
  }

  return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storage: typeof window !== 'undefined' ? localStorage : undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      fetch: (url, options) => {
        options = options || {};
        if (!options.headers) {
          options.headers = {};
        }

        // Prevent browser and proxy caching of database queries
        if (options.headers instanceof Headers) {
          options.headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
          options.headers.set("Pragma", "no-cache");
          options.headers.set("Expires", "0");
        } else if (Array.isArray(options.headers)) {
          options.headers = [
            ...options.headers,
            ["Cache-Control", "no-cache, no-store, must-revalidate"],
            ["Pragma", "no-cache"],
            ["Expires", "0"],
          ];
        } else {
          options.headers = {
            ...options.headers,
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
          };
        }

        if (typeof window !== 'undefined') {
          const token = window.localStorage.getItem("kc_token");
          if (token) {
            console.log("Supabase Fetch Interceptor attaching token:", token);
            if (options.headers instanceof Headers) {
              options.headers.set("Authorization", `Bearer ${token}`);
            } else if (Array.isArray(options.headers)) {
              options.headers.push(["Authorization", `Bearer ${token}`]);
            } else {
              options.headers = {
                ...options.headers,
                Authorization: `Bearer ${token}`,
              };
            }
          }
        }
        return fetch(url, options);
      }
    }
  });
}

let _supabase: ReturnType<typeof createSupabaseClient> | undefined;

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";
export const supabase = new Proxy({} as ReturnType<typeof createSupabaseClient>, {
  get(target, prop, receiver) {
    if (prop === "auth") {
      return keycloakAuth;
    }
    if (prop === "channel") {
      return (name: string) => {
        const SUPABASE_KEY =
          (typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY) ||
          (typeof process !== "undefined" && process.env?.SUPABASE_PUBLISHABLE_KEY) ||
          "";
        if (!SUPABASE_KEY || SUPABASE_KEY.includes("placeholder") || SUPABASE_KEY.includes("dummy") || SUPABASE_KEY.includes("local")) {
          return createRealtimeChannel(name);
        }
        if (!_supabase) _supabase = createSupabaseClient();
        return _supabase.channel(name);
      };
    }
    if (!_supabase) _supabase = createSupabaseClient();
    return Reflect.get(_supabase, prop, receiver);
  },
});

