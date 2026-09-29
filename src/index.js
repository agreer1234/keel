/**
 * Keel server: a Cloudflare Worker.
 *
 * Serves the Keel app (./public), stores your goals in a Durable Object,
 * runs the AI coach through the Claude API, and feeds the home screen widget.
 *
 * Routes (all under /api, JSON):
 *   GET    /api/status                 → { app, claimed, coach }       (no auth)
 *   POST   /api/claim  {passcode, examples?}  sets the passcode once  (no auth)
 *   GET    /api/state                  → every goal, habit, recent log, read, season
 *   PUT    /api/doc/:coll/:id          ← one document (JSON body)
 *   DELETE /api/doc/:coll/:id
 *   POST   /api/coach  {prompt}        → { text }   (needs ANTHROPIC_API_KEY secret)
 *   GET    /api/widget?date=YYYY-MM-DD&time=HH:MM → today's summary for the widget
 *
 * Auth: "Authorization: Bearer <passcode>" on everything except status/claim.
 */
import Anthropic from "@anthropic-ai/sdk";
import { DurableObject } from "cloudflare:workers";

const COLLS = new Set(["goals", "habits", "logs", "reads", "meta"]);
const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
const MAX_DOC = 200_000;
const LOG_DAYS = 120;
const COACH_MODEL = "claude-opus-5-5";
// A real key starts with "sk-ant-"; anything else (blank, or a placeholder typed to get
// past the deploy form) means the coach is off.
const hasCoachKey = (env) => typeof env.ANTHROPIC_API_KEY === "string" && env.ANTHROPIC_API_KEY.trim().startsWith("sk-ant-");
const GOAL_COLORS = ["#0A84FF", "#FF375F", "#30D158", "#FF9F0A", "#BF5AF2", "#40C8E0", "#5E5CE6", "#AC8E68"];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Constant-time string comparison for hex digests of equal length.
function sameHash(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const store = env.KEEL.get(env.KEEL.idFromName("main"));
      return store.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};

export class KeelStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\//, "");
    const method = request.method;

    try {
      if (path === "status" && method === "GET") {
        return json({ app: "keel", claimed: !!(await this.ctx.storage.get("auth")), coach: hasCoachKey(this.env) });
      }
      if (path === "claim" && method === "POST") return await this.claim(request);

      // everything below needs the passcode
      const auth = request.headers.get("Authorization") || "";
      const pass = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      const stored = await this.ctx.storage.get("auth");
      if (!stored || !pass || !sameHash(await sha256(pass), stored)) return json({ error: "unauthorized" }, 401);

      if (path === "state" && method === "GET") return json(await this.state());
      if (path === "widget" && method === "GET") return json(await this.widget(url.searchParams));
      if (path === "coach" && method === "POST") return await this.coach(request);

      const m = path.match(/^doc\/([a-z]+)\/([^/]+)$/);
      if (m) {
        const [, coll, id] = m;
        if (!COLLS.has(coll) || !ID_RE.test(id)) return json({ error: "bad path" }, 400);
        const key = `d:${coll}:${id}`;
        if (method === "DELETE") {
          await this.ctx.storage.delete(key);
          return json({ ok: true });
        }
        if (method === "PUT") {
          const body = await request.text();
          if (body.length > MAX_DOC) return json({ error: "document too large" }, 413);
          const data = JSON.parse(body);
          if (!data || typeof data !== "object" || Array.isArray(data)) return json({ error: "body must be an object" }, 400);
          await this.ctx.storage.put(key, data);
          return json({ ok: true });
        }
      }
      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: String(e?.message || e) }, 500);
    }
  }

  async claim(request) {
    if (await this.ctx.storage.get("auth")) return json({ error: "already claimed" }, 409);
    const { passcode, examples } = await request.json();
    if (typeof passcode !== "string" || passcode.length < 6) return json({ error: "passcode too short" }, 400);
    const puts = { auth: await sha256(passcode) };
    // optional example goals so the tour has something to show
    if (Array.isArray(examples)) {
      for (const [coll, id, data] of examples.slice(0, 200)) {
        if (COLLS.has(coll) && ID_RE.test(id) && data && typeof data === "object") puts[`d:${coll}:${id}`] = data;
      }
    }
    // storage.put with an object writes up to 128 keys at a time
    const entries = Object.entries(puts);
    for (let i = 0; i < entries.length; i += 128) await this.ctx.storage.put(Object.fromEntries(entries.slice(i, i + 128)));
    return json({ ok: true });
  }

  async all(coll) {
    const map = await this.ctx.storage.list({ prefix: `d:${coll}:` });
    return [...map].map(([k, v]) => ({ id: k.slice(coll.length + 3), ...v }));
  }

  async state() {
    const cutoff = new Date(Date.now() - LOG_DAYS * 864e5).toISOString().slice(0, 10);
    const [goals, habits, logs, reads] = await Promise.all(["goals", "habits", "logs", "reads"].map((c) => this.all(c)));
    reads.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return {
      goals,
      habits,
      logs: logs.filter((d) => d.id >= cutoff),
      reads: reads.slice(0, 5),
      season: (await this.ctx.storage.get("d:meta:season")) || null,
    };
  }

  // ---- widget summary (mirrors the app's scoring) ----
  async widget(params) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") || "") ? params.get("date") : new Date().toISOString().slice(0, 10);
    const now = /^\d{2}:\d{2}$/.test(params.get("time") || "") ? params.get("time") : "00:00";
    const { goals, habits, logs, season } = await this.state();
    const days = Object.fromEntries(logs.map((d) => [d.id, d.done || {}]));
    const goal = Object.fromEntries(goals.map((g) => [g.id, g]));
    const modeOf = (g) => (g && g.mode) || "sprint";
    const addDays = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    const dow = (s) => new Date(s + "T00:00:00Z").getUTCDay();
    const sched = (h, d) => (h.days || []).includes(dow(d)) && (!h.start || d >= h.start) && modeOf(goal[h.goalId]) !== "pause";
    const done = (h, d) => !!(days[d] && days[d][h.id]);

    const score = (gid) => {
      let s = 0, n = 0;
      for (let i = 0; i < 7; i++) {
        const d = addDays(date, -i);
        for (const h of habits) {
          if (h.goalId !== gid || !sched(h, d)) continue;
          const ok = done(h, d);
          if (d === date && !ok) continue;
          s++; if (ok) n++;
        }
      }
      return s ? n / s : null;
    };
    const status = (v) => (v == null ? "none" : v >= 0.75 ? "on" : v >= 0.45 ? "adj" : "off");

    const today = habits
      .filter((h) => sched(h, date))
      .sort((a, b) => (a.time || "").localeCompare(b.time || ""))
      .map((h) => ({ title: h.title, time: h.time || "", minutes: +h.minutes || 30, done: done(h, date), goal: goal[h.goalId]?.title || "", color: GOAL_COLORS[(goal[h.goalId]?.color ?? 0) % 8] }));
    const open = today.filter((h) => !h.done);
    const next = open.find((h) => h.time >= now) || open[0] || null;

    let seasonInfo = null;
    if (season && season.start) {
      const weeks = +season.weeks || 12;
      const elapsed = Math.round((new Date(date + "T00:00:00Z") - new Date(season.start + "T00:00:00Z")) / 864e5);
      seasonInfo = { name: season.name || "Season", week: Math.min(weeks, Math.max(1, Math.floor(elapsed / 7) + 1)), weeks };
    }

    return {
      date,
      done: today.length - open.length,
      total: today.length,
      next,
      today,
      season: seasonInfo,
      goals: goals
        .filter((g) => modeOf(g) !== "pause")
        .map((g) => {
          const v = score(g.id);
          const row = { title: g.title, color: GOAL_COLORS[(g.color ?? 0) % 8], score: v == null ? null : Math.round(v * 100), status: status(v) };
          // goals with a profit tracker report their running total instead of a habit score
          if (g.tracker && +g.tracker.target > 0) {
            const total = (g.tracker.entries || []).reduce((a, e) => a + (+e.sold || 0) - (+e.cost || 0) - (+e.fees || 0), 0);
            row.tracker = { total: Math.round(total * 100) / 100, target: +g.tracker.target };
          }
          return row;
        }),
    };
  }

  // ---- AI coach ----
  async coach(request) {
    if (!hasCoachKey(this.env)) return json({ error: "coach not configured", code: "not_granted" }, 503);
    const { prompt } = await request.json();
    if (typeof prompt !== "string" || !prompt || prompt.length > 60_000) return json({ error: "bad prompt" }, 400);

    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY.trim() });
    try {
      const response = await client.beta.messages.create({
        model: COACH_MODEL,
        max_tokens: 16000,
        output_config: { effort: "medium" },
        // if a safety classifier declines, retry server-side on Anthropic's recommended fallback model
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        messages: [{ role: "user", content: prompt }],
      });
      if (response.stop_reason === "refusal") return json({ error: "refused", code: "refused" }, 422);
      const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      return json({ text });
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) return json({ error: "rate limited", code: "rate_limited" }, 429);
      if (e instanceof Anthropic.AuthenticationError) return json({ error: "ANTHROPIC_API_KEY is invalid", code: "not_granted" }, 502);
      if (e instanceof Anthropic.APIError) return json({ error: e.message, code: "upstream_error" }, 502);
      throw e;
    }
  }
}
