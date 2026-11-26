// @ts-check

/** Private service binding bridge. Only the configured acquisition origin receives requests. */
export default {
  /** @param {Request} request @param {{ACQUISITION_ORIGIN?:string,ACQUISITION_CLIENT_ORIGIN?:string}} env */
  async fetch(request, env) {
    const unavailable = () => Response.json({ ok: false, error: { kind: "ConnectFailed", field: "acquisition-service" } }, { status: 502 });
    let origin;
    try {
      origin = new URL(env.ACQUISITION_ORIGIN ?? "");
      if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) return unavailable();
    } catch {
      return unavailable();
    }
    const incoming = new URL(request.url);
    if (![origin.origin,env.ACQUISITION_CLIENT_ORIGIN].includes(incoming.origin) || incoming.search || !/^\/v1\/operations\/[a-zA-Z0-9_-]{12,80}$/.test(incoming.pathname) || !["POST", "DELETE"].includes(request.method)) {
      return Response.json({ ok: false, error: { kind: "CommandInvalid" } }, { status: 400 });
    }
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) return Response.json({ ok: false, error: { kind: "AuthenticationRequired" } }, { status: 401 });
    try {
      const response = await fetch(new URL(incoming.pathname, origin), {
        method: request.method,
        headers: { authorization, "content-type": "application/json" },
        body: request.body,
        redirect: "manual",
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(35_000)]),
        // Node requires duplex for tests; Workers accepts it as an unused extension.
        ...{ duplex: "half" },
      });
      if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); return unavailable(); }
      if (response.status >= 500 && response.headers.get("content-type")?.split(";")[0].trim() !== "application/json") { await response.body?.cancel(); return unavailable(); }
      return response;
    } catch {
      return unavailable();
    }
  },
};
