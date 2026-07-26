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
https://jaywatt01.github.io/drillstreak-legal/support.html (lists jaywatt01@gmail.com as the support contact, closing that open placeholder too)

## Marketing URL
(optional — skip until the domain is purchased, per DRILLSTREAK.md blocker #2)

## Privacy Policy URL
https://jaywatt01.github.io/drillstreak-legal/legal/privacy-policy.html

## Terms of Service URL (App Store Connect calls this the EULA field, optional but recommended)
https://jaywatt01.github.io/drillstreak-legal/legal/terms-of-service.html

---
**Note (2026-07-26):** these are hosted from a separate small public repo, `jaywatt01/drillstreak-legal`, not the main app repo — `DrillStreak-` stayed private (GitHub Pages requires a public repo on the free plan, and making the actual app source public would have exposed the full RLS/paywall/business logic before launch). Keep the two repos' copies in sync — if the legal docs change here, copy the same edit to `jaywatt01/drillstreak-legal`.

## Age rating self-assessment
Recommend: **4+**, all content descriptors "None" — no violence/mature themes/gambling/web access/user-generated content beyond player display names. Not enrolling in Apple's "Kids Category" — the app's primary account holder is an adult (coach/parent) who signs in and manages the child's profile, not a child using the app independently, so the stricter Kids Category requirements don't fit and aren't required. Worth a final gut-check against Apple's actual questionnaire when you're in App Store Connect, since the exact wording of the questions can shift.

## In-app purchase disclosure
Parent membership, $4.99/month, auto-renewing subscription. Apple's review guideline 3.1.2 also wants explicit renewal/cancellation text near the purchase button in the app itself — this is a separate, still-open item from the paywall build (see DRILLSTREAK.md Step 7), not something App Store Connect asks for directly.

---

## Hosting the legal docs — done (2026-07-26)
GitHub Pages requires a public repo, and making the actual `DrillStreak-` app repo public would have exposed the full source (RLS, paywall, business logic) before launch — Jay also hit a real "visibility couldn't be changed" error trying it directly. Resolved instead with a separate, minimal public repo containing only the static pages: `jaywatt01/drillstreak-legal`. Live and confirmed:
- `https://jaywatt01.github.io/drillstreak-legal/legal/privacy-policy.html`
- `https://jaywatt01.github.io/drillstreak-legal/legal/terms-of-service.html`
- `https://jaywatt01.github.io/drillstreak-legal/support.html`

Once the lawyer signs off on final wording, push the edited HTML to both `DrillStreak-` (source of truth) and `drillstreak-legal` (what's actually served) — same URLs, no App Store Connect changes needed.

## Screenshots — done (2026-07-26)
5 real screenshots captured on Jay's own phone via the dev-client build, saved at `docs/screenshots/` in this repo:
1. `01-today.png` — one drill done ("Cone weave dribbling"), one pending ("Crossover series"), streak showing.
2. `02-my-team.png` — Huskies team, invite code visible, roster shown.
3. `03-add-a-player.png` — join-a-team-by-invite-code view, with the "Joined the team!" confirmation showing.
4. `04-progress.png` — clean single-entry-per-day history (confirms the duplicate-completions fix held).
5. `05-account.png` — both tier cards, Coach (free) and Parent ($4.99/mo).

Upload the originals from Jay's Photos app directly into App Store Connect (not the copies in this repo, which may be recompressed from the upload pipeline) — App Store Connect validates resolution on upload and will flag it immediately if a device-size category doesn't match.
