# Proper Marketing Intake

This is a Slack bot for Proper Hospitality. Someone messages it (or @mentions it in a channel) with a marketing request. It figures out the request type, checks whether a Canva template already exists, asks for anything the intake form still needs, shows a summary, and files the task on the New Intake Board only after they click **Confirm**.

It also answers questions about how intake works, and it shares the form link when someone would rather fill that in themselves.

Owner: Elena Ruiz.

The bot is a normal web service on [Render](https://render.com) (the Starter plan, which stays on). Slack sends each message to one address on that service. The service answers Slack immediately — Slack gives up after 3 seconds — and then keeps working in the same process: talking to Claude, and creating the Asana task.

Memory between messages is stored in [Upstash Redis](https://upstash.com). Render restarts the service every time you deploy or change a setting, and a restart forgets anything kept only in memory. Redis is what lets a Slack thread pick up where it left off, and what lets the bot ignore a second copy of the same Slack delivery so a retry does not file a second task.

## What you need before you start

- Admin access to the Proper Hospitality Slack workspace.
- A GitHub account that can see this repository.
- A Render account. Use a **Web Service** on the always-on plan in the blueprint (`0.5c-512mb`, 0.5 CPU and 512 MB). Render used to call this Starter. Do not pick **Free**. Free sleeps when nobody is using it, and Slack cannot wait for it to wake up.
- An [Anthropic](https://console.anthropic.com) API key (this is the Claude account).
- An Asana personal access token, or a service account token, for a user who can create tasks in **New Intake Board**.
- An Upstash account (free is enough to start). You will create the database in the middle of the Render setup, when Render asks for those two values.

You do not need Canva API access. Template names and links are saved in the code.

## 1. Create the Slack app from the manifest

Do this before Render. You need the tokens from Slack before the service can answer Slack.

1. Open [https://api.slack.com/apps](https://api.slack.com/apps).
2. Click **Create New App**.
3. Choose **From a manifest**.
4. Pick the Proper Hospitality workspace.
5. Choose the **JSON** tab and paste the entire contents of `manifest.json` from this repository. Replace whatever is already in the box.
6. Click **Next**, then **Create**.

Leave the Request URL blank for now. Slack checks that address the moment you save it, and the Render site does not exist yet. You will paste it in step 6.

The manifest turns on:

- Events: `app_mention` (someone @mentions the bot) and `message.im` (a direct message to the bot).
- Interactivity, so the **Confirm** and **Make changes** buttons work.
- The bot scopes the app needs to read those messages, look up a person's name and email, and reply.

Socket mode is off. This app uses a normal web address.

## 2. Install the app to the workspace

1. In the app settings, open **Install App** (or **OAuth & Permissions**).
2. Click **Install to Workspace** and allow it.
3. Copy the **Bot User OAuth Token**. It starts with `xoxb-`. This is `SLACK_BOT_TOKEN`.
4. Open **Basic Information**. Copy the **Signing Secret**. This is `SLACK_SIGNING_SECRET`.

Keep both of these private. Do not paste them into Slack, GitHub, or this README.

If you change the manifest later and Slack says the permissions changed, open **Install App** and click **Reinstall to Workspace**.

## 3. Deploy on Render from the blueprint

The blueprint is the file `render.yaml` in this repository. Render reads it and creates the web service for you.

1. Open [https://dashboard.render.com/blueprint/new](https://dashboard.render.com/blueprint/new) and sign in.
2. Connect GitHub if Render asks. Grant access to **proper-marketing-intake-bot**.
3. Choose this repository. Use the **main** branch after this update is merged. If you are trying the pull request first, choose that branch instead of main.
4. Render shows the service `proper-marketing-intake`, the always-on plan (`0.5c-512mb`), the build command, and the start command. Leave those as they are.
5. Render then shows empty boxes for the secret settings. Fill them in using the table in the next step. The two Upstash boxes are filled in step 5, which you do on that same screen.
6. Click **Apply** (or **Deploy**). The first build can take a few minutes. Wait until the service says **Live**.

The service listens on the port Render assigns. You do not set that port yourself. Slack's address on the service is `/slack/events`. Render's own health check is `/health`.

## 4. Set the environment variables

On the blueprint screen, Render lists these because `render.yaml` marks the secrets with `sync: false`. That means the values stay in Render and are not written into the repository.

| Name | Where the value comes from |
|---|---|
| `SLACK_BOT_TOKEN` | Slack, Install App. Starts with `xoxb-`. |
| `SLACK_SIGNING_SECRET` | Slack, Basic Information, Signing Secret. |
| `ANTHROPIC_API_KEY` | Anthropic console, API keys. |
| `ANTHROPIC_MODEL` | Already filled in as `claude-sonnet-5-5`. Leave it unless you have been told to use a different Claude model. |
| `ASANA_ACCESS_TOKEN` | Asana. My Settings → Apps → Developer apps → Personal access tokens. Or a service account token. |
| `UPSTASH_REDIS_REST_URL` | Step 5. |
| `UPSTASH_REDIS_REST_TOKEN` | Step 5. |

The same names are listed in `.env.example`. That file has no secrets in it. Do not fill it in and commit it.

If the service fails immediately and the log says `Missing environment variables`, one of these boxes was empty. Open the service in Render, go to **Environment**, paste the missing value, and save. Render restarts on its own.

## 5. Create the Upstash database

Do this when Render is waiting for `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

1. Go to [https://console.upstash.com](https://console.upstash.com) and sign in.
2. Click **Create database**. A regional database is fine. The name can be `proper-marketing-intake`.
3. Open the database. Find the **REST API** section. Use the REST URL and token, not the address that starts with `rediss://`.
4. Copy **UPSTASH_REDIS_REST_URL** and **UPSTASH_REDIS_REST_TOKEN** into the Render form.

Redis holds two things: the brief for each Slack thread or DM, and the id of each Slack delivery for 15 minutes. The second one is how a retry is ignored.

## 6. Paste the Request URL into Slack

1. On the Render service page, copy the public URL. It looks like `https://proper-marketing-intake.onrender.com`.
2. Add `/slack/events` on the end. The full address is:

```text
https://YOUR-RENDER-URL.onrender.com/slack/events
```

3. In the Slack app, open **Event Subscriptions**.
4. Turn events **On** if they are off.
5. Set **Request URL** to that address. Wait for the green **Verified** check.
6. Under **Subscribe to bot events**, confirm both of these are listed:
   - `app_mention`
   - `message.im`
7. Click **Save Changes**.
8. Open **Interactivity & Shortcuts**.
9. Turn interactivity **On**.
10. Set **Request URL** to the same address, including `/slack/events`.
11. Click **Save Changes**.

You can also put that address into the manifest and save it again. Both places must match. In the manifest JSON it looks like this, with your real Render URL:

```json
"event_subscriptions": {
  "request_url": "https://YOUR-RENDER-URL.onrender.com/slack/events",
  "bot_events": ["app_mention", "message.im"]
},
"interactivity": {
  "is_enabled": true,
  "request_url": "https://YOUR-RENDER-URL.onrender.com/slack/events"
}
```

If verification fails:

- The address must be `https://`, not `http://`.
- It must end in `/slack/events`.
- `SLACK_SIGNING_SECRET` on Render must be the signing secret of this app. Save it, wait for the restart, then click Retry in Slack.
- Open the Render **Logs** while you click Retry. A line that says the signing secret is missing, or `Invalid signature`, tells you which of those two it is.
- A browser visit to `https://YOUR-RENDER-URL.onrender.com/health` should show the word `ok`. That only checks that the service is up. It does not check Slack.

## 7. Test in a private channel

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

- **Slack says the bot didn't respond.** Open the Render logs. `slack_retry` means Slack sent the message again. `slack_retry_skipped` means the bot ignored that copy on purpose.
- **The thread says Asana failed.** No task was created, or a task was created but the later fields did not save. The message includes Asana's reason and the form link. Click Confirm again only if the message says a task already exists and the remaining fields can be retried. Otherwise fix the token or the field and start again. The bot will not invent a second task for a brief it already created.
- **`ASANA_ACCESS_TOKEN is not set` or the log lists missing variables.** Add them under **Environment** on the Render service and save.
- **The bot forgets the thread.** Upstash URL or token is missing or wrong. Fix the two `UPSTASH_REDIS_REST_*` variables and save so Render restarts.
- **Claude errors.** Check `ANTHROPIC_API_KEY` and that the Anthropic account has credit.
- **Buttons do nothing.** Interactivity Request URL is empty or different from the Events Request URL. Both must be `https://YOUR-RENDER-URL.onrender.com/slack/events`.
- **`/health` does not say ok.** The build or start command failed. Read the latest Render deploy log. The build command is `npm install --include=dev && npm run build`. The start command is `npm start`.

## For a developer helping Elena

```bash
npm install
npm test
npm run typecheck
npm run build
npm run dev
```

`npm run dev` listens on port 3000 (or `PORT`) and serves `POST /slack/events` plus `GET /health`. Slack still has to reach a public https address, so a tunnel has to point at that port. Put the variables from `.env.example` in a `.env` file that is not committed. Without the Upstash variables, the process keeps briefs in memory and forgets them when it stops. That is only for a local experiment.

Tests cover field order, the Canva matcher, the confirm gate, Slack retry dedupe, and the health route. Asana and Claude are mocked.

## Known open questions

- Two live templates are both named **Proper-Social-Press-2026**: `EAHVrNTlM1M` and `EAHHycjf7Ug`. The bot keeps both, sends both links, and says they share a name. Someone who knows Canva needs to say which one should win, or rename one of them.
- The intake notes name self-serve resources (stats, brand assets, logos, photo libraries, access requests) but do not include the URLs. The bot will not invent those links. Send Elena the URLs if they should be added.
- DeeDee Brown (Proper & By Proper) and Koral Captain (Collective) are named when a question needs a second contact. Their Slack member ids are not in the source notes, so the bot cannot @mention them until those ids are added.
- Disabled Asana property options are not offered: All By Proper, Residences, and the old New Projects option. The bot offers **New Projects/Development** and **MIN** instead, matching the current board.
- Routing Bucket, Status in Que, and Estimated time are left for the board automations. The bot never writes them.
- The requester's name and email come from their Slack profile, not from the Asana token. The token is a service account. If Slack does not share the email (the workspace must allow the `users:read.email` scope, and the member's email must be visible), the bot asks for it.
