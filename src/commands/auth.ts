/**
 * Signing in: through the browser by default (a code shown here, approved on
 * iDeploy), or with a token for CI (`--token`, or IDEM_TOKEN without login).
 */
import { hostname, userInfo } from 'node:os';
import { api, ApiError, Me } from '../api.js';
import { apiUrl, clearConfig, readConfig, token, writeConfig } from '../config.js';
import { openBrowser, sleep } from '../shared.js';
import { color, fail, interactive, printJson, prompts } from '../ui.js';
import { t } from '../i18n.js';

interface Started {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
  interval: number;
}

async function saveSignedIn(value: string, api_url?: string): Promise<Me> {
  const me = await api.get<Me>('/me', { token: value });
  const config = readConfig();
  writeConfig({
    ...config,
    ...(api_url ? { apiUrl: api_url } : {}),
    token: value,
    user: { name: me.name, email: me.email, team: me.team?.name ?? null },
  });
  return me;
}

function machine(): string {
  let user = '';
  try {
    user = userInfo().username;
  } catch {
    /* no user name */
  }
  return `${user ? `${user}@` : ''}${hostname()} (${process.platform})`;
}

/** The browser sign-in; resolves once approved. */
export async function browserLogin(): Promise<Me> {
  const started = await api.post<Started>('/cli/auth/start', { host: machine() }, { auth: false });
  prompts.note(
    `${color.bold(started.userCode)}\n\n${color.dim(t('Check that the page shows the same code, then authorise.'))}\n${color.cyan(started.verificationUrl)}`,
    t('Sign in to iDeploy')
  );
  const opened = openBrowser(started.verificationUrl);
  if (!opened) prompts.log.info(t('Open the link above in a browser (on any device).'));

  const spinner = prompts.spinner();
  spinner.start(t('Waiting for your approval in the browser'));
  const deadline = Date.now() + started.expiresIn * 1000;
  while (Date.now() < deadline) {
    await sleep(started.interval * 1000);
    let answer: { status: string; token?: string };
    try {
      answer = await api.post<{ status: string; token?: string }>('/cli/auth/poll', { device_code: started.deviceCode }, { auth: false });
    } catch {
      continue; // a network hiccup: ask again
    }
    if (answer.status === 'approved' && answer.token) {
      const me = await saveSignedIn(answer.token);
      spinner.stop(t('Signed in as {name}', { name: color.bold(me.name) }) + (me.team ? ` · ${t('team {team}', { team: me.team.name })}` : ''));
      return me;
    }
    if (answer.status === 'denied') {
      spinner.stop(t('Refused in the browser.'), 1);
      fail(t('Sign-in refused.'));
    }
    if (answer.status === 'expired') break;
  }
  spinner.stop(t('The code expired.'), 1);
  fail(t('Sign-in timed out.'), t('Run `idem login` again.'));
}

export async function login(opts: { token?: string; api?: string }): Promise<void> {
  if (opts.api) process.env.IDEM_API_URL = opts.api;
  if (opts.token) {
    try {
      const me = await saveSignedIn(opts.token, opts.api);
      if (!printJson({ signedIn: true, name: me.name, team: me.team?.name ?? null })) {
        prompts.log.success(t('Signed in as {name}', { name: color.bold(me.name) }));
      }
    } catch (err) {
      fail(err instanceof ApiError && err.status === 401 ? t('This token is not valid.') : (err as Error).message);
    }
    return;
  }
  if (!interactive()) fail(t('Signing in through the browser needs a terminal.'), t('In CI, set IDEM_TOKEN (create one under Security › API tokens), or pass --token.'));
  prompts.intro(color.bgCyan(color.black(' idem ')));
  if (opts.api) writeConfig({ ...readConfig(), apiUrl: opts.api });
  await browserLogin();
  prompts.outro(t('Next: {command} in your project folder.', { command: color.cyan('idem deploy') }));
}

export async function logout(): Promise<void> {
  const current = readConfig().token;
  if (!current) {
    prompts.log.info(t('You were not signed in.'));
    return;
  }
  // `<id>|<secret>`: the token is revoked on iDeploy too, not only forgotten here.
  const id = Number(current.split('|')[0]);
  if (id > 0) await api.delete(`/security/api-tokens/${id}`).catch(() => undefined);
  clearConfig();
  prompts.log.success(t("Signed out. This machine's token is revoked."));
}

export async function whoami(): Promise<void> {
  if (!token()) fail(t('You are not signed in.'), t('Run `idem login`.'));
  const me = await api.get<Me>('/me');
  if (printJson({ name: me.name, email: me.email, team: me.team?.name ?? null, api: apiUrl() })) return;
  prompts.log.info(`${color.bold(me.name)} <${me.email}>${me.team ? ` · ${t('team {team}', { team: color.bold(me.team.name) })}` : ''}\n${color.dim(apiUrl())}`);
}
