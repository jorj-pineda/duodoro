type Options = { supabaseUrl?: string; socketUrl?: string; development?: boolean; preview?: boolean };

export function browserSecurityHeaders({ supabaseUrl, socketUrl, development = false, preview = false }: Options) {
  const connections = new Set(["'self'"]);
  for (const value of [supabaseUrl, socketUrl]) {
    if (!value) continue;
    let url: URL;
    try { url = new URL(value); } catch { throw new Error("Invalid public connection URL"); }
    if (url.username || url.password || !["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
      throw new Error("Invalid public connection URL");
    }
    const secure = url.protocol === "https:" || url.protocol === "wss:";
    connections.add(`${secure ? "https:" : "http:"}//${url.host}`);
    connections.add(`${secure ? "wss:" : "ws:"}//${url.host}`);
  }
  if (development) { connections.add("ws://localhost:*"); connections.add("ws://127.0.0.1:*"); }
  // Preview-only allowances follow Vercel's documented toolbar requirements.
  // Production does not grant these third-party resource origins.
  if (preview) { connections.add("https://vercel.live"); connections.add("wss://ws-us3.pusher.com"); }
  const directives = [
    "default-src 'self'",
    // Next's static bootstrap and the theme initialization use inline scripts.
    // This baseline restricts external scripts; it is not a nonce-based XSS policy.
    `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""}${preview ? " https://vercel.live" : ""}`,
    `style-src 'self' 'unsafe-inline'${preview ? " https://vercel.live" : ""}`,
    `img-src 'self' data: blob:${preview ? " https://vercel.live https://vercel.com" : ""}`,
    `font-src 'self'${preview ? " https://vercel.live https://assets.vercel.com" : ""}`,
    `connect-src ${[...connections].join(" ")}`,
    "media-src 'self' blob:",
    `frame-src ${preview ? "https://vercel.live" : "'none'"}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
  ];
  return [
    { key: "Content-Security-Policy", value: directives.join("; ") },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ];
}
