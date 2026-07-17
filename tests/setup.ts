import "@testing-library/jest-dom/vitest";
import { vi, beforeEach } from "vitest";

// Provide env vars consumed via import.meta.env
Object.assign((import.meta as any).env, {
  VITE_SUPABASE_URL: "https://example.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
  VITE_SUPABASE_PROJECT_ID: "test",
});

// jsdom URL helpers used by csv.downloadCSV
if (!URL.createObjectURL) {
  Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:mock") });
}
if (!URL.revokeObjectURL) {
  Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn() });
}

// Reset fetch + supabase mock between tests
beforeEach(() => {
  globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as never;
});

// Mock TanStack Start server functions for unit tests
vi.mock("@tanstack/react-start", () => {
  const createServerFn = () => {
    const fn: any = vi.fn(async (args: any) => {
      if (fn._handler) {
        return fn._handler({
          data: args?.data,
          context: { userId: (globalThis as any).__test_user_id || "test-user-id" },
        });
      }
      return {};
    });
    fn.middleware = () => fn;
    fn.inputValidator = () => fn;
    fn.handler = (handler: any) => {
      fn._handler = handler;
      return fn;
    };
    return fn;
  };

  return {
    createServerFn,
    createMiddleware: () => {
      const middlewareObj = {
        server: (handler: any) => {
          return {
            handler,
            ...middlewareObj,
          };
        },
      };
      return middlewareObj;
    },
    useServerFn: (fn: any) => fn,
  };
});

// Mock database query operations for unit tests to bridge with mockSupabase
vi.mock("@/integrations/postgres/query.server", () => {
  const withUser = async (userId: string, fn: (client: any) => Promise<any>) => {
    const client = {
      query: async (sql: string, params?: any[]) => {
        const sqlUpper = sql.toUpperCase();
        const sqlTrimmed = sqlUpper.trim();
        let op: "select" | "insert" | "update" | "delete" | "rpc" = "select";
        let table = "unknown";

        // Check if it's an RPC/function call
        const rpcMatch = sql.match(/SELECT\s+public\.([a-zA-Z0-9_]+)/i);
        if (rpcMatch) {
          const rpcName = rpcMatch[1];
          const { mockSupabase } = await import("./mocks/supabase");
          mockSupabase.calls.rpc.push(rpcName);
          mockSupabase.calls.ops.push({ op: "rpc", table: rpcName, payload: params });

          const queuedResponse = (mockSupabase as any).queues.rpc.shift();
          if (queuedResponse?.error) {
            throw new Error(queuedResponse.error.message);
          }
          return {
            rows: [{ [rpcName]: queuedResponse?.data ?? null }],
          };
        }

        const tableMatch = sql.match(/(?:FROM|INSERT\s+INTO|UPDATE)\s+public\.([a-zA-Z0-9_]+)/i);
        if (tableMatch) {
          table = tableMatch[1];
        }

        if (sqlTrimmed.startsWith("INSERT")) {
          op = "insert";
        } else if (sqlTrimmed.startsWith("UPDATE")) {
          op = "update";
        } else if (sqlTrimmed.startsWith("DELETE")) {
          op = "delete";
        } else {
          op = "select";
        }

        let payload: any = params;
        if (params && Array.isArray(params)) {
          if (table === "comment_mentions") {
            const [commentId, mentions] = params;
            payload = (mentions ?? []).map((m: string) => ({ comment_id: commentId, mentioned_user_id: m }));
          } else if (sqlUpper.includes("UPDATE")) {
            const setPartMatch = sql.match(/SET\s+([\s\S]+?)\s+WHERE/i);
            if (setPartMatch) {
              const setPart = setPartMatch[1];
              const parts = setPart.split(",");
              payload = {};
              parts.forEach((p) => {
                const match = p.match(/"?([a-zA-Z0-9_]+)"?\s*=\s*(.+)/);
                if (match) {
                  const colName = match[1].trim();
                  const valStr = match[2].trim();
                  if (valStr.startsWith("$")) {
                    const paramIdx = parseInt(valStr.replace("$", ""), 10) - 1;
                    payload[colName] = params[paramIdx];
                  } else {
                    if ((valStr.startsWith("'") && valStr.endsWith("'")) || (valStr.startsWith('"') && valStr.endsWith('"'))) {
                      payload[colName] = valStr.substring(1, valStr.length - 1);
                    } else {
                      payload[colName] = valStr;
                    }
                  }
                }
              });
            }
          } else if (sqlUpper.includes("INSERT")) {
            const colsMatch = sql.match(/INSERT\s+INTO\s+\S+\s*\(([\s\S]+?)\)\s*VALUES/i);
            if (colsMatch) {
              const cols = colsMatch[1].split(",").map((c: string) => c.replace(/"/g, "").trim());
              payload = {};
              cols.forEach((colName: string, idx: number) => {
                payload[colName] = params[idx];
              });
            }
          }
        }

        const { mockSupabase } = await import("./mocks/supabase");
        mockSupabase.calls.from.push(table);
        mockSupabase.calls.ops.push({ op, table, payload });

        const queuedResponse = (mockSupabase as any).queues[op].shift();
        console.log("QUERY MOCK RUN:", { op, table, sql, queuedResponse });
        if (queuedResponse?.error) {
          throw new Error(queuedResponse.error.message);
        }

        let data = queuedResponse?.data;
        if (Array.isArray(data)) {
          data.forEach((row) => {
            if (row && row.comment_mentions && !row.mentions) {
              row.mentions = row.comment_mentions.map((m: any) => m.mentioned_user_id);
            }
          });
        } else if (data && data.comment_mentions && !data.mentions) {
          data.mentions = data.comment_mentions.map((m: any) => m.mentioned_user_id);
        }

        return {
          rows: Array.isArray(data) ? data : (data ? [data] : []),
        };
      },
    };
    return fn(client);
  };

  return {
    withUser,
    selectAsUser: async (userId: string, sql: string, params?: any[]) => {
      const { mockSupabase } = await import("./mocks/supabase");
      const queuedResponse = (mockSupabase as any).queues.select.shift();
      if (queuedResponse?.error) throw new Error(queuedResponse.error.message);
      return queuedResponse?.data ?? [];
    },
  };
});



