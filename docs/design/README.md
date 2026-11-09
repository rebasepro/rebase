# Design references

Reference material behind decisions in `@rebasepro/ui`. These are inputs, not
authority: the tokens in `packages/ui/src/theme.css` and `packages/ui/DESIGN.md`
are what the product follows.

Open proposals live here too, each with a `Status:` line:

- `rebase-user-on-existing-databases.md` covers making the RLS request role
  (`rebase_user`) safe on existing and shared Postgres databases. Proposal,
  2026-11-09.

- `instatic-distilled.html` — Instatic's admin design system reconstructed from
  screenshots (September 2026), with live specimens, a token-by-token map
  against Rebase, and the dark-mode surfaces measured on demo.rebase.pro. Open
  the file in a browser; it is self-contained. Also published at
  https://claude.ai/code/artifact/9675dafd-61dd-4382-8ff2-9120d75fd9ed.
  It is the source for the surface system in `packages/ui/DESIGN.md`.
