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
(`.cursor/rules`), `windsurf` (`.windsurf/rules`), `gemini` (`.agents/skills`).

```bash
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

### Option 2: Agent Skills CLI

For most popular AI-assistive tools, you can use the `skills` CLI to install Rebase agent skills:

```bash
npx skills add rebaseco/agent-skills
```

### Option 3: Gemini CLI Extension

This repository is configured as a Gemini CLI extension. You can add it using the Gemini CLI:

```bash
gemini extensions install https://github.com/rebaseco/agent-skills
```

### Option 4: Claude Plugin

1. Add the Rebase marketplace for Claude plugins:

```bash
claude plugin marketplace add rebaseco/agent-skills
```

Install the Claude plugin for Rebase:

```bash
claude plugin install rebase@rebaseco
```

Verify the installation:

```bash
claude plugin marketplace list
```

### Option 5: Manual Set Up

1. Clone this repository:

```bash
git clone https://github.com/rebaseco/agent-skills.git
```

2. Copy the contents of the `skills` directory to the appropriate location for your AI tool. Common locations include:
   - **Cursor**: `.cursor/rules/`
   - **Windsurf**: `.windsurf/rules/`
   - **GitHub Copilot**: `.github/copilot-instructions.md` (or project-specific instruction files)

### Option 6: Local Path via Agent Skills CLI

The `skills` CLI also supports installing skills from a local directory. If you have cloned this repository, you can add skills by pointing the CLI to your local folder:

```bash
npx skills add /path/to/your/local/rebase-agent-skills/skills
```

If you make changes to the local skills repository and want to update your project with the new changes, you can update them by running:

```bash
npx skills experimental_install
```

### Option 7: Local Development (Live Symlinking)

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
