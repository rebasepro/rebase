# Channel authorization — what was built, and the decision that is still open

Written alongside the fix for audit 33 (H1). The audit found that nothing anywhere
authorized a channel frame, while three places made security decisions on the
assumption that something did:

- `channel-presence.ts` and `channel-history.ts` both take their table *out* of the
  RLS model, each citing "the channel rules the server evaluates before it reads";
- `docs/sdk/realtime.md` told users "the server still authorizes every frame".

So a client could replay any retained channel's history, read any channel's presence
roster, and inject broadcasts into any channel it could name — without joining it,
and on a deployment with no auth adapter, without an account.

## What is implemented now

**Membership is the floor.** `RealtimeService.authorizeChannelAction` is the single
door every channel frame passes through (`handleChannelMessage` routes all seven
wire types into it). Broadcasting, reading presence and replaying history all
require that this client has joined that channel; a refusal answers the sender with
a `CHANNEL_FORBIDDEN` error. `leave_channel` and `presence_untrack` are ungated —
they only ever remove the caller's own state.

**The gate fails closed.** An authorizer that throws or rejects refuses the frame.

**One extension point.** `setChannelAuthorizer()` takes a
`(channel, action, clientId, user) => boolean | Promise<boolean>` and is consulted
after the membership floor, so it can only narrow. It is deliberately *not* reachable
from config — see below. It is the seam, not the feature.

This closes the gap between the code's claims and its behaviour. It does not make
channels access-controlled.

## What is still open — the decision for the maintainer

Joining remains open to anyone who can name a channel. Membership therefore proves
"this client asked", not "this client is allowed". For the documented collaborative
editor (`doc:*`), any authenticated user — or any visitor, when auth is not required —
can still join `doc:42` and see its history and roster. The docs now say so plainly
in both `sdk/realtime.md` and `backend/realtime.md`; that is honesty, not a fix.

The actual product decision, which an audit fix should not make unilaterally:

1. **What shape are the rules?** The audit suggested a `realtime.authorizeChannel`
   hook mirroring `storageAuthorize` (`packages/server/src/init.ts`). The alternative
   is declarative, per-pattern rules alongside the existing `channels` retention
   rules — closer to how `securityRules` reads, and inspectable at boot rather than
   only at runtime. A hook is more expressive; rules are checkable and serializable.
   Or both, as storage does.

2. **What is the default?** Default-allow keeps every existing deployment working and
   leaves the hole open for anyone who does not opt in. Default-deny-unless-named is
   the fail-closed choice and breaks every existing channel user at upgrade. A middle
   option: default-allow, but refuse to enable **retention** on a channel pattern with
   no rule attached, since retention is the case where the exposure becomes durable
   and is already opt-in.

3. **Is it evaluated per join or per frame?** Per join is one evaluation cached on the
   membership entry (what the audit proposed) and cannot react to a permission that is
   revoked mid-session. Per frame is correct and costs an evaluation per cursor move.

4. **Does it compose with RLS?** The natural expression of "may read `doc:42`" is the
   row policy on the document, which would mean a channel rule that could run a query
   as the user. That is powerful and is also a per-frame database round trip.

Until (1)–(4) are answered, `ChannelAuthorizer` stays internal: exporting a config key
would freeze the answer (see `docs/bug-classes.md` on derived names being frozen once
shipped).

## Related, also the maintainer's call

**The channel rate budget.** `WS_CHANNEL_RATE_LIMIT` (7200/min per client) was sized
from the documented workload — 60 fps cursors plus the presence update each carries —
because the previous shared budget (2000/min, 33/s) refused it two orders of magnitude
early and the refusal was discarded by the client. It is a number derived from the
docs, not a considered product limit, and it is not configurable.
