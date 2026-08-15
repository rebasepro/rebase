# LEGAL-TODO — issues for counsel to fix in the public legal documents

Compiled 2026-07-22 as part of the trust-surface audit. **Nothing in this list has
been edited.** These are binding legal documents; they need a lawyer and a
product decision, not a copy edit.

All line numbers are against the working tree at the time of writing. All quotes
are verbatim from the rendered copy in those files.

Context that drives most of these findings: **Rebase now operates a hosted
multi-tenant service (Rebase Cloud, `app.rebase.pro`) that stores other people's
production databases and files on Google Cloud in `europe-west1` (Belgium).** The
three policy documents predate that service. They are Termly-style templates for
a marketing website, inherited from the FireCMS-era site and re-dated to
**April 8, 2026** — the day they were adopted under the Rebase name, not the day
anyone reviewed them. See item 7.

---

## 1. The content licence claims the right to sell customer contributions

**File:** `src/pages/policy/terms_conditions.astro`
**Line:** 632

> "you automatically grant, and you represent and warrant that you have the right
> to grant, to us an unrestricted, unlimited, irrevocable, perpetual,
> non-exclusive, transferable, royalty-free, fully-paid, worldwide right, and
> license to host, use, copy, reproduce, **disclose, sell, resell**, publish,
> broadcast, retitle, archive, store, cache, publicly perform, publicly display,
> reformat, translate, transmit, excerpt (in whole or in part), and distribute
> such Contributions (including, without limitation, your image and voice) for any
> purpose, commercial, advertising, or otherwise, and to prepare derivative works
> of, or incorporate into other works, such Contributions, and grant and authorize
> sublicenses of the foregoing."

**Why it is a problem.** "Contributions" is defined broadly enough in this template
that a customer's counsel will read it as reaching content submitted through the
service. A perpetual, irrevocable right to *sell and resell* customer content is
the single most likely clause to kill an enterprise deal, and it is flatly
inconsistent with the security page's positioning and with a processor
relationship where Rebase may only process on the controller's instructions.

**Decision needed.** Scope "Contributions" to public, voluntary submissions (forum
posts, testimonials, community content) and explicitly carve out customer data
processed in Rebase Cloud. Delete "sell, resell" and "disclose". Consider limiting
the licence to what is operationally necessary to run the service.

---

## 2. The privacy policy states servers are in Spain and data may go to the US

**File:** `src/pages/policy/privacy_policy.astro`
**Lines:** 485, 491–492, 498

> Line 485: "We may transfer, store, and process your information in countries
> other than your own."

> Lines 491–492: "Our servers are located in Spain. If you are accessing our
> Services from outside Spain, please be aware that your information may be
> transferred to, stored, and processed by us in our facilities and by those third
> parties with whom we may share your personal information … in the United States,
> and other countries."

**Why it is a problem.** This is factually wrong about the production reality and
wrong in the direction that hurts: Rebase Cloud runs on Google Kubernetes Engine
in `europe-west1` (Belgium), not Spain, and the whole EU-residency story on the
security page depends on saying so. Meanwhile the "may be transferred to … the
United States" sentence invites a Chapter V transfer analysis that the actual
architecture does not require. A reviewer who reads the security page and then
this paragraph will conclude one of the two is untrue.

**Decision needed.** State the actual hosting location(s). If any genuine third
country transfer exists (support tooling, analytics, payment processing, email
delivery), name it and name the transfer mechanism (SCCs, adequacy). Do not leave
a blanket US clause in as a hedge.

---

## 3. The terms say the same thing about Spain

**File:** `src/pages/policy/terms_conditions.astro`
**Lines:** 765–771 (also 910, 918, 982, 985, 1264)

> "…governing personal data collection, use, or disclosure that differ from
> applicable laws in **Spain**, then through your continued use of the Site, you
> are transferring your data to **Spain**, and you agree to have your data
> transferred to and processed in **Spain**."

**Why it is a problem.** Same factual contradiction as #2, in the document that
actually binds the customer. Lines 982/985 also set the governing law and venue
(Madrid, Spain) — that part may well be correct and intentional; the *data
location* claim is the part that is wrong.

**Decision needed.** Separate "where the company is established / which law
governs" (Spain, presumably correct) from "where data is processed"
(Google Cloud `europe-west1`, Belgium).

---

## 4. Neither document contemplates a hosted service at all

**Files:** `src/pages/policy/terms_conditions.astro`, `src/pages/policy/privacy_policy.astro`

Evidence:

- `privacy_policy.astro` lines 29–30 scope the notice to: "Visit our website at
  https://rebase.pro, or any website of ours that links to this privacy notice".
  `app.rebase.pro` and `*.rebase.website` are never mentioned. The tenant move
  onto `rebase.website` (2026-07-30) widens this gap rather than narrowing it:
  tenant applications are now on a **different registrable domain**, so the
  "any website of ours that links to this privacy notice" catch-all reaches them
  even less plausibly than before — a tenant app has no reason to link here at
  all. The notice needs to name the domain explicitly.
- `terms_conditions.astro` line 191–193 defines the agreement as covering the
  "https://rebase.pro website as well as any other media form, media channel,
  mobile website or mobile application related, linked, or otherwise connected
  thereto (collectively, the 'Site')". A hosted database platform is not a
  "media channel".
- Searching both files for `processor`, `controller`, `sub-processor`, `DPA`, and
  `Data Processing Agreement` returns **zero matches**.
- There is no paid-service, subscription, billing, termination, data-export, or
  data-deletion-on-termination language anywhere in the terms, despite Rebase
  Cloud having Stripe billing.

**Why it is a problem.** There is currently no contract governing the hosted
service, no allocation of controller/processor roles, no Article 28 processing
terms, no security commitments, no breach-notification commitment, no
data-return-and-deletion clause, and no service description. Any customer with a
procurement process will ask for all of these on day one.

**Decision needed.** Counsel should decide whether Rebase Cloud gets its own
Terms of Service (recommended) or an addendum, plus:

1. **A Data Processing Agreement** (GDPR Art. 28) with Rebase as processor.
2. **A sub-processor list**, published and versioned, with a change-notification
   commitment. At minimum it must name **Google Cloud (Google Ireland Ltd / Google
   LLC)** as the infrastructure sub-processor, plus Stripe (billing) and any email
   delivery provider — the exact corporate entities need confirming.
3. **Security commitments** matching what the platform actually does. The verified
   set, as of this audit, is: per-tenant Kubernetes namespace with an
   ingress+egress NetworkPolicy; a dedicated CloudNativePG PostgreSQL cluster per
   tenant; TLS in transit (GKE ManagedCertificate for the console, Let's Encrypt
   via cert-manager for tenant domains); control-plane secrets encrypted at rest
   with AES-256-GCM; nightly base backups with WAL archiving under a 30-day
   retention policy.
4. **Breach notification** timing.
5. **Data export and deletion on termination.**

---

## 5. The terms link to a privacy policy URL that does not exist

**File:** `src/pages/policy/terms_conditions.astro`
**Lines:** 761–762

> `https://rebase.pro/privacy_policy`

The live path is `https://rebase.pro/policy/privacy_policy`. The terms incorporate
the privacy policy by reference through a 404. Trivial to fix, but it sits inside
a binding document, so it is listed here rather than fixed unilaterally.

---

## 6. The cookie policy declares US-based analytics while the privacy story claims EU

**File:** `src/pages/policy/cookies_policy.astro`
**Lines:** 104–110 (Google Analytics), 143 (second entry)

> Service: "Google analytics" — Country: "**United States**"

**Why it is a problem.** Not necessarily wrong, but it needs to be reconciled with
whatever #2 ends up saying, and with the consent banner: if analytics cookies fire
before consent, that is a separate compliance exposure. Worth confirming that
`src/components/CookieBanner.astro` actually gates them.

---

## 7. Documents are stale and visibly templated

**Files:** all three

- ~~`terms_conditions.astro` line 35: "Last updated **May 25, 2022**"~~
- ~~`cookies_policy.astro` line 19: "Last updated **May 25, 2022**"~~
- ~~`privacy_policy.astro` line 21: "Last updated **April 10, 2023**"~~

  **Partially addressed 2026-08-16.** All three now read **April 8, 2026**.
  Those dates were impossible, not merely stale: they were inherited from the
  FireCMS-era site along with the documents themselves, and someone
  find-and-replaced FireCMS → Rebase without touching them — so the privacy
  notice named "Rebase, S.L." as controller and dated itself eleven months
  before `@rebasepro/cli` was first published (2026-03-30). April 8, 2026 is
  the day `git` records the documents being adopted onto this site under the
  Rebase name, which is genuinely when they last changed in substance.

  **This is an adoption date, not a review date, and counsel must not read it
  as one.** Everything else in this file is still open. Whoever does the
  rewrite re-dates all three again on publication.
- `terms_conditions.astro` contains **36** occurrences of
  `class="statement-end-if-in-editor"` and numerous `<bdt class="question">`
  wrappers — leftover Termly template-editor markup shipped into production HTML.
  It renders invisibly, but anyone who views source sees that the document was
  never reviewed.

**Decision needed.** Re-date on publication and strip the template artefacts as
part of whatever rewrite counsel does.

---

## 8. Retention promise may be unachievable for Cloud

**File:** `src/pages/policy/privacy_policy.astro`
**Line:** 516

> "No purpose in this notice will require us keeping your personal information for
> longer than the period of time in which users have an account with us."

**Why it is a problem.** Rebase Cloud retains database backups for **30 days**
(CNPG `retentionPolicy: "30d"`). If an account is deleted, personal data survives
in backups for up to 30 days afterwards. That is a normal and defensible practice,
but the current sentence promises otherwise.

**Decision needed.** Add a backup-retention carve-out with the real number.

---

## 9. No security or privacy contact in the documents

All three documents route everything to `hello@rebase.pro`. There is no
`security@rebase.pro`, no DPO or Art. 27 representative, and no
vulnerability-disclosure reference.

`SECURITY.md` and `/.well-known/security.txt` were added in this same change and
publish `security@rebase.pro`. Counsel should decide whether the privacy notice
also needs a dedicated privacy contact and whether a DPO or EU representative is
required for the volume and nature of processing.

---

## Out of scope for this file

Deliberately **not** changed anywhere in this branch: the Terms of Service, the
Privacy Policy, the Cookie Policy, and any DPA or sub-processor annex. The only
edits made were to non-binding marketing copy (`SecurityContent.astro`,
`ContactContent.astro`, `Footer.astro`), plus the new `SECURITY.md` and
`security.txt`.
