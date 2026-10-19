# idem — deploy to iDeploy from your terminal

```bash
npm install -g @idem-ai/cli          # or, before it is on npm: npm install -g github:Idem-AI/cli
cd my-project
idem deploy
```

That is the whole thing. The first time, `idem deploy`:

1. **signs you in** — your browser opens on iDeploy with a code; check it matches the terminal and click *Authorise*;
2. **creates the application** — asks for its name (the folder's by default) and its workspace;
3. **sends your code** — as Git sees it: `.gitignore` and `.idemignore` respected, never `node_modules`, `.git` or your `.env`;
4. **offers your `.env` variables** — iDeploy replaces local addresses (`localhost`, `127.0.0.1`) with the databases, Redis and RabbitMQ of the workspace;
5. **follows the deployment live** and ends with the address.

The next times, it just sends the new code and deploys. The folder remembers its application in `.idem/project.json` (kept out of Git).

```
┌  idem deploy
◇  Project read: 412 files, 3.1 MB
◇  Code sent to g-requete
◆  Deploying g-requete (abf35520)
│  ──► Build strategy: recipe (Laravel)
│  ✓ Release command done.
└  Live at https://g-requete.idem.africa  (2 min 31)
```

Not sure what to type? Run **`idem`** alone: a menu lists what you can do with the application of this folder.

## Deploy anything

```bash
idem deploy                                   # this folder
idem deploy --git https://github.com/me/app   # a repository (--branch, --base-dir for a monorepo)
idem deploy --image ghcr.io/me/api:1.4        # an image (--registry-user + IDEM_REGISTRY_PASSWORD if private)
idem deploy --compose docker-compose.yml      # your own stack, as a service
idem deploy --template n8n                    # a one-click service (idem templates lists them)
```

A new application goes into a **workspace** — everything in it shares one network, and its databases are linked to its applications. It runs on **IDEM's infrastructure** (nothing to manage; `--region` when your plan allows) or on **one of your servers** (`--server <name>`). On a terminal, `idem deploy` asks; in CI, flags answer.

Build settings when the detection needs help: `--base-dir`, `--install`, `--build`, `--start`, `--port`, `--publish-dir`.

## Commands

| Applications | |
|---|---|
| `idem deploy` | Deploy (see above). `-y` asks nothing, `-d` does not wait, `-a <app>` targets an application, `--env [file]` sends variables with a new one |
| `idem apps` | Your applications, with their status and address |
| `idem status` · `idem deployments` | The application and its containers · its deployment history |
| `idem logs [-f]` | What the running application prints; `-f` follows it |
| `idem open [--dashboard]` | Open the application — or its page on iDeploy |
| `idem restart` · `start` · `stop` | Its lifecycle |
| `idem rollback [--to <id>]` | Back to an earlier version |
| `idem destroy` | Delete it, its data and its address (asks for its name) |
| `idem env [ls\|set\|rm\|pull]` | Variables: list (hidden; `--reveal`), `set KEY=value…`, `rm KEY…`, `pull` into a local `.env` |
| `idem domains [ls\|add\|rm]` | Its addresses with their DNS/HTTPS state; `add` your domain and get the DNS record to create |
| `idem link` · `unlink` | Link this folder to an existing application, or forget it |

| Infrastructure | |
|---|---|
| `idem workspaces [ls\|create\|show\|rm]` | Where things run together; `create --server <name>` or `--region <code>` |
| `idem db [ls\|create\|show\|start\|stop\|restart\|backup\|rm]` | PostgreSQL, MySQL, MariaDB, MongoDB, Redis, KeyDB, Dragonfly, ClickHouse, RabbitMQ; `show --reveal` gives the credentials |
| `idem services [ls\|start\|stop\|restart\|rm]` · `idem templates [search]` | Compose stacks and the catalogue |
| `idem servers [ls\|add\|check\|setup\|rm]` | Your own servers: `add` generates the SSH key (or uses yours), checks the server and installs Docker and the proxy |

| Account | |
|---|---|
| `idem login` · `logout` · `whoami` | Sign in through the browser (`--token` for CI) · sign out and revoke this machine's token |
| `idem dashboard` | Open iDeploy |
| `idem` | A menu of all this, for the application of this folder |

Every command takes `--json` for scripts.

## Help, language, completion

- `idem --help` — the commands grouped by what they are for, with examples; `idem <command> --help` ends with its own examples. A mistyped command gets a suggestion (`idem deplo` → `idem deploy`).
- **French or English**: the CLI follows your system's language. Force it with `IDEM_LANG=fr` (or `en`), or `--lang fr` on one command.
- **Tab completion**:

```bash
idem completion bash >> ~/.bashrc
idem completion zsh  >> ~/.zshrc
idem completion fish > ~/.config/fish/completions/idem.fish
```

## In CI

Create a token on iDeploy (*Security › API tokens*) and give it as `IDEM_TOKEN`:

```yaml
- run: npx @idem-ai/cli deploy --yes --app my-app
  env:
    IDEM_TOKEN: ${{ secrets.IDEM_TOKEN }}
```

The command fails (exit code 1) when the deployment fails; the previous version keeps serving.

## Limits

The CLI sends up to 3000 files and 9 MB (before compression). A larger project: add what its build does not need to `.idemignore` (same syntax as `.gitignore`) — the CLI names the heaviest folders — or deploy it from its Git repository on iDeploy.

## Configuration

| | |
|---|---|
| `~/.config/idem/config.json` | your token (readable by you only) |
| `IDEM_TOKEN` | a token, instead of signing in |
| `IDEM_API_URL` | another iDeploy instance (`idem login --api <url>` keeps it) |

## Develop

```bash
npm install
npm run build && node dist/index.js --help
```
