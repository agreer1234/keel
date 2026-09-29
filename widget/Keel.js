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
  const st = STATUS[g.status] || STATUS.none;
  text(r, st.label, 11, "semibold", st.color);
}

function build(d, family) {
  const w = new ListWidget();
  w.backgroundColor = BG;
  w.setPadding(14, 14, 14, 14);

  const head = w.addStack();
  head.centerAlignContent();
  text(head, "Keel", 13, "bold", BLUE);
  head.addSpacer();
  if (d.season && family !== "small") text(head, `${d.season.name} · Wk ${d.season.week}/${d.season.weeks}`, 11, "medium", MUTED);
  w.addSpacer(8);

  if (family === "small") {
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
    nextBlock(right, d, false);
    w.addSpacer(10);
    const goals = d.goals.slice(0, family === "large" ? 6 : 2);
    goals.forEach((g, i) => { goalRow(w, g); if (i < goals.length - 1) w.addSpacer(4); });

    if (family === "large" && d.today.length) {
      w.addSpacer(12);
      text(w, "TODAY", 10, "semibold", MUTED);
      w.addSpacer(4);
      d.today.slice(0, 7).forEach((h) => {
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
