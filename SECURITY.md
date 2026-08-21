# Security Policy

## Supported Versions

Rebase is pre-1.0 and moves quickly. Security fixes land on the **latest minor
release line only**; older lines do not receive backports.

| Version | Supported |
| ------- | --------- |
| Latest minor (currently 0.16.x) | ✅ Yes |
| Anything older | ❌ No — please upgrade |

The table names a version so you can check yourself at a glance, but the rule is
the one above it: whatever the newest minor on npm is, that is the supported
line. `npm view @rebasepro/server version` answers it authoritatively.

Rebase Cloud (`app.rebase.pro`) always runs a supported version. If you self-host,
upgrading to the latest minor is the supported path to a security fix.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for a security problem.**

Email **security@rebase.pro**.

Helpful things to include, as far as you have them:

- What component is affected — the open-source server or SDK, the CLI, the admin
  UI, Rebase Cloud (`app.rebase.pro` / `*.rebase.website`), or the website.
- The version or commit you tested against.
- Steps to reproduce, and what an attacker gets out of it.
- Any proof-of-concept code, logs or screenshots.

If you would rather encrypt your report, say so in a first message and we will
arrange a key.

## What to Expect

- **Acknowledgement.** We aim to acknowledge a report within a few business days.
  Rebase is a small team, so please allow for time zones and weekends.
- **Assessment.** We will tell you whether we can reproduce the issue and how we
  are triaging it.
- **Fix and disclosure.** We will keep you updated while we work on a fix. We
  prefer coordinated disclosure: please give us a reasonable window to ship a fix
  and, for Rebase Cloud, to notify affected customers before you publish.
- **Credit.** If you would like to be credited in the release notes for the fix,
  tell us the name or handle to use. If you would rather stay anonymous, that is
  fine too.

We do not currently run a paid bug bounty programme, so we cannot promise a
monetary reward.

## Scope

**In scope**

- This repository — the Rebase server, client SDK, CLI, admin UI and packages
  published from it.
- Rebase Cloud: `app.rebase.pro` and tenant applications on `*.rebase.website`.
- The website `rebase.pro`.
- Issues that break tenant isolation, authentication, authorization (including
  row-level security enforcement), secret handling, or that allow remote code
  execution, injection, or unauthorized data access.

**Out of scope**

- Findings against a Rebase deployment you do not own or have permission to test.
  If you self-host, test your own instance.
- Denial of service, load testing, or automated scanning against Rebase Cloud or
  our website.
- Social engineering, phishing, or physical attacks against Rebase staff or users.
- Vulnerabilities in third-party services we depend on — report those to the
  vendor. Tell us anyway if the exposure is specific to how Rebase uses them.
- Missing security headers, missing SPF/DMARC records, or scanner output with no
  demonstrated impact.
- Anything requiring a compromised device, a rooted browser, or an already
  privileged account, unless it results in privilege escalation beyond that
  account.

## Testing Guidance

If you are testing Rebase Cloud, please use your own account and your own
projects, keep the volume low, and do not access, modify, or exfiltrate another
customer's data. If you reach a point where continuing would expose someone
else's data, stop and report what you have.

## Related

- Vulnerability contact in machine-readable form:
  <https://rebase.pro/.well-known/security.txt>
- How Rebase Cloud is architected and where data lives:
  <https://rebase.pro/security>
