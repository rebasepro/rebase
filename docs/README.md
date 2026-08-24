# docs/

Three kinds of document live here, and they age differently. Put a new one in
the directory that matches how it should be read later.

| | What it is | How to read it |
| --- | --- | --- |
| `docs/*.md` | **Reference.** How something works *now*. | Trust it. If it is wrong, fix it. |
| `docs/plans/` | **Proposals and design notes.** Each carries a `Status:` line saying whether it shipped. | Read the status first — several are implemented, one is superseded. |
| `docs/audits/` | **Point-in-time findings.** Dated, and true as of that date. | Historical. Do not "fix" one; write a new one. |

`audits/audit-map.md` is the register of what is worth auditing on its own, and
the numbered files (`01-`…) are the sittings it has produced so far.

Two constraints worth knowing before moving anything in here:

- **`compatibility.md` stays at this level.** Its path appears in runtime error
  messages (`tooling/scripts/check-derived-names.mts`, `tooling/scripts/derived-names.mts`)
  that users have already seen, and `website/scripts/copy_repo_docs.js` copies
  it into the published site by that exact path.
- **Links between these files are relative.** Moving a file means every link
  into it, and every link out of it, is recomputed from the new depth — 70 of
  them moved the last time this was reorganised.
