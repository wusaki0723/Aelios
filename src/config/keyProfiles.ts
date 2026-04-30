import type { KeyProfile } from "../types";

export const KEY_PROFILES = {
  chatbox: {
    source: "chatbox",
    namespace: "default",
    scopes: ["chat:proxy", "memory:read", "memory:write", "cache:read", "cache:write"],
    injectionMode: "rag",
    memoryMode: "external",
    allowModelPassthrough: false,
    debug: false
  },
  im: {
    source: "im",
    namespace: "default",
    scopes: ["chat:proxy", "memory:read", "memory:write", "cache:read"],
    injectionMode: "rag",
    memoryMode: "external",
    allowModelPassthrough: false,
    debug: false
  },
  debug: {
    source: "debug",
    namespace: "default",
    scopes: ["chat:proxy", "memory:read", "memory:write", "cache:read", "cache:write", "debug:read"],
    injectionMode: "full",
    memoryMode: "hybrid",
    allowModelPassthrough: true,
    debug: true
  },
  mcp: {
    source: "mcp",
    namespace: "default",
    scopes: ["memory:read", "memory:write"],
    injectionMode: "none",
    memoryMode: "builtin",
    allowModelPassthrough: false,
    debug: false
  },
  guideDog: {
    source: "guide-dog",
    namespace: "default",
    scopes: ["chat:proxy"],
    injectionMode: "none",
    memoryMode: "none",
    allowModelPassthrough: false,
    debug: false
  }
} satisfies Record<string, KeyProfile>;
