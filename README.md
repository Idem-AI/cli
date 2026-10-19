# idem — deploy to iDeploy from your terminal

```bash
npm install -g @idem-ai/cli
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

## Commands

| Command | |
|---|---|
| `idem deploy` | Deploy this folder (creates the application the first time). `-y` asks nothing, `-d` does not wait, `-a <app>` targets an application, `--env` sends `.env` with a new one |
| `idem login` / `logout` / `whoami` | Sign in through the browser (`--token` for CI) · sign out and revoke this machine's token |
| `idem apps` | Your applications, with their status and address |
| `idem link` / `unlink` | Link this folder to an existing application, or forget it |
| `idem logs [-f]` | What the running application prints; `-f` follows it |
| `idem status` | The application, its containers and its last deployment |
| `idem open [--dashboard]` | Open the application — or its page on iDeploy |
| `idem restart` | Restart it (asks first; `-y` does not) |
| `idem rollback [--to <id>]` | Back to an earlier version |
| `idem env [ls\|set\|rm\|pull]` | Variables: list (hidden; `--reveal`), `set KEY=value…`, `rm KEY…`, `pull` into a local `.env` |
| `idem dashboard` | Open iDeploy |

Every command takes `--json` for scripts.

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
