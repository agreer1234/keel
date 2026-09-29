# Keel

Goals, habits, focus sessions and a weekly AI coach read, built as an iPhone
home screen app with a live widget.

This folder is everything the app needs to run on your own free Cloudflare
account:

| Path | What it is |
| --- | --- |
| `app/keel.html` | The app itself. The same file also runs as a claude.ai artifact. |
| `public/` | What gets served: `index.html` (built from the app), app icons, manifest, offline support. |
| `src/index.js` | The server. It stores your data in a Durable Object, runs the coach through the Claude API, and feeds the widget. |
| `widget/Keel.js` | Home screen widget script for the Scriptable app. |

Setup takes about 10 minutes and has 4 steps.

## 1. Put it online (free)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/agreer1234/fortnite-throwback/tree/main/keel)

1. Tap the button, then sign in to Cloudflare (or sign up; it's free, with no card needed).
2. Accept the defaults and deploy.
3. When it finishes, copy your app's address. It looks like
   `https://keel.<your-name>.workers.dev`.

The button reads the `main` branch. If that fails, or the code isn't on `main` yet,
use the manual route: in the Cloudflare dashboard go to **Workers & Pages → Create →
Import a repository**, pick this repository and branch, and set
**Root directory** to `keel`. Leave the deploy command as `npx wrangler deploy`.

## 2. Turn on the AI coach (optional)

Without this, Keel still gives you an automatic summary built from your
check-ins. To have Claude write your weekly coach read:

1. Create an API key at [platform.claude.com](https://platform.claude.com)
   (usage is billed to that account; one coach read costs a few cents).
2. In Cloudflare, open your **keel** Worker → **Settings → Variables and Secrets →
   Add**, choose type **Secret**, name it `ANTHROPIC_API_KEY`, and paste the key.
3. Deploy.

## 3. Add it to your iPhone home screen

1. Open your Keel address in **Safari**.
2. Choose a passcode. It protects your data. Use the same one on every device
   and in the widget. Keel loads example goals so the tour has something to show.
   Clear them from the last tour step or from the Goals tab.
3. Tap **Share → Add to Home Screen**. Keep **Open as Web App** turned on, then tap **Add**.

Keel now opens full screen from its own icon, and it still opens without a
signal. Changes you make offline sync the next time you're online. Your data
lives on your Cloudflare server, so it's the same on your phone, iPad and
computer.

## 4. Add the widget

iPhone widgets normally require an App Store app. The free
[Scriptable](https://apps.apple.com/app/scriptable/id1405459188) app can run a
small script as a real widget, so Keel uses that.

1. Install **Scriptable** from the App Store.
2. Open [`widget/Keel.js`](widget/Keel.js), tap **Raw**, and copy all of it.
3. In Scriptable, tap **+**, paste, and rename the script **Keel** (tap the title at the top).
4. Tap **▶** to run it once. Enter your Keel address and passcode, then tap **Save**.
   You'll see a preview.
5. On your home screen, press and hold an empty spot → **Edit → Add Widget →
   Scriptable**, pick a size, and add it.
6. Press and hold the new widget → **Edit Widget**:
   - **Script**: Keel
   - **When Interacting**: Open URL

What each size shows:

| Size | Shows |
| --- | --- |
| Small | Today's ring (habits done / scheduled) and your next habit. |
| Medium | Ring, next habit, season week, and your top two goals' status. |
| Large | All of that, plus every active goal and today's habit list with ticks. |

The widget refreshes about every 15 minutes (iOS decides the exact timing).
Tapping it opens Keel in Safari. iOS doesn't let widgets open home screen web apps directly.

## Running it locally

```sh
cd keel
npm install
npm run build      # rebuilds public/index.html after editing app/keel.html
npx wrangler dev   # http://localhost:8787
```

## Privacy

Your goals are stored only in your own Cloudflare account. The passcode is
stored as a SHA-256 hash. Coach reads send your goal data to the Claude API
only when you tap **New read**.
