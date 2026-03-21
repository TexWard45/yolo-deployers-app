# Engineering Spec: Landing Page & Auth Redesign

**Product name:** ResolveAI

---

## 1. Job to Be Done

- **Who:** Prospective users (engineering managers, support leads, developers) visiting the public site for the first time, plus existing users signing in/up.
- **What:** A high-conversion landing page that communicates ResolveAI's value proposition (AI bug analysis → code tracing → auto-fix PR), with redesigned sign-in and sign-up pages that feel premium and match the landing page aesthetic.
- **Why:** The current auth pages are minimal cards on a blank background — no branding, no product context, no social proof. There is no landing page at all. First impressions matter for hackathon judges and LinkedIn viewers.
- **Success criteria:**
  - Landing page loads at `/` for unauthenticated visitors (authenticated users redirect to dashboard)
  - Sign-in at `/login`, sign-up at `/signup` — both with split-panel layout
  - All 5 product screenshots displayed in realistic browser mockups
  - Fully responsive (mobile → desktop)
  - `npm run type-check` and `npm run build` pass
  - Lighthouse performance score ≥ 90 (no heavy JS — server components where possible)

---

## 2. Proposed Flow / Architecture

### Data Model Changes

**None.** This is purely frontend. Auth already works via existing `login`/`signup` server actions and session cookies.

### API Layer

**None.** No new tRPC procedures needed. The landing page is static content. Auth forms already call `login()` and `signup()` server actions from `@/actions/auth`.

### Frontend

#### Route Structure

```
apps/web/src/app/
  (marketing)/              ← NEW route group (no sidebar, no dashboard chrome)
    layout.tsx              ← Marketing layout: just children, no sidebar
    page.tsx                ← Landing page (server component)
    components/
      Navbar.tsx            ← Sticky nav: logo, links, Sign In / Get Started
      HeroSection.tsx       ← Headline, subheadline, CTAs, hero screenshot
      TrustBar.tsx          ← Stats + placeholder company logos
      FeaturesSection.tsx   ← 4 feature blocks with alternating image/text
      HowItWorks.tsx        ← 6-step numbered flow
      PricingSection.tsx    ← 3 pricing cards (Starter/Pro/Enterprise)
      CtaSection.tsx        ← Final CTA with email signup
      Footer.tsx            ← Links, social, legal
      BrowserMockup.tsx     ← Reusable browser-chrome frame for screenshots
  (auth)/
    layout.tsx              ← REDESIGNED: split-panel layout
    login/page.tsx          ← Unchanged (renders LoginForm)
    signup/page.tsx         ← Unchanged (renders SignupForm)
  components/auth/
    login-form.tsx          ← REDESIGNED: form-only (right panel)
    signup-form.tsx         ← REDESIGNED: form-only (right panel)
    auth-branding-panel.tsx ← NEW: left decorative panel (gradient + tagline + mini screenshot)
```

#### Key Design Decisions

1. **`(marketing)` route group** — separate from `(dashboard)` so it has no sidebar, no session requirement. Layout is just a clean wrapper.

2. **Server components everywhere** — landing page is 100% static. No `"use client"` except the mobile nav hamburger toggle and smooth scroll handler (tiny client islands).

3. **Auth split layout** — the `(auth)/layout.tsx` becomes a 50/50 grid: left panel is `auth-branding-panel.tsx` (gradient mesh + product tagline + mini screenshot), right panel is the form. On mobile, left panel hides and form goes full-width.

4. **BrowserMockup component** — wraps `<img>` in a fake browser chrome (rounded top bar with 3 dots, subtle shadow). Reused for all 5 screenshots.

5. **Font**: Use `Plus Jakarta Sans` from Google Fonts for the landing page (distinctive, geometric — stands out from Inter used in the app). The app dashboard keeps Inter. The marketing layout loads its own font.

6. **Landing page root redirect** — `(marketing)/page.tsx` checks session: if authenticated, `redirect("/")` to dashboard. If not, render landing page. Alternatively, middleware can handle this, but a simple server-component check is simpler.

   Actually, since `(dashboard)/page.tsx` already exists at `/`, the marketing page needs a different approach. Options:
   - **Option A**: Make `(marketing)` the root and move dashboard to `/dashboard` — too disruptive.
   - **Option B**: Use middleware to check auth and serve different content at `/` — clean but complex.
   - **Option C**: Make the landing page at a different route like `/welcome` and redirect unauthenticated `/` to it — simple.
   - **Chosen: Option B** — add a `middleware.ts` that checks the session cookie. If no session and path is `/`, rewrite to `/(marketing)`. All other routes pass through. This is 10 lines of code.

### Flow Diagram

**Unauthenticated user:**
1. Visits `/` → middleware rewrites to marketing landing page
2. Scrolls through hero, features, pricing
3. Clicks "Get Started Free" → navigates to `/signup`
4. Sees split-panel signup (branding left, form right)
5. Signs up → redirected to `/` → middleware sees session → passes through to dashboard

**Authenticated user:**
1. Visits `/` → middleware sees session cookie → passes through to dashboard
2. Dashboard renders as normal

### Dependencies

- **New package:** None. Tailwind CSS + existing shadcn components are sufficient.
- **New font:** `Plus_Jakarta_Sans` from `next/font/google` (only in marketing layout).
- **New env vars:** None.
- **Images:** Already present at `docs/images/`. Need to be moved/symlinked to `public/images/` so Next.js can serve them.

---

## 3. Task Checklist

### Setup

- [ ] Copy `docs/images/*.png` to `apps/web/public/images/` so they're servable as `/images/*.png`
- [ ] Create `apps/web/src/middleware.ts` — check session cookie, rewrite unauthenticated `/` to `/(marketing)`

### Landing Page

- [ ] Create `apps/web/src/app/(marketing)/layout.tsx` — clean wrapper, Plus Jakarta Sans font, no sidebar
- [ ] Create `apps/web/src/app/(marketing)/components/BrowserMockup.tsx` — reusable browser chrome frame
- [ ] Create `apps/web/src/app/(marketing)/components/Navbar.tsx` — sticky nav with logo, links, CTA buttons, mobile hamburger
- [ ] Create `apps/web/src/app/(marketing)/components/HeroSection.tsx` — headline, subheadline, 2 CTAs, hero screenshot in BrowserMockup
- [ ] Create `apps/web/src/app/(marketing)/components/TrustBar.tsx` — stats + placeholder logos
- [ ] Create `apps/web/src/app/(marketing)/components/FeaturesSection.tsx` — 4 alternating feature blocks with screenshots
- [ ] Create `apps/web/src/app/(marketing)/components/HowItWorks.tsx` — 6-step numbered flow
- [ ] Create `apps/web/src/app/(marketing)/components/PricingSection.tsx` — 3 pricing tier cards
- [ ] Create `apps/web/src/app/(marketing)/components/CtaSection.tsx` — final CTA with email input
- [ ] Create `apps/web/src/app/(marketing)/components/Footer.tsx` — links, social, legal
- [ ] Create `apps/web/src/app/(marketing)/page.tsx` — compose all sections into the landing page

### Auth Redesign

- [ ] Create `apps/web/src/components/auth/auth-branding-panel.tsx` — left panel: gradient mesh, tagline, mini product screenshot
- [ ] Redesign `apps/web/src/app/(auth)/layout.tsx` — split-panel grid (left: branding, right: form), responsive (hide left on mobile)
- [ ] Redesign `apps/web/src/components/auth/login-form.tsx` — add OAuth placeholder buttons (Google, GitHub), "Remember me", "Forgot password?" link, clean field labels
- [ ] Redesign `apps/web/src/components/auth/signup-form.tsx` — add Full Name and Confirm Password fields (UI only — backend validation unchanged), OAuth buttons, clean styling

### Wiring

- [ ] Update `apps/web/src/app/(dashboard)/page.tsx` — ensure it still works for authenticated users at `/`
- [ ] Verify middleware correctly routes unauthenticated `/` to marketing page and authenticated `/` to dashboard

### Cleanup

- [ ] Run `npm run type-check` — fix any errors
- [ ] Run `npm run build` — verify no prerender or build errors
- [ ] Test responsive layout at 375px, 768px, 1280px, 1920px widths

---

## 4. Testing Checklist

### Happy Path

- [ ] Unauthenticated user visits `/` and sees the landing page with all sections rendered
- [ ] All 5 product screenshots load and display in browser mockups
- [ ] Clicking "Get Started Free" navigates to `/signup`
- [ ] Clicking "Sign In" navigates to `/login`
- [ ] Anchor links (Features, How It Works, Pricing) smooth-scroll to correct sections
- [ ] Sign up form submits successfully and redirects to dashboard
- [ ] Sign in form submits successfully and redirects to dashboard
- [ ] Authenticated user visiting `/` sees the dashboard (not landing page)

### Validation

- [ ] Login form shows error for invalid credentials
- [ ] Signup form shows error for duplicate username
- [ ] Empty form submissions are blocked (HTML required + Zod validation)

### Edge Cases

- [ ] Landing page renders correctly with no JavaScript (SSR — server components)
- [ ] Mobile nav hamburger opens/closes correctly
- [ ] Split auth layout collapses to single column on mobile (< 768px)
- [ ] Images have proper `alt` text and `loading="lazy"` for below-fold screenshots

### Auth / Permissions

- [ ] Middleware only rewrites `/` — does not interfere with `/login`, `/signup`, `/workspace/*`, `/admin`, `/api/*`
- [ ] No session data is exposed on the public landing page

### UI

- [ ] All interactive elements have visible focus states (keyboard navigation)
- [ ] Pricing cards have hover lift effect
- [ ] Feature sections alternate image left/right on desktop
- [ ] Footer links are organized in columns on desktop, stacked on mobile

### Type Safety & Build

- [ ] `npm run type-check` passes with no new errors
- [ ] `npm run build` succeeds
- [ ] No console errors or warnings in browser dev tools on any page
