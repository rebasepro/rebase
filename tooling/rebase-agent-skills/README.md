<h1 align="center">
  Rebase Agent Skills
</h1>

A collection of skills for AI coding agents, to help them understand and work with [Rebase](https://rebase.pro) more effectively.

Skills are packaged instructions and scripts that extend agent capabilities, following the [Agent Skills](https://agentskills.io/home) format.

## Installation

### Option 1: The Rebase CLI (recommended)

`@rebasepro/cli` ships its own installer. It writes the skills — and the
`references/` files they link to — into the layout each agent expects, and
detects which agents a project already uses:

```bash
rebase skills install
```

Name the agents explicitly when there is nothing to detect, or when running
without a TTY. Supported: `claude` (`.claude/skills`), `cursor`
(`.cursor/rules`), `windsurf` (`.windsurf/rules`), `gemini` (`.agents/skills`),
`codex` (`.codex/skills`), `kiro` (`.kiro/steering`) and `copilot`
(`.github/instructions`) — one for every pointer file `rebase init` writes.

```bash
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

### Option 2: The npm package

The skills are published as `@rebasepro/agent-skills`. Add it and copy from
`node_modules/@rebasepro/agent-skills/skills/` into whatever layout your agent
expects — this is what Option 1 automates.

```bash
pnpm add -D @rebasepro/agent-skills
```

### Option 3: Manual set up

Clone the monorepo and copy the `tooling/rebase-agent-skills/skills` directory:

```bash
git clone https://github.com/rebasepro/rebase.git
```

Common destinations:

| Agent | Location | Layout |
|---|---|---|
| Claude Code | `.claude/skills/<name>/SKILL.md` | one directory per skill |
| Cursor | `.cursor/rules/<name>.mdc` | flat |
| Windsurf | `.windsurf/rules/<name>.md` | flat |
| Gemini CLI / Antigravity | `.agents/skills/<name>/SKILL.md` | one directory per skill |
| Codex CLI | `.codex/skills/<name>/SKILL.md` | one directory per skill |
| Kiro | `.kiro/steering/<name>.md` | flat |
| GitHub Copilot | `.github/instructions/<name>.instructions.md` | flat |

### Option 4: Agent Skills CLI, from a local clone

The `skills` CLI can install from a directory:

```bash
npx skills add /path/to/rebase/rebase-agent-skills/skills
```

To pick up later edits to that directory:

```bash
npx skills experimental_install
```

<!-- docs-verify: ignore -->
> **There is no standalone `rebaseco/agent-skills` repository.** These skills
> live in the Rebase monorepo, at `tooling/rebase-agent-skills/`, and ship as an npm
> package. Commands that name a standalone repo — `npx skills add
> rebaseco/agent-skills`, `gemini extensions install
> https://github.com/rebaseco/agent-skills`, `claude plugin marketplace add
> rebaseco/agent-skills` — resolve to nothing. Use `rebase skills install`,
> which is first-party and needs no repository at all.

### Option 5: Local development (live symlinking)

If you are actively contributing to or developing these skills, use a symlink so that changes in your local clone are immediately reflected in your test project.

For example, to test with Cursor:

```bash
ln -s /path/to/rebase-agent-skills/skills /path/to/your/test-project/.cursor/rules
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request (PR)

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

**Made with ❤️ from Rebase for the AI community**
