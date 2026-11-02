# Proper Marketing Intake

This is a Slack bot for Proper Hospitality. Someone messages it (or @mentions it in a channel) with a marketing request. It figures out the request type, checks whether a Canva template already exists, asks for anything the intake form still needs, shows a summary, and files the task on the New Intake Board only after they click **Confirm**.

It also answers questions about how intake works, and it shares the form link when someone would rather fill that in themselves.

Owner: Elena Ruiz.

The bot runs on [Vercel](https://vercel.com). Slack sends each message to a web address on Vercel. Vercel replies to Slack immediately (Slack gives up after 3 seconds), then finishes the slower work — talking to Claude, and creating the Asana task — in the background.

Memory between messages is stored in [Upstash Redis](https://upstash.com). A serverless function forgets everything when it finishes, so the Redis database is what lets a thread pick up where it left off. Slack sometimes sends the same event twice; the bot remembers the event id for 15 minutes and ignores the copy, so a retry does not file a second task.

## What you need before you start

- Admin access to the Proper Hospitality Slack workspace.
- A GitHub account that can see this repository.
- A Vercel account. `vercel.json` asks for a 60 second function limit because Claude and Asana together can take longer than a few seconds. If the deploy is rejected for that limit, raise it in the project settings or use a plan that allows 60 seconds.
- An [Anthropic](https://console.anthropic.com) API key (this is the Claude account).
- An Asana personal access token, or a service account token, for a user who can create tasks in **New Intake Board**.
- An Upstash account (free is enough to start).

You do not need Canva API access. Template names and links are saved in the code.

## 1. Create the Slack app from the manifest

Do this before Vercel. You need the tokens from Slack before the site can answer Slack's check.

1. Open [https://api.slack.com/apps](https://api.slack.com/apps).
2. Click **Create New App**.
3. Choose **From a manifest**.
4. Pick the Proper Hospitality workspace.
5. Choose the **JSON** tab and paste the entire contents of `manifest.json` from this repository. Replace whatever is already in the box.
6. Click **Next**, then **Create**.

The manifest turns on:

- Events: `app_mention` (someone @mentions the bot) and `message.im` (a direct message to the bot).
- Interactivity, so the **Confirm** and **Make changes** buttons work.
- The bot scopes the app needs to read those messages, look up a person's name and email, and reply.

Socket mode is off. This app uses a normal web address, which is what Vercel provides.

## 2. Install the app to the workspace

1. In the app settings, open **Install App** (or **OAuth & Permissions**).
2. Click **Install to Workspace** and allow it.
3. Copy the **Bot User OAuth Token**. It starts with `xoxb-`. This is `SLACK_BOT_TOKEN`.
4. Open **Basic Information**. Copy the **Signing Secret**. This is `SLACK_SIGNING_SECRET`.

Keep both of these private. Do not paste them into Slack, GitHub, or this README.

If you change the manifest later and Slack says the permissions changed, open **Install App** and click **Reinstall to Workspace**.

## 3. Create the Redis database

1. Go to [https://console.upstash.com](https://console.upstash.com) and sign in.
2. Click **Create database**. A regional database is fine. The name can be `proper-marketing-intake`.
3. Open the database. Find the **REST API** section (not the Redis URL that starts with `rediss://`).
4. Copy **UPSTASH_REDIS_REST_URL** and **UPSTASH_REDIS_REST_TOKEN**.

Vercel used to offer a product called Vercel KV. It was replaced by Upstash. This app uses Upstash's REST connection because a Vercel function cannot keep a normal database socket open.

## 4. Connect this repository to Vercel

1. Go to [https://vercel.com/new](https://vercel.com/new).
2. Import **proper-marketing-intake-bot** from GitHub. If Vercel cannot see it, click **Adjust GitHub App Permissions** and grant access to this repository.
3. Leave the framework preset as **Other**. The project is not a website with pages; it is one Slack endpoint.
4. Do not click Deploy yet. Open **Environment Variables** and add every row below. Use the **Production** environment (add Preview too if other people will test branches).

| Name | Where the value comes from |
|---|---|
| `SLACK_BOT_TOKEN` | Slack, Install App. Starts with `xoxb-`. |
| `SLACK_SIGNING_SECRET` | Slack, Basic Information, Signing Secret. |
| `ANTHROPIC_API_KEY` | Anthropic console, API keys. |
| `ANTHROPIC_MODEL` | Optional. Leave as `claude-sonnet-5-5` unless you have been told to use a different Claude model. |
| `ASANA_ACCESS_TOKEN` | Asana. My Settings → Apps → Developer apps → Personal access tokens. Or a service account token. |
| `UPSTASH_REDIS_REST_URL` | Upstash database, REST section. |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash database, REST section. |

The same names are listed in `.env.example`. That file has no secrets in it. Do not fill it in and commit it.

5. Click **Deploy**. Wait until the deployment says Ready.
6. Copy the production domain. It looks like `proper-marketing-intake-bot.vercel.app`. Your Slack address will be:

```text
https://YOUR-DOMAIN.vercel.app/api/slack
```

There is no extra path. `/api/slack` is the only address Slack should call.

## 5. Tell Slack the Request URL

Slack will send a check to that address. The check succeeds only after step 4 is deployed with `SLACK_SIGNING_SECRET` set.

1. In the Slack app, open **Event Subscriptions**.
2. Turn events **On** if they are off.
3. Set **Request URL** to `https://YOUR-DOMAIN.vercel.app/api/slack`.
4. Wait for the green **Verified** check.
5. Under **Subscribe to bot events**, confirm both of these are listed:
   - `app_mention`
   - `message.im`
6. Click **Save Changes**.
7. Open **Interactivity & Shortcuts**.
8. Turn interactivity **On**.
9. Set **Request URL** to the same address: `https://YOUR-DOMAIN.vercel.app/api/slack`.
10. Click **Save Changes**.

If verification fails:

- The domain must be `https://`, not `http://`.
- The path must end in `/api/slack`.
- `SLACK_SIGNING_SECRET` on Vercel must be the signing secret of this app, then redeploy (Vercel → Deployments → the latest one → Redeploy) so the function sees the new value.
- Open the deployment's **Logs** in Vercel while you click Retry in Slack. A line that says `missing_signing_secret` or `Invalid signature` tells you which of those two it is.

## 6. Test in a private channel

Do this in a private channel, not in a channel the whole company is watching.

1. Create a private channel, for example `#intake-bot-test`.
2. Invite the bot: type `/invite @Marketing Intake`. The display name comes from the manifest. Slack's member name may be slightly different; pick the one from this app.
3. Mention it:

```text
@Marketing Intake Can you help me get a holiday email designed for Santa Monica?
```

4. The bot should reply in the thread, not in the channel. It should ask for the missing pieces in one message (date, copy, approver, and so on), not one question at a time.
5. Reply in that same thread with the missing answers.
6. If a Canva template fits, the bot sends the template name and link and waits. Reply that you want the team to design it if you want to keep going. It will note that the template was offered.
7. When the brief is complete, the bot posts a summary with a green **Confirm** button and a **Make changes** button. Nothing is created in Asana before Confirm.
8. Click **Confirm**. The reply should include an Asana link on New Intake Board. Open it and check:
   - The task name looks like `SMP, Holiday newsletter` (property code, then the request name).
   - Request Type, the matching Task Type, and Property are filled in.
   - Status in Que becomes **New Request** and Estimated time is filled in. The board's own rules do that. The bot does not type those by hand. If they stay empty, the bot says so in the thread. Tell Elena; don't try to set them in the task to "fix" it.
9. Also send the bot a direct message. It should answer there without an @mention.
10. Ask `where is the intake form?` It should reply with [the Marketing Intake Form](https://form.asana.com/?k=JYO_VqiFFnSlwJs_3XoMIg&d=361605662576941) and not create a task.

A direct message keeps one ongoing brief. A channel mention starts a thread, and that thread is its own brief.

## How a request is filed

The bot follows the same path as the Marketing Intake Form.

- Project: New Intake Board (`1217171684008018`)
- Section at creation: New requests - Manually Created (`1217518666052136`)
- The task is created first with the name, the description, the requester, and the completion date.
- Then three fields are set one at a time, in this order: **Request Type**, then **Task Type**, then **Property**. The board's automations only run if they arrive in that order. They are never set on the create call.
- The bot reads the task back. If the automations ran, the task moves to New requests - Submitted via Form, Status in Que is New Request, Estimated time is filled in, and the task is also added to the team queue.
- The bot does not assign the task.

Request types are Creative, Web, CRM & Paid, Social, and Marketing. Designing an email is Creative. Sending a newsletter is CRM & Paid. A new offer is Marketing → Offers. Building or editing a live web page is Web.

## If something goes wrong

- **Slack says the bot didn't respond.** Open the Vercel deployment logs. `slack_retry` means Slack sent the message again. `slack_retry_skipped` means the bot ignored that copy on purpose.
- **The thread says Asana failed.** No task was created, or a task was created but the later fields did not save. The message includes Asana's reason and the form link. Click Confirm again only if the message says a task already exists and the remaining fields can be retried. Otherwise fix the token or the field and start again. The bot will not invent a second task for a brief it already created.
- **`ASANA_ACCESS_TOKEN is not set`.** Add it on Vercel and redeploy.
- **The bot forgets the thread.** Upstash URL or token is missing or wrong. Fix the two `UPSTASH_REDIS_REST_*` variables and redeploy.
- **Claude errors.** Check `ANTHROPIC_API_KEY` and that the Anthropic account has credit.
- **Buttons do nothing.** Interactivity Request URL is empty or different from the Events Request URL. Both must be `https://YOUR-DOMAIN.vercel.app/api/slack`.

## For a developer helping Elena

```bash
npm install
npm test
npm run typecheck
```

Tests cover field order (Request Type, then Task Type, then Property), the Canva matcher, and the rule that nothing is created until Confirm. Asana and Claude are mocked.

To run it on your own computer you need a public https address (Cloudflare Tunnel or ngrok) pointed at port 3000, the same environment variables in a `.env` file that is not committed, and:

```bash
npm run dev
```

The local server answers `POST /api/slack`, acknowledges Slack immediately, and then does the work. Production does not use this command. Production is the Vercel deployment.

## Known open questions

- Two live templates are both named **Proper-Social-Press-2026**: `EAHVrNTlM1M` and `EAHHycjf7Ug`. The bot keeps both, sends both links, and says they share a name. Someone who knows Canva needs to say which one should win, or rename one of them.
- The intake notes name self-serve resources (stats, brand assets, logos, photo libraries, access requests) but do not include the URLs. The bot will not invent those links. Send Elena the URLs if they should be added.
- DeeDee Brown (Proper & By Proper) and Koral Captain (Collective) are named when a question needs a second contact. Their Slack member ids are not in the source notes, so the bot cannot @mention them until those ids are added.
- Disabled Asana property options are not offered: All By Proper, Residences, and the old New Projects option. The bot offers **New Projects/Development** and **MIN** instead, matching the current board.
- Routing Bucket, Status in Que, and Estimated time are left for the board automations. The bot never writes them.
- The requester's name and email come from their Slack profile, not from the Asana token. The token is a service account. If Slack does not share the email (the workspace must allow the `users:read.email` scope, and the member's email must be visible), the bot asks for it.
