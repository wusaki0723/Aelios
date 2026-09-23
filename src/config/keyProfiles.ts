import type { KeyProfile } from "../types";

export const KEY_PROFILES = {
  chatbox: {
    source: "chatbox",
    namespace: "default",
    scopes: ["chat:proxy", "memory:read", "memory:write", "cache:read", "cache:write"],
    allowModelPassthrough: false,
    debug: false,
    chooseNamespace: true
  },
  im: {
    source: "im",
    namespace: "default",
    scopes: ["chat:proxy", "memory:read", "memory:write", "cache:read"],
    allowModelPassthrough: false,
    debug: false,
    chooseNamespace: false
  },
  debug: {
    source: "debug",
    namespace: "default",
    scopes: ["chat:proxy", "memory:read", "memory:write", "cache:read", "cache:write", "debug:read", "export:read"],
    allowModelPassthrough: true,
    debug: true,
    chooseNamespace: true
  },
  mcp: {
    source: "mcp",
    namespace: "default",
    scopes: ["memory:read", "memory:write", "export:read"],
    allowModelPassthrough: false,
    debug: false,
    chooseNamespace: false
  },
  guideDog: {
    source: "guide-dog",
    namespace: "default",
    scopes: ["chat:proxy"],
    allowModelPassthrough: false,
    debug: false,
    chooseNamespace: false
  }
} satisfies Record<string, KeyProfile>;
