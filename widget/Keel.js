// Keel home screen widget for Scriptable (https://scriptable.app)
//
// Setup: paste this whole file into a new Scriptable script named "Keel",
// run it once inside Scriptable and enter your Keel address and passcode,
// then add a Scriptable widget to your home screen and pick "Keel".
// Works in small, medium and large sizes. Tapping it opens Keel.
//
// To change the saved address or passcode, run the script in Scriptable again
// and choose "Change settings".

const KEY_URL = "keel.url";
const KEY_PASS = "keel.passcode";

// ---------- settings ----------
async function askSettings() {
  const a = new Alert();
  a.title = "Connect Keel";
  a.message = "Your Keel address (for example https://keel.yourname.workers.dev) and the passcode you chose in the app.";
  a.addTextField("https://keel.yourname.workers.dev", Keychain.contains(KEY_URL) ? Keychain.get(KEY_URL) : "");
  a.addSecureTextField("Passcode", "");
  a.addAction("Save");
  a.addCancelAction("Cancel");
  if ((await a.presentAlert()) === -1) return false;
  let url = a.textFieldValue(0).trim().replace(/\/+$/, "");
  if (url && !/^https?:\/\//.test(url)) url = "https://" + url;
  const pass = a.textFieldValue(1);
  if (!url || !pass) return false;
  Keychain.set(KEY_URL, url);
  Keychain.set(KEY_PASS, pass);
  return true;
}

// ---------- data ----------
const pad = (n) => String(n).padStart(2, "0");
function localDate(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function localTime(d = new Date()) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }

async function load() {
  const base = Keychain.get(KEY_URL);
  const req = new Request(`${base}/api/widget?date=${localDate()}&time=${localTime()}`);
  req.headers = { Authorization: "Bearer " + Keychain.get(KEY_PASS) };
  req.timeoutInterval = 15;
  const data = await req.loadJSON();
  if (req.response.statusCode === 401) throw new Error("Passcode didn't match. Run the script in Scriptable to fix it.");
  if (req.response.statusCode !== 200) throw new Error("Couldn't reach Keel.");
  return data;
}

// ---------- drawing ----------
const INK = Color.dynamic(new Color("#1D1D1F"), new Color("#F5F5F7"));
const MUTED = Color.dynamic(new Color("#6E6E73"), new Color("#98989D"));
const BG = Color.dynamic(new Color("#FFFFFF"), new Color("#1C1C1E"));
const BLUE = new Color("#0A84FF");
const STATUS = {
  on: { label: "On track", color: new Color("#30D158") },
  adj: { label: "Adjust", color: new Color("#FF9F0A") },
  off: { label: "Off track", color: new Color("#FF453A") },
  none: { label: "No data", color: new Color("#8E8E93") },
};

function ring(progress, size, line, color) {
  const ctx = new DrawContext();
  ctx.size = new Size(size, size);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const c = size / 2, r = c - line / 2 - 1;
  const arc = (from, to) => {
    const pts = [];
    const steps = Math.max(2, Math.ceil((to - from) * 90));
    for (let i = 0; i <= steps; i++) {
      const t = -Math.PI / 2 + (from + (to - from) * (i / steps)) * Math.PI * 2;
      pts.push(new Point(c + r * Math.cos(t), c + r * Math.sin(t)));
    }
    const p = new Path();
    p.addLines(pts);
    return p;
  };
  ctx.setLineWidth(line);
  ctx.setStrokeColor(new Color("#8E8E93", 0.25));
  ctx.addPath(arc(0, 1));
  ctx.strokePath();
  if (progress > 0) {
    ctx.setStrokeColor(color);
    ctx.addPath(arc(0, Math.min(1, progress)));
    ctx.strokePath();
    // round caps
    const dot = (a) => {
      const t = -Math.PI / 2 + a * Math.PI * 2;
      ctx.setFillColor(color);
      ctx.fillEllipse(new Rect(c + r * Math.cos(t) - line / 2, c + r * Math.sin(t) - line / 2, line, line));
    };
    dot(0);
    dot(Math.min(1, progress));
  }
  return ctx.getImage();
}

function text(stack, str, size, weight = "regular", color = INK, lines = 1) {
  const t = stack.addText(str);
  t.font = weight === "bold" ? Font.boldSystemFont(size) : weight === "semibold" ? Font.semiboldSystemFont(size) : weight === "medium" ? Font.mediumSystemFont(size) : Font.systemFont(size);
  t.textColor = color;
  t.lineLimit = lines;
  return t;
}

function ringBlock(parent, d, size) {
  const z = parent.addStack();
  z.size = new Size(size, size);
  z.backgroundImage = ring(d.total ? d.done / d.total : 0, size, Math.round(size / 8), d.total && d.done === d.total ? STATUS.on.color : BLUE);
  z.centerAlignContent();
  const v = z.addStack();
  v.layoutVertically();
  v.centerAlignContent();
  const t = text(v, `${d.done}/${d.total}`, Math.round(size / 4.2), "bold");
  t.centerAlignText();
}

function nextBlock(parent, d, compact) {
  const s = parent.addStack();
  s.layoutVertically();
  text(s, d.next ? "UP NEXT" : d.total ? "ALL DONE" : "NOTHING TODAY", 10, "semibold", MUTED);
  s.addSpacer(2);
  if (d.next) {
    text(s, d.next.title, compact ? 14 : 15, "semibold", INK, 2);
    text(s, `${d.next.time} · ${d.next.minutes} min`, 12, "regular", MUTED);
  } else {
    text(s, d.total ? "Every habit ticked off." : "Enjoy the day.", 14, "semibold");
  }
}

function goalRow(parent, g) {
  const r = parent.addStack();
  r.centerAlignContent();
  const dot = r.addStack();
  dot.size = new Size(8, 8);
  dot.cornerRadius = 4;
  dot.backgroundColor = new Color(g.color);
  r.addSpacer(6);
  text(r, g.title, 12, "regular", INK);
  r.addSpacer();
  if (g.tracker) {
    const fmt = (v) => (v < 0 ? "-$" : "$") + Math.round(Math.abs(v)).toLocaleString("en-US");
    text(r, `${fmt(g.tracker.total)} / ${fmt(g.tracker.target)}`, 11, "semibold", g.tracker.total >= g.tracker.target ? STATUS.on.color : INK);
    return;
  }
  if (g.showup) {
    if (g.showup.target >= 7) text(r, g.showup.today ? "Done today" : "Not yet today", 11, "semibold", g.showup.today ? STATUS.on.color : STATUS.adj.color);
    else text(r, `${g.showup.week}/${g.showup.target} this wk`, 11, "semibold", g.showup.week >= g.showup.target ? STATUS.on.color : INK);
    return;
  }
  const st = STATUS[g.status] || STATUS.none;
  text(r, st.label, 11, "semibold", st.color);
}

// a Mon–Sun row of dots: filled for days checked in, a ring on today, faint for days still to come
function weekDots(days, todayIdx, color, dot) {
  const gap = Math.round(dot * 0.5), w = days.length * dot + (days.length - 1) * gap, h = dot + 14;
  const ctx = new DrawContext();
  ctx.size = new Size(w, h);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const grey = new Color("#8E8E93");
  ctx.setFont(Font.semiboldSystemFont(9));
  ctx.setTextAlignedCenter();
  days.forEach((on, i) => {
    const x = i * (dot + gap), r = new Rect(x + 1, 1, dot - 2, dot - 2);
    if (on) { ctx.setFillColor(color); ctx.fillEllipse(r); }
    else {
      ctx.setLineWidth(i === todayIdx ? 2.5 : 1.5);
      ctx.setStrokeColor(i === todayIdx ? color : new Color("#8E8E93", i > todayIdx ? 0.25 : 0.55));
      ctx.strokeEllipse(r);
    }
    ctx.setTextColor(i === todayIdx ? color : grey);
    ctx.drawTextInRect("MTWTFSS"[i], new Rect(x - 2, dot + 2, dot + 4, 12));
  });
  return ctx.getImage();
}

function barImage(progress, width, color) {
  const ctx = new DrawContext();
  ctx.size = new Size(width, 6);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const track = new Path();
  track.addRoundedRect(new Rect(0, 0, width, 6), 3, 3);
  ctx.addPath(track);
  ctx.setFillColor(new Color("#8E8E93", 0.25));
  ctx.fillPath();
  const p = Math.max(0, Math.min(1, progress));
  if (p > 0) {
    const fill = new Path();
    fill.addRoundedRect(new Rect(0, 0, Math.max(6, width * p), 6), 3, 3);
    ctx.addPath(fill);
    ctx.setFillColor(color);
    ctx.fillPath();
  }
  return ctx.getImage();
}

// daily (or weekly) check-in goal, e.g. "Post on TikTok daily"
function checkinBlock(parent, g, dot) {
  const s = parent.addStack();
  s.layoutVertically();
  const top = s.addStack();
  top.centerAlignContent();
  text(top, g.title.toUpperCase(), 10, "semibold", MUTED);
  top.addSpacer();
  const su = g.showup;
  if (su.target >= 7 && su.streak) text(top, `🔥${su.streak}`, 11, "semibold", INK);
  else if (su.target < 7) text(top, `${su.week}/${su.target}`, 11, "semibold", su.week >= su.target ? STATUS.on.color : INK);
  s.addSpacer(5);
  const img = s.addImage(weekDots(su.days || [], su.todayIdx ?? 0, new Color(g.color), dot));
  img.imageSize = new Size(7 * dot + 6 * Math.round(dot * 0.5), dot + 14);
  s.addSpacer(3);
  const verb = su.verb || "went";
  const msg = su.today ? `${verb.charAt(0).toUpperCase() + verb.slice(1)} today ✓` : su.target >= 7 ? `Not ${verb} yet today` : `${Math.max(0, su.target - su.week)} to go this week`;
  text(s, msg, 12, "semibold", su.today ? STATUS.on.color : su.target >= 7 ? STATUS.adj.color : INK);
}

// running money total with a progress bar, e.g. "$381 / $500"
function moneyBlock(parent, g, width) {
  const s = parent.addStack();
  s.layoutVertically();
  const r = s.addStack();
  r.centerAlignContent();
  text(r, g.title, 12, "regular", INK);
  r.addSpacer();
  const fmt = (v) => (v < 0 ? "-$" : "$") + Math.round(Math.abs(v)).toLocaleString("en-US");
  const done = g.tracker.total >= g.tracker.target;
  text(r, `${fmt(g.tracker.total)} / ${fmt(g.tracker.target)}`, 12, "semibold", done ? STATUS.on.color : INK);
  s.addSpacer(4);
  const img = s.addImage(barImage(g.tracker.target ? g.tracker.total / g.tracker.target : 0, width, done ? STATUS.on.color : new Color(g.color)));
  img.imageSize = new Size(width, 6);
}

function build(d, family) {
  const w = new ListWidget();
  w.backgroundColor = BG;
  w.setPadding(14, 14, 14, 14);
  const goals = d.goals || [];
  // the daily check-in goal goes top right; fall back to any check-in goal
  const featured = goals.find((g) => g.showup && g.showup.target >= 7) || goals.find((g) => g.showup);
  const money = goals.filter((g) => g.tracker);
  const rest = goals.filter((g) => g !== featured && !g.tracker);

  const head = w.addStack();
  head.centerAlignContent();
  text(head, "Keel", 13, "bold", BLUE);
  head.addSpacer();
  if (d.season && family !== "small") text(head, `${d.season.name} · Wk ${d.season.week}/${d.season.weeks}`, 11, "medium", MUTED);
  w.addSpacer(8);

  if (family === "small" && featured) {
    // small: the daily check-in fills the widget, with habits as one line underneath
    w.addSpacer(2);
    checkinBlock(w, featured, 14);
    w.addSpacer();
    if (d.total) text(w, `Habits ${d.done}/${d.total}`, 11, "semibold", d.done === d.total ? STATUS.on.color : MUTED);
  } else if (family === "small") {
    const row = w.addStack();
    row.addSpacer();
    ringBlock(row, d, 64);
    row.addSpacer();
    w.addSpacer(8);
    nextBlock(w, d, true);
  } else {
    const row = w.addStack();
    row.centerAlignContent();
    ringBlock(row, d, 70);
    row.addSpacer(14);
    const right = row.addStack();
    right.layoutVertically();
    if (featured) checkinBlock(right, featured, 18);
    else nextBlock(right, d, false);
    w.addSpacer(10);
    const barWidth = 300;
    if (family === "medium") {
      // one money goal with its bar, or the next goal row
      if (money.length) moneyBlock(w, money[0], barWidth);
      else rest.slice(0, 2).forEach((g, i) => { goalRow(w, g); if (i === 0) w.addSpacer(4); });
    } else {
      money.slice(0, 2).forEach((g) => { moneyBlock(w, g, barWidth); w.addSpacer(8); });
      rest.slice(0, 4).forEach((g, i, a) => { goalRow(w, g); if (i < a.length - 1) w.addSpacer(4); });
      if (d.today.length) {
        w.addSpacer(10);
        text(w, "TODAY", 10, "semibold", MUTED);
        w.addSpacer(4);
        d.today.slice(0, 4).forEach((h) => {
          const r = w.addStack();
          r.centerAlignContent();
          const sym = SFSymbol.named(h.done ? "checkmark.circle.fill" : "circle");
          sym.applyFont(Font.systemFont(14));
          const img = r.addImage(sym.image);
          img.imageSize = new Size(15, 15);
          img.tintColor = h.done ? BLUE : MUTED;
          r.addSpacer(8);
          text(r, h.time, 12, "regular", MUTED);
          r.addSpacer(8);
          text(r, h.title, 13, "regular", h.done ? MUTED : INK);
          w.addSpacer(3);
        });
      }
    }
  }
  w.addSpacer();
  w.url = Keychain.get(KEY_URL);
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  return w;
}

function errorWidget(msg) {
  const w = new ListWidget();
  w.backgroundColor = BG;
  text(w, "Keel", 13, "bold", BLUE);
  w.addSpacer(6);
  text(w, msg, 12, "regular", MUTED, 4);
  return w;
}

// ---------- main ----------
if (!config.runsInWidget) {
  let ready = Keychain.contains(KEY_URL) && Keychain.contains(KEY_PASS);
  if (ready) {
    const a = new Alert();
    a.title = "Keel widget";
    a.addAction("Preview widget");
    a.addAction("Change settings");
    a.addCancelAction("Close");
    const pick = await a.presentAlert();
    if (pick === 1) ready = await askSettings();
    if (pick === -1) ready = false;
  } else {
    ready = await askSettings();
  }
  if (ready) {
    try { await build(await load(), "medium").presentMedium(); }
    catch (e) { await errorWidget(e.message).presentMedium(); }
  }
} else {
  let w;
  if (!Keychain.contains(KEY_URL) || !Keychain.contains(KEY_PASS)) w = errorWidget("Open Scriptable and run the Keel script once to connect.");
  else {
    try { w = build(await load(), config.widgetFamily || "medium"); }
    catch (e) { w = errorWidget(e.message); }
  }
  Script.setWidget(w);
}
Script.complete();
