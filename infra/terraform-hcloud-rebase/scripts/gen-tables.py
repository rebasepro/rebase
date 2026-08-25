#!/usr/bin/env python3
"""Regenerate the input/output tables in README.md from the .tf sources.

Hand-maintained Terraform docs drift the moment someone adds a variable, and a
table that lies about a default is worse than no table. This reads the actual
`variable` and `output` blocks and rewrites the region between the
BEGIN_TABLES / END_TABLES markers.

    python3 scripts/gen-tables.py            # rewrite README.md
    python3 scripts/gen-tables.py --check    # exit 1 if it would change

`--check` is the CI gate: it fails when the README no longer matches the code.
This exists rather than a terraform-docs dependency because it is 60 lines and
one fewer thing to install.
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BEGIN = "<!-- BEGIN_TABLES -->"
END = "<!-- END_TABLES -->"


def blocks(path, kind):
    src = io.open(os.path.join(HERE, path), encoding="utf-8").read()
    return re.findall(r'^%s "([^"]+)" \{\n(.*?)^\}$' % kind, src, re.M | re.S)


def field(body, name):
    """First paragraph of a heredoc, or the quoted scalar, or the raw value."""
    m = re.search(r"^\s*%s\s*=\s*<<-?EOT\n(.*?)^\s*EOT\s*$" % name, body, re.M | re.S)
    if m:
        para = m.group(1).strip().split("\n\n")[0]
        return " ".join(line.strip() for line in para.split("\n")).strip()
    m = re.search(r'^\s*%s\s*=\s*"((?:[^"\\]|\\.)*)"\s*$' % name, body, re.M)
    if m:
        return m.group(1).replace('\\"', '"')
    m = re.search(r"^\s*%s\s*=\s*(.+?)$" % name, body, re.M)
    return m.group(1).strip() if m else None


def cell(text):
    return (text or "").replace("|", "\\|")


def render():
    out = ["### Inputs", "", "| Name | Type | Default | Description |", "| --- | --- | --- | --- |"]
    rows = []
    for name, body in blocks("variables.tf", "variable"):
        default = field(body, "default")
        if default is None:
            shown, required = "**required**", True
        elif default == "null":
            shown, required = "`null`", False
        else:
            shown, required = "`%s`" % default, False
        rows.append((required, name, field(body, "type") or "string", shown, field(body, "description")))

    # Required first, then alphabetical: the reading order is "what must I set".
    for required, name, type_, default, desc in sorted(rows, key=lambda r: (not r[0], r[1])):
        out.append("| `%s` | `%s` | %s | %s |" % (name, type_, default, cell(desc)))

    out += ["", "### Outputs", "", "| Name | Description |", "| --- | --- |"]
    for name, body in blocks("outputs.tf", "output"):
        sensitive = " *(sensitive)*" if re.search(r"^\s*sensitive\s*=\s*true", body, re.M) else ""
        out.append("| `%s` | %s%s |" % (name, cell(field(body, "description")), sensitive))

    return "\n".join(out)


def main():
    path = os.path.join(HERE, "README.md")
    readme = io.open(path, encoding="utf-8").read()
    if BEGIN not in readme or END not in readme:
        sys.exit("README.md is missing the %s / %s markers" % (BEGIN, END))

    updated = re.sub(
        re.escape(BEGIN) + r".*?" + re.escape(END),
        "%s\n\n%s\n\n%s" % (BEGIN, render(), END),
        readme,
        flags=re.S,
    )

    if "--check" in sys.argv:
        if updated != readme:
            sys.exit("README.md tables are stale — run: python3 scripts/gen-tables.py")
        print("README.md tables match the .tf sources")
        return

    io.open(path, "w", encoding="utf-8").write(updated)
    print("README.md tables regenerated")


if __name__ == "__main__":
    main()
