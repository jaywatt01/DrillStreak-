# App Store Connect listing — draft (July 26, 2026)

Everything below is ready to paste into App Store Connect except screenshots (needs Jay's phone) and the privacy policy URL (needs GitHub Pages enabled — see bottom).

## App name
DrillStreak

## Subtitle (30 char max)
Assign drills. Track streaks.

## Category
Primary: Health & Fitness
Secondary: Sports

## Promotional text (170 char max, editable anytime without review)
Coaches assign drills, players log real work, everyone sees the streak. Free for coaches. No more "I did like 200 and something" self-reports.

## Description
DrillStreak turns "go work on your game" into something you can actually see happen.

A coach creates a team and assigns drills to the roster each week. Players (or a parent, for younger athletes) log what they actually did — and everyone can see the consistency streak build. No more guessing whether the extra work is really getting done.

WHAT IT DOES
- Coaches: create a team, share an invite code, assign this week's drills, see your roster's real activity — all free, forever.
- Players & parents: log completed drills in seconds, build a streak, add any drill to your calendar with your own time and duration.
- Pick from a built-in drill library or create your own custom drills — nothing is locked to one sport.
- One account can be both a coach and a parent at the same time.

WHO IT'S FOR
Any coach or self-motivated athlete who wants real accountability instead of a self-reported "yeah I did it." Built by a coach, for the exact problem of not knowing what actually happened at home.

FREE VS. PARENT MEMBERSHIP
- Free: this week's activity, one linked player, unlimited custom drills, every coach feature at no cost.
- Parent membership ($4.99/month): full progress history and unlimited linked players.

Coach features are free permanently — they always will be.

## Keywords (100 char max, comma-separated, no spaces after commas)
basketball,training,drills,coach,streak,accountability,youth sports,workout,team,roster

## Support URL
https://jaywatt01.github.io/DrillStreak-/support.html (live once GitHub Pages is enabled — see below. Lists jaywatt01@gmail.com as the support contact, closing that open placeholder too.)

## Marketing URL
(optional — skip until the domain is purchased, per DRILLSTREAK.md blocker #2)

## Privacy Policy URL
https://jaywatt01.github.io/DrillStreak-/legal/privacy-policy.html (live once GitHub Pages is enabled — see below)

## Terms of Service URL (App Store Connect calls this the EULA field, optional but recommended)
https://jaywatt01.github.io/DrillStreak-/legal/terms-of-service.html

## Age rating self-assessment
Recommend: **4+**, all content descriptors "None" — no violence/mature themes/gambling/web access/user-generated content beyond player display names. Not enrolling in Apple's "Kids Category" — the app's primary account holder is an adult (coach/parent) who signs in and manages the child's profile, not a child using the app independently, so the stricter Kids Category requirements don't fit and aren't required. Worth a final gut-check against Apple's actual questionnaire when you're in App Store Connect, since the exact wording of the questions can shift.

## In-app purchase disclosure
Parent membership, $4.99/month, auto-renewing subscription. Apple's review guideline 3.1.2 also wants explicit renewal/cancellation text near the purchase button in the app itself — this is a separate, still-open item from the paywall build (see DRILLSTREAK.md Step 7), not something App Store Connect asks for directly.

---

## Hosting the legal docs (needed before submission, not before writing the rest of this listing)
No domain is purchased yet, so the fastest real fix is GitHub Pages on the existing repo — free, and swappable to a real domain later without changing the listing (Apple just needs *a* stable URL, not a *final* one).

1. On github.com, go to `jaywatt01/DrillStreak-` → **Settings** → **Pages** (left sidebar).
2. Under "Build and deployment," set **Source: Deploy from a branch**, **Branch: main**, folder **/(root)**. Save.
3. GitHub builds it (~1 minute). The docs will land at:
   - `https://jaywatt01.github.io/DrillStreak-/legal/privacy-policy.html`
   - `https://jaywatt01.github.io/DrillStreak-/legal/terms-of-service.html`
4. Once your lawyer signs off on final wording, just push the edited HTML to `main` again — same URL, no App Store Connect changes needed.

## Screenshots — needs your phone, can't be done from here
Apple requires real screenshots of the actual native app (6.7" display size at minimum), and there's no substitute for that from this sandbox — a headless-browser render of the Expo web preview would show React-Native-Web's layout, not the real iOS native rendering, and wouldn't match Apple's required pixel dimensions. This is the one piece of Step 3 that has to wait for you.

Shot list (5, one per tab), captured on your own phone in the dev-client build:
1. **Today** — with at least one drill marked done and one still pending, so the streak counter and both states show.
2. **My Team** — roster visible with your real team and invite code.
3. **Add a Player** — the join-by-invite-code view.
4. **Progress** — after the SQL cleanup, a clean single-entry-per-day history.
5. **Account** — the real tier cards (Coach free / Parent $4.99).

Standard iOS screenshot (side button + volume up) is fine — Apple's upload tool accepts the native resolution directly.
