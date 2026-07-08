import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { auth as keycloakAuth } from '../backend/auth';

export function isSelfHosted(): boolean {
  if (typeof process !== 'undefined' && process.env && process.env.BACKEND_MODE) {
    return process.env.BACKEND_MODE === 'self';
  }
  if (import.meta.env) {
    if (import.meta.env.VITE_BACKEND_MODE) {
      return import.meta.env.VITE_BACKEND_MODE === 'self';
    }
    if (import.meta.env.BACKEND_MODE) {
      return import.meta.env.BACKEND_MODE === 'self';
    }
  }
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    const isLovable = hostname.endsWith('.lovable.app') || 
                     hostname.endsWith('.zite.so') || 
                     hostname.endsWith('.lovable.dev');
    if (isLovable) {
      return false;
    }
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return true;
    }
  }
  return false;
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
        if (typeof window !== 'undefined') {
          if (isSelfHosted()) {
            const token = window.localStorage.getItem("kc_token");
            if (token) {
              console.log("Supabase Fetch Interceptor attaching token:", token);
              options = options || {};
              if (!options.headers) {
                options.headers = {};
              }
              if (options.headers instanceof Headers) {
                options.headers.set("Authorization", `Bearer ${token}`);
              } else if (Array.isArray(options.headers)) {
                options.headers = [...options.headers, ["Authorization", `Bearer ${token}`]];
              } else {
                options.headers = {
                  ...options.headers,
                  Authorization: `Bearer ${token}`,
                };
              }
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
    const isSelf = isSelfHosted();

    if (prop === "auth") {
      if (isSelf) {
        return keycloakAuth;
      }
    }
    if (prop === "channel") {
      if (isSelf) {
        return (channelName: string) => {
          const mockChannel = {
            on: () => mockChannel,
            subscribe: () => mockChannel,
            unsubscribe: () => {},
            presenceState: () => ({}),
            send: async () => ({ status: "ok" }),
            track: async () => ({ status: "ok" }),
            untrack: async () => ({ status: "ok" }),
          };
          return mockChannel;
        };
      }
    }
    if (prop === "removeChannel") {
      if (isSelf) {
        return () => {};
      }
    }
    if (!_supabase) _supabase = createSupabaseClient();
    return Reflect.get(_supabase, prop, receiver);
  },
});

