# Rebuild the Corpo Mailer interface: a cinematic, dark sponsor desk

You are an expert creative front-end developer. Restyle and restructure the **existing Next.js app**
in `corpo-mailer/frontend` (Next 16 App Router, React 19, Tailwind 4, TypeScript) into the interface
described below. This is a working product, not a mock-up: every screen talks to a real API and
every current feature must still work when you finish.

**Hard constraints**

- Do not change `lib/api.ts`, `lib/types.ts` or `lib/auth.ts`. `lib/hooks.ts` and `lib/format.ts` may be extended.
- Keep the routes: `/login`, `/`, `/pipeline`, `/companies`, `/companies/[id]`, `/deals/[id]`, `/drafts`.
- **The send rule is sacred.** An email is approved and sent in two separate, deliberate human
  actions, and the sender always sees the exact recipient before it goes. No animation, shortcut or
  bulk action may merge, skip or automate those steps.
- Allowed new dependencies: `motion` (import from `motion/react`), `lenis`, `@dnd-kit/core` +
  `@dnd-kit/sortable`. Nothing else: no component kit, no three.js, no icon pack (inline SVG only).
- Hardcode every value given here. Finish with `npx tsc --noEmit`, `npx eslint .` and `npm run build` all clean.

## What it is

Corpo Mailer is the sponsor desk for **brAInwave 3**, a student hackathon at DTU: a small team
tracks companies, drafts outreach with AI, approves and sends each email by hand, and watches for
replies. The interface should feel like a **film-grade control room at night**: a near-black stage,
one slow living light source behind glass, warm white type, and motion that is soft, weighted and
purposeful.

The signature is **Signal**: a full-bleed WebGL shader of slow, silky light (amber → coral →
magenta → violet) folding behind everything. On the login screen it is the hero. Inside the app it
drops to a faint ember glow behind dark glass panels, and it **answers real events**: when an email
is sent or a reply arrives, a ring of light travels outward from the control that caused it.

Base is `#07070c`. Text is warm fog-white. UI type is **Geist**, with one italic **Instrument
Serif** word per headline as the accent, and **Geist Mono** for every number.

## Page shell & libraries

- **Fonts** (a `<link>` in the root layout head, not `next/font`, so builds never fetch):
  `https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap`.
  Body `font-family:"Geist",system-ui,sans-serif`. Numbers (amounts, counts, dates in tables):
  `"Geist Mono"` with `font-variant-numeric: tabular-nums`.
- **Smooth scroll:** Lenis on the window: `new Lenis({ smoothWheel: true, lerp: 0.1 })`, driven by
  one `requestAnimationFrame` loop in a client provider mounted in the root layout. Horizontal
  scrollers (the pipeline board) get `data-lenis-prevent`.
- **Motion:** `motion/react` for springs, layout animation and presence. Two shared springs:
  `soft = { type:"spring", stiffness:120, damping:24 }` (entrances, layout) and
  `snap = { type:"spring", stiffness:420, damping:34 }` (hover, press, indicator slides).
- **Root scale:** `html { font-size: clamp(14px, 1.111vw, 18px); }` and size everything in rem.
- **Tokens:** declare the variables below on `:root` in `app/globals.css` and expose them through
  Tailwind 4's `@theme inline`. The app is dark only; remove the light theme.

```css
:root {
  --base:            #07070c;   /* stage, and the shader's floor colour */
  --heading:         #f3efe9;   /* headings, input text */
  --body:            #b4afbd;   /* body copy, labels, nav links */
  --faint:           #6f6a7c;   /* meta text, placeholders */
  --glass:           rgba(255,255,255,0.055);
  --glass-strong:    rgba(255,255,255,0.09);
  --glass-border:    rgba(255,255,255,0.13);
  --hairline:        rgba(255,255,255,0.07);
  --panel:           rgba(14,13,20,0.72);    /* data-dense surfaces: tables, forms */
  --scrim-app:       linear-gradient(rgba(7,7,12,0.28), rgba(7,7,12,0.62));
  --action:          #f3efe9;   /* default pill button */
  --action-fg:       #17151d;
  --ember:           linear-gradient(100deg,#ffb347 0%,#ff6b5e 38%,#e6399b 72%,#7a5cff 100%);
  --danger:          #ff5d73;
  --ok:              #3ddc97;
  --ease:            cubic-bezier(0.2, 0, 0, 1);
  --fast:            150ms;
  /* pipeline stages */
  --st-prospect:#8b93a7; --st-contacted:#4cc2ff; --st-replied:#2ee6c8;
  --st-in_discussion:#7c8cff; --st-proposal_sent:#b07cff; --st-committed:#3ddc97;
  --st-paid:#ffd166; --st-declined:#ff5d73; --st-no_response:#c9a26b;
}
```

**Surfaces.** Two kinds only. *Glass* (nav, badges, floating bars, cards over the shader):
`background:var(--glass); border:1px solid var(--glass-border); backdrop-filter:blur(14px) saturate(140%)`.
*Panel* (anything holding a table, a form or long text): `background:var(--panel);
border:1px solid var(--hairline); backdrop-filter:blur(22px)`. Radius `1.25rem` for cards and
panels, `9999px` for pills, bars and buttons, `0.75rem` for inputs.

**Buttons** are pills, `height:2.5rem; padding:0 1.125rem; font-weight:500; font-size:0.9rem`.
*Primary*: `background:var(--action); color:var(--action-fg)`; hover `rgba(243,239,233,0.86)`.
*Ghost*: glass. *Danger*: transparent, `--danger` text and 1px border at 40% alpha.
*Ember* (`background:var(--ember)`, white text, `font-weight:600`) is reserved for **one thing in the
whole app: sending an email.** Every button: press scales to `0.97` with `snap`; focus-visible is
`box-shadow:0 0 0 2px rgba(243,239,233,0.7)`; disabled is 45% opacity.

**Inputs**: `height:2.75rem; background:rgba(255,255,255,0.04); border:1px solid var(--hairline);
color:var(--heading)`; focus → border `rgba(255,255,255,0.32)` plus a `0 0 0 4px rgba(255,107,94,0.14)` ring.

## Global layers (mounted once in the root layout, persist across routes)

1. **Signal canvas** (z-0): `position:fixed; inset:0; width:100%; height:100%; pointer-events:none`.
2. **Scrim** (z-1), fixed, `pointer-events:none`. On `/login`:
   `radial-gradient(110% 90% at 50% 46%, rgba(7,7,12,0.70) 0%, rgba(7,7,12,0.66) 26%, rgba(7,7,12,0.42) 55%, rgba(7,7,12,0.10) 100%)`.
   Everywhere else: `var(--scrim-app)`. Cross-fade between the two over 900ms.
3. **Grain** (z-2), fixed, `pointer-events:none; opacity:0.06; mix-blend-mode:overlay`: an inline
   SVG `feTurbulence` (`baseFrequency 0.9`, `numOctaves 2`) as a data-URI background.
4. Content (z-10) and floating chrome (z-20).

## The WebGL scene: Signal (use this shader verbatim)

Plain WebGL1, one full-screen triangle, no library. Vertex shader:
`attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }` with buffer `[-1,-1, 3,-1, -1,3]`.
Fragment shader, exactly:

```glsl
precision highp float;
uniform vec2  uRes;
uniform float uTime;
uniform vec2  uPointer;    // 0..1, smoothed
uniform float uIntensity;  // 1.0 on the login hero, 0.55 inside the app
uniform float uPulse;      // 0..1 progress of the ripple; 1.0 = no ripple
uniform vec2  uPulseAt;    // 0..1 origin of the ripple (y up)

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  mat2 m = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p * 2.02; a *= 0.5; }
  return v;
}
vec3 ramp(float t){
  vec3 a = vec3(1.00, 0.70, 0.28);   // amber
  vec3 b = vec3(1.00, 0.42, 0.37);   // coral
  vec3 c = vec3(0.90, 0.22, 0.61);   // magenta
  vec3 d = vec3(0.48, 0.36, 1.00);   // violet
  t = clamp(t, 0.0, 1.0);
  if (t < 0.33) return mix(a, b, t / 0.33);
  if (t < 0.66) return mix(b, c, (t - 0.33) / 0.33);
  return mix(c, d, (t - 0.66) / 0.34);
}
void main(){
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float t = uTime * 0.05;
  p += (uPointer - 0.5) * 0.10;

  vec2 q = vec2(fbm(p * 1.25 + vec2(0.0, t)), fbm(p * 1.25 + vec2(5.2, -t * 1.2)));
  vec2 r = vec2(fbm(p * 1.05 + 3.0 * q + vec2(1.7, 9.2) + t * 0.7),
                fbm(p * 1.05 + 3.0 * q + vec2(8.3, 2.8) - t * 0.5));
  float f = fbm(p * 1.15 + 3.2 * r);

  float body  = smoothstep(0.42, 0.92, f);
  float lines = pow(0.5 + 0.5 * sin(f * 44.0 + t * 9.0), 7.0);
  float hue = 2.1 * length(r) - 1.0 + 0.9 * (q.x - 0.5) + 0.08 * sin(t * 2.0);
  vec3 col = ramp(hue) * (body * 0.95 + lines * body * 0.75);

  vec2 pc = (uPulseAt * uRes - 0.5 * uRes) / uRes.y;
  float d = distance(p, pc);
  float ring = exp(-pow((d - uPulse * 1.7) * 22.0, 2.0)) * (1.0 - uPulse) * (1.0 - uPulse);
  col += ramp(0.05 + d * 0.45) * ring * 0.9;

  col *= 1.0 - 0.55 * smoothstep(0.35, 1.25, length(p));
  vec3 base = vec3(7.0, 7.0, 12.0) / 255.0;
  col = base + col * uIntensity;
  col += (hash(gl_FragCoord.xy + fract(uTime) * 100.0) - 0.5) * 0.022;
  gl_FragColor = vec4(col, 1.0);
}
```

**Driving it** (one `SignalProvider` client component owns the canvas and exposes
`useSignal().pulse(element | {x,y})` through context):

- `uTime` = seconds since mount. `uRes` = drawing-buffer size.
- `uPointer`: target is the real pointer in 0..1 (y flipped); each frame `current += (target - current) * 0.06`.
- `uIntensity`: `1.0` on `/login`, `0.55` on every other route, tweened over 900ms (easeOutCubic) when the route changes. (Built and measured: at 0.32 under the original darker scrim the light was nearly invisible in the app.)
- **Load burst** (first paint of `/login` only): intensity runs `0 → 1.9` in 500ms, then settles to
  `1.0` over 1400ms; at 250ms fire a pulse from the centre.
- **Pulse:** `pulse(target)` sets `uPulseAt` to the target's centre and runs `uPulse` `0 → 1` over
  1600ms with easeOutCubic (`1-(1-t)^3`), then holds at 1. A new pulse restarts it.
  Fire it on exactly four events: successful sign-in (from the Enter button), **email sent** (from
  the send control), **a reply check that found replies or bounces** (from the check button), and a
  deal dropped into `committed` or `paid` (from the card). Nothing else.
- **Performance:** DPR capped at `min(devicePixelRatio, 1.5)`. On app routes render the buffer at
  0.6× CSS size and at 30fps; on `/login` full size at 60fps. Stop the loop while `document.hidden`.
- **Fallbacks:** if WebGL is unavailable, hide the canvas and give the body
  `radial-gradient(60% 50% at 70% 20%, rgba(230,57,155,0.22), transparent 70%), radial-gradient(50% 45% at 25% 80%, rgba(255,179,71,0.14), transparent 70%), var(--base)`,
  and hide both scrims (they exist to calm the shader, and dim this glow to nothing).
  Under `prefers-reduced-motion: reduce`, draw one frame at `uTime = 20` and stop; pulses become a
  200ms opacity flash on the triggering control; every reveal below becomes a 150ms fade **with its
  delay dropped**, so nothing waits on a stagger.

## Login: the hero

One screen, `min-height:100lvh`, content centred, text centred, padding `0 1.25rem` (≥640px `0 2.5rem`).

- **Brand** (top-left, absolute, padding `1.25rem`; ≥640px `1.75rem 2.5rem`): glyph + **Corpo Mailer**,
  `font-weight:500; font-size:1.25rem; letter-spacing:-0.01em`. The glyph is an envelope whose flap is a signal wave:
  ```html
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" width="1.5rem" height="1.5rem">
    <rect x="2.5" y="5" width="19" height="14" rx="3.5" stroke="currentColor" stroke-width="1.7"/>
    <path d="M3.5 8.5c2.8 0 2.8 4 5.7 4s2.8-4 5.6-4 2.9 4 5.7 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
  </svg>
  ```
- **Centre column** (`max-width:22rem`; ≥640px `40rem`; ≥1024px `50rem`), in order:
  - **Badge** (glass pill, `padding:0.4rem 0.875rem; font-size:0.78rem; color:var(--body)`), led by a
    `0.4rem` dot filled with `var(--ember)` that breathes (opacity 0.5↔1, 2.4s): **brAInwave 3 · Sponsor desk**
  - **Heading** `<h1>`: **Every sponsor. One clear _signal_.** `font-size:2.1rem` (≥640px `3.6rem`,
    ≥1024px `5rem`); `font-weight:500; line-height:1.08; letter-spacing:-0.025em; margin-top:1.75rem`.
    The word *signal.* is Instrument Serif italic, weight 400, `letter-spacing:-0.01em`, filled with
    `var(--ember)` via `background-clip:text`.
  - **Sub-line**: **Know who to reach, what they said, and what happens next. Nothing leaves without
    your sign-off.** `margin-top:1.25rem; font-size:1.1rem; line-height:1.5; color:var(--body); max-width:34rem`.
  - **Sign-in bar** (`margin-top:2.5rem; width:36rem; max-width:100%`): one glass bar,
    `height:4rem; border-radius:9999px; padding:0 0.4rem 0 1.5rem`, holding two borderless
    transparent inputs split by a 1px `--hairline` divider, **Your name** and **Team password**, and
    a primary pill **Enter**. Below 640px it becomes a `1.5rem`-radius glass card with the three
    stacked. An error appears under the bar in `--danger`, and the bar shakes once (x ±6px, 320ms).
    While signing in, the button label becomes a 3-dot pulse. On success: fire the pulse, hold
    450ms, then route to `/`.
- **Footer** (bottom, centred, `font-size:0.78rem; color:var(--faint)`): **© 2026 Corpo Mailer · built for brAInwave, DTU.**

**Entrance** (delays in ms after load; block reveals use `soft`):

| Block | delay | from | style |
|---|---|---|---|
| Brand | 150 | `y:-0.75rem` | fade + slide |
| Badge | 320 | `y:1.25rem` | fade + slide |
| Heading | 480 | per word | each word `y:26px→0`, opacity `0→1`, stagger 85ms, 720ms, easeOutCubic |
| Sub-line | 1150 | per word | each word `y:14px→0`, stagger 22ms, 600ms, easeOutCubic |
| Sign-in bar | 1450 | `y:1.25rem` | fade + slide |
| Footer | 1650 | `y:1.25rem` | fade + slide |

Split text on spaces into `inline-block` spans. Build one `<Reveal>` and one `<WordReveal>` component and reuse them app-wide.

## App shell

- **Floating nav** (z-20, `position:sticky; top:1rem`, centred, `max-width:76rem`): three pieces in a
  row. Left: brand glyph + name. Centre: a glass pill (`height:3rem; padding:0 0.4rem`) of links
  **Dashboard / Pipeline / Companies / Drafts**; the active link has a `--glass-strong` pill behind
  it that **slides between links** (`layoutId`, `snap`). Drafts carries a mono count of emails
  awaiting review when above zero. Right: a glass pill with the operator's name, a `⌘K` hint and **Sign out**.
  Below 768px the links move to a fixed glass bar at the bottom of the screen.
- **Page container**: `max-width:76rem; padding:2.5rem 1.25rem 6rem`. Every page opens with a title
  (`font-size:2.4rem; font-weight:500; letter-spacing:-0.02em`, word-revealed, one italic serif word)
  and a one-line `--body` subtitle. Route changes: the new page fades and slides in (`soft`). There is no exit fade: the App Router swaps the tree immediately, and holding the old one on screen needs a workaround that breaks scroll restoration.
- **Command palette** (`⌘K` / `Ctrl+K`): a centred glass panel (`width:36rem`, backdrop
  `rgba(7,7,12,0.6)` + blur 6px) with one input, **Search companies, or jump to…** It lists the four
  pages, then companies matching the query (`api.companies.list(q)`, debounced 180ms); each opens
  its first deal, or the company if it has none. Arrow keys, Enter, Esc. It navigates only: no
  approve or send commands.
- **Toasts**: bottom-centre glass pills, 4s, used for save confirmations and errors that have no inline home.
- **Loading**: skeleton blocks in the shape of the incoming content, with a 1.6s shimmer sweep. No spinners, no "Loading…" text.
- **Empty states**: one `--faint` sentence and one action, inside a dashed `--hairline` panel.

## Dashboard (`/`)

- **Greeting**: **Good {morning|afternoon|evening}, {name}.** then, word-revealed and with the italic
  serif on the number: **_{n}_ sponsors are waiting on you.** where `n` = unread replies + follow-ups
  due + stale deals. When zero: **You're all _caught up_.** On the right, the reply-check control: a
  ghost pill **Check for replies** with a status line beneath (`Checked 4 min ago · checks
  automatically`, the last error in `--danger`, or the "reply tracking is off" hint). The dot beside
  it is `--ok` when healthy, `--danger` on error, `--faint` when off.
- **Four stat tiles** (glass, 4-up; 2-up below 1024px): Open deals · Follow-ups due · Emails to
  review · Committed. Label `0.72rem` uppercase `letter-spacing:0.08em` `--faint`; value `2.6rem`
  Geist Mono that **counts up** from 0 over 900ms easeOutCubic (₹ in the Indian grouping already
  produced by `fmtMoney`); a `--body` hint under it. Tiles enter with an 80ms stagger. On hover a
  soft radial highlight follows the pointer inside the tile
  (`radial-gradient(14rem circle at var(--mx) var(--my), rgba(255,255,255,0.08), transparent 60%)`).
  Reuse this **spotlight** on every card in the app.
- **New replies** (only when present; the one section with a 1px `var(--ember)` gradient border):
  rows of company, "Replied today / 10 Nov", stage chip.
- **Follow up now**: the same row pattern, with "Follow-up was due …" or "No contact for N days".
- **Build notes learned the hard way:** a gradient *border* is a gradient `div` with `p-px` around
  a separate **opaque** inner surface (never the shared translucent `Card`, or the gradient fills
  the whole panel); stat numbers shrink on narrow tiles (`1.75rem` below 640px, `2.2rem` at 1024px)
  so `₹7,50,000` never clips; under reduced motion the count-up paints the real number on the
  first frame; word reveals key by index so a changed word (3 → 4) updates in place; and the
  reply-check dot is neutral until a check has actually succeeded.
- **Pipeline funnel**: one row per stage: name, a `0.5rem` track whose fill is the stage colour and
  **grows from 0** on reveal (700ms, 50ms stagger), and a mono count.
- **Stage chip** (used everywhere): pill, `font-size:0.72rem; font-weight:500`, text in the stage
  colour, background the same colour at 14% alpha, led by a `0.375rem` dot.

## Pipeline (`/pipeline`)

A horizontal board, one column per stage (`width:18rem`), scroll-snapping, with edge fade masks.

- **Column header**: stage dot, name, mono count and the column's target total, over a 2px rule in the stage colour fading to transparent.
- **Deal card** (glass + spotlight): company name; a line of `--body` meta (target, "Contacted 3d
  ago", follow-up date); a small **New reply** pill in `--st-replied` when `reply_unread`.
- **Drag and drop** (`@dnd-kit`): pick a card up and it lifts (scale 1.03, deeper shadow, 2° tilt);
  the column under it glows in its stage colour; on drop the cards re-flow with layout animation and
  the stage is saved through `api.deals.update`. If the save fails the card springs back and a toast
  explains. **Keep a keyboard and touch fallback**: each card has a "Move to…" menu listing all nine stages.

- **Build notes learned the hard way (pipeline):** the board is **full-bleed** (`w-screen`, centred
  with `left-1/2 -translate-x-1/2`, its padding aligned so the first column lines up with the page
  title), not boxed inside the 76rem container, which hid most of the nine columns. Use
  `@dnd-kit/core` only, with a `MouseSensor` (6px travel, so a click still follows the link) and a
  `TouchSensor` (220ms press, so the board still scrolls sideways). Choose the drop column by
  **pointer position** (`pointerWithin`, falling back to `rectIntersection`). Attach drag listeners
  but not `attributes`, so the link and the Move button inside a card stay normal controls. The
  stage picker is a portalled dialog, not a popover. Moves are optimistic and keyed by the stage
  they started from, so the server's answer takes over once it differs. Ripple only after the save
  succeeds, from the drop point.

## Companies (`/companies`, `/companies/[id]`)

- **List**: a glass search bar and a primary **Add company** pill, then a panel of rows (company,
  industry, contact count, stage chip). Rows stagger in 30ms apart; hover lifts the row to
  `--glass` and slides a chevron in from the right.
- **Add company** opens a **sheet** from the right (`width:30rem`, panel surface, `soft`, backdrop
  blur) with the same four fields as today. Creating a company still creates its first deal.
- **Company page**: details form in a panel; contacts as glass cards (name, role, mono email,
  do-not-contact as a `--danger` chip, with the same toggle and remove actions); deals as linked cards.
  Deleting uses a glass confirm dialog that names what will be lost; never `window.confirm`.

- **Build notes learned the hard way (companies and dialogs):** load the companies once and filter
  as the user types, so search never shows a loading state. Every modal (sheet, confirm, stage
  picker) shares one keyboard hook that listens on the **document**, not the panel: a button that
  disables itself during a request drops focus to `<body>`, and a panel-level Esc handler then
  never fires again. The hook also keeps Tab inside, closes only the topmost modal, and returns
  focus to whatever opened it. Exit animations are a quick 200ms fade; reusing the slow entrance
  spring made a removed card linger for over a second. Dialogs that delete things state exactly
  what will be lost (counts), and there is no native `confirm()` anywhere.

## Deal (`/deals/[id]`): where the work happens

Two columns at ≥1024px (`1fr 26rem`), stacked below.

- **Header**: company name (large, word-revealed), stage chip, link to the company.
- **Reply banner** (when `reply_unread`; glass with the ember gradient border): **They replied** +
  time, the reply quoted in a block with a left rule, the line **The stage hasn't changed. You decide
  what the reply means.**, then **Move to Replied** (only from prospect or contacted) and **Mark as seen**.
- **Left: the thread.** The timeline is a vertical line with a node per interaction, newest first.
  Node colour by type: sent `--st-in_discussion`, reply `--st-replied`, call or meeting `--st-paid`,
  note `--faint`. Each entry is a panel: type label, who, time (mono), subject, body, and "Approved
  by …" or an "auto-detected" chip where they apply. Entries draw in on scroll: the line extends,
  then the node pops (`snap`), then the panel fades up. A compact "Log a call, meeting, reply or
  note" composer sits at the top.
- **Right: sticky rail** (`top:5.5rem`): the deal form (stage, owner, follow-up, target, committed,
  notes) in a panel, then the **AI composer**: recipient, type (First introduction / Follow-up /
  Thank you), optional instruction, and a primary pill **Write a draft with AI**. While generating,
  the composer's border becomes a slowly rotating ember conic gradient and the caption reads
  **Writing… this can take about 20 seconds.** The finished draft enters with `soft`.

### The draft card (the most important component: build it carefully)

A panel showing, top to bottom:

1. **Approval rail**: three linked steps, **Draft → Approved → Sent**. The current step is lit,
   completed steps show a check, and the connector fills as it advances (400ms). "AI-written" and
   "Do not contact" chips sit beside it.
2. **To** line with the recipient's name and mono email, always visible.
3. Subject and body, editable in place until sent. Unsaved edits reveal **Save changes** and
   **Discard**; saving an approved draft drops the rail back to Draft with the note
   **Edited. Needs approval again.**
4. Actions by state:
   - *Draft* → primary pill **Approve** (disabled while there are unsaved edits, or if the contact is do-not-contact).
   - *Approved* → **hold-to-send**: an ember pill reading **Hold to send to raj@acme.com**. Pressing
     and holding fills a progress ring around the pill over **1100ms**; releasing early cancels and
     the ring drains. On completion call `api.drafts.send`, fire the Signal pulse from the button,
     advance the rail to Sent, and play one soft success sweep across the card. Beside it, a ghost
     **Revoke approval**, and the note **Approved by {name}. Editing voids the approval.**
     The ring must be a true pill (SVG `rx` and `ry` set to half the measured height: a single huge
     `rx` renders an ellipse), and every dialog renders in a portal on `<body>`, or the sticky nav
     draws over its backdrop.
   *Keyboard and assistive tech:* Enter or Space on the focused pill opens a glass confirm dialog
     (**Send this email to Raj Mehta <raj@acme.com>?**, the subject, **Send** / **Cancel**)
     instead of the hold gesture. Under reduced motion, use the dialog for everyone.
   - *Sent* → a quiet line: **Sent 11 Nov, 6:37 pm · approved by Asha**. Fields are read-only.
5. A failed send keeps the card Approved and shows **Last send failed: …** in `--danger`.

There is no "approve and send", no "send all", and no auto-advance from Approved to Sent.

## Drafts (`/drafts`)

Two tabs with a sliding indicator, **To review / send** and **Sent**, each a column of draft cards
headed by the company name. Cards leave with a layout animation when their state moves them to the
other tab.

## Motion rules (apply everywhere)

- Entrances: `soft`, from `y:1.25rem` and opacity 0. Lists stagger 30–80ms and never exceed 600ms in total.
- Hover and press: `snap`. Nothing moves more than 4px on hover.
- Scroll reveals fire once, at 15% visibility. Never animate layout on scroll.
- Numbers count up once per page visit; they do not re-run when data refreshes.
- After a mutation, update in place: no full-page skeleton when reloading data that is already shown.
- Every animated control must work with the keyboard and under `prefers-reduced-motion`.

## Fixed parameters (bake these in)

- **Copy:** exactly as written above in bold.
- **Signal:** intensity 1.0 on login, 0.55 in the app, 900ms route tween; burst 0→1.9 (500ms) → 1.0
  (1400ms) with a centre pulse at 250ms; pulse 1600ms easeOutCubic; pointer lerp 0.06; DPR cap 1.5;
  app routes 0.6× resolution at 30fps.
- **Springs:** soft 120/24, snap 420/34. **Hold-to-send:** 1100ms. **Count-up:** 900ms.
- **Login reveal delays (ms):** brand 150, badge 320, heading 480, sub-line 1150, bar 1450, footer 1650.
- **Type:** Geist 400/500/600, Geist Mono 400/500, Instrument Serif italic 400.
- **Colours:** the custom-property block above; stage colours never change meaning between screens.

## Still must work (check each before you finish)

Sign in and out, and a redirect to `/login` on a 401. Dashboard numbers match the API. Reply check
shows its result, last-checked time and errors. Stage changes persist, by drag and by menu.
Companies: search, add (creates a deal), edit, delete. Contacts: add, do-not-contact toggle, remove.
Deal: edit and save every field, log each interaction type, generate a draft of each kind. Drafts:
edit, save, approve, revoke, send, with a failed send reported and the draft left approved. Reply
banner: Move to Replied and Mark as seen. Every API error is shown to the user in plain words.

## Assets

None. Fonts load from Google Fonts; the grain is an inline SVG filter; the background is generated
by the shader. No images, video or models.
