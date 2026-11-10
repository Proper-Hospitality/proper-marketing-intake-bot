# Proper Marketing Intake

This is a Slack bot for Proper Hospitality. Someone messages it (or @mentions it in a channel) with a marketing request. It figures out the request type, checks whether a Canva template already exists, then asks for anything the intake form still needs one question at a time. They can answer a few things in one reply, say skip or not sure, or say back to change the last answer. It shows a summary, and files the task on the New Intake Board only after they click **Confirm**. The thread remembers where they were.

It also answers questions about how intake works, and it shares the form link when someone would rather fill that in themselves.

If the price, pricing, or cost is not ready yet, the bot still files the task. The Asana description lists that as `Price: TBD (requester will provide)` under Pending from requester, and the confirmation asks them to reply with the price in the Asana task or the Slack thread. The Brief section is only the requester's answers, one question per line, not a written summary. A price sent later in that thread is added as a comment on the task. Other required answers are still required.

Anyone in Slack can ask it to find incomplete Asana tasks and mark them complete, including tasks assigned to someone else. It lists each match with the assignee, the project, the due date, and the link. Nothing is marked complete until they click **Confirm**. It will not complete more than 25 tasks at one time. If a name matches more than one person, it asks which one. After Confirm, each task gets a comment naming who marked it complete from Slack, and that is written to the service log.

They can also ask for overdue counts for several people at once, for example "how many overdue tasks do Savannah, Kat, and DeeDee have?" Overdue means the task is still open and the due date is before today in Pacific Time. The reply is a count per person. If they ask to see the tasks, it adds links to the oldest ones. That question does not change any tasks, so there is no Confirm button. A name that matches nobody is called out, and a name that matches more than one person is asked about.

Owner: Elena Ruiz.

The bot is a normal web service on [Render](https://render.com) (the always-on plan in the blueprint, which stays on). Slack sends each message to one address on that service. The service answers Slack immediately — Slack gives up after 3 seconds — and then keeps working in the same process: talking to Claude, and creating the Asana task.

Memory between messages is stored in Render Key Value, which speaks Redis. Render restarts the service every time you deploy or change a setting, and a restart forgets anything kept only in memory. Key Value is what lets a Slack thread pick up where it left off, and what lets the bot ignore a second copy of the same Slack delivery so a retry does not file a second task. The blueprint creates that database and fills in `REDIS_URL` for you. You do not create an account anywhere else, and you do not paste a database address.

## What you need before you start

- Admin access to the Proper Hospitality Slack workspace.
- A GitHub account that can see this repository.
- A Render account. Use a **Web Service** on the always-on plan in the blueprint (`0.5c-512mb`, 0.5 CPU and 512 MB). Render used to call this Starter. Do not pick **Free**. Free sleeps when nobody is using it, and Slack cannot wait for it to wake up.
- An [Anthropic](https://console.anthropic.com) API key (this is the Claude account).
- An Asana personal access token, or a service account token, for a user who can create tasks in **New Intake Board**, search the workspace, mark tasks complete, and comment on them. No extra setting is required for finding and completing tasks.

Template names and links are saved in the code, so the bot can still send a Canva link before Canva is connected. Building the design inside Slack needs a one-time Canva connection, described below. You do not need a separate Redis host. Render Key Value is part of the blueprint.

## 1. Create the Slack app from the manifest

Do this before Render. You need the tokens from Slack before the service can answer Slack.

1. Open [https://api.slack.com/apps](https://api.slack.com/apps).
2. Click **Create New App**.
3. Choose **From a manifest**.
4. Pick the Proper Hospitality workspace.
5. Choose the **JSON** tab and paste the entire contents of `manifest.json` from this repository. Replace whatever is already in the box.
6. Click **Next**, then **Create**.

The manifest does **not** include Event Subscriptions or Interactivity. Slack will not save those sections unless the manifest already contains a Request URL, and the Render site does not exist yet. You turn both on in step 5, after the service is live.

The manifest does turn on:

- The **Messages** tab, and it lets people send a direct message to the bot (the tab is not read-only).
- The bot scopes the app needs to read those messages, look up a person's name and email, and reply.

Socket mode is off. This app uses a normal web address.

If you already created the app from an earlier manifest, open **App Home** in the app settings and turn on the **Messages Tab**. Allow people to send messages. Do not leave that tab read-only. Save, and reinstall the app if Slack asks.

## 2. Install the app to the workspace

1. In the app settings, open **Install App** (or **OAuth & Permissions**).
2. Click **Install to Workspace** and allow it.
3. Copy the **Bot User OAuth Token**. It starts with `xoxb-`. This is `SLACK_BOT_TOKEN`.
4. Open **Basic Information**. Copy the **Signing Secret**. This is `SLACK_SIGNING_SECRET`.

Keep both of these private. Do not paste them into Slack, GitHub, or this README.

If you change the manifest later and Slack says the permissions changed, open **Install App** and click **Reinstall to Workspace**.

## 3. Deploy on Render from the blueprint

The blueprint is the file `render.yaml` in this repository. Render reads it and creates two things: the web service, and a free Key Value database named `proper-marketing-intake-kv`. That database only accepts connections from inside Render (`ipAllowList` is empty). The web service gets `REDIS_URL` from it automatically.

1. Open [https://dashboard.render.com/blueprint/new](https://dashboard.render.com/blueprint/new) and sign in.
2. Connect GitHub if Render asks. Grant access to **proper-marketing-intake-bot**.
3. Choose this repository. Use the **main** branch after this update is merged. If you are trying the pull request first, choose that branch instead of main.
4. Render shows the web service `proper-marketing-intake`, the always-on plan (`0.5c-512mb`), the build command, and the start command. It also shows the Key Value database. Leave those as they are. Do not add a `REDIS_URL` value yourself.
5. Render then shows empty boxes for the secret settings. Fill them in using the table in the next step. There is no Redis box.
6. Click **Apply** (or **Deploy**). The first build can take a few minutes. Wait until the web service says **Live**.

The service listens on the port Render assigns. You do not set that port yourself. Slack's address on the service is `/slack/events`. Render's own health check is `/health`. After deploy, open the web service **Environment** page and confirm `REDIS_URL` is present and points at the Key Value service. If it is missing, apply the blueprint again. Do not paste a URL into that row.

## 4. Set the environment variables

On the blueprint screen, Render lists these because `render.yaml` marks the secrets with `sync: false`. That means the values stay in Render and are not written into the repository.

| Name | Where the value comes from |
|---|---|
| `SLACK_BOT_TOKEN` | Slack, Install App. Starts with `xoxb-`. |
| `SLACK_SIGNING_SECRET` | Slack, Basic Information, Signing Secret. |
| `ANTHROPIC_API_KEY` | Anthropic console, API keys. |
| `ANTHROPIC_MODEL` | Already filled in as `claude-sonnet-5-5`. Leave it unless you have been told to use a different Claude model. |
| `ASANA_ACCESS_TOKEN` | Asana. My Settings → Apps → Developer apps → Personal access tokens. Or a service account token. |
| `CANVA_CLIENT_ID` | Canva developer integration. Optional until you want the bot to build designs. Leave it blank and the bot only sends template links. |
| `CANVA_CLIENT_SECRET` | Canva developer integration. Same as above. Starts with `cnvca`. |
| `SLACK_INTAKE_CHANNELS` | Optional. Comma-separated Slack channel IDs. In these channels every top-level message starts intake. No @mention is required. Leave it blank and only @mentions and direct messages start intake. |
| `SLACK_STATUS_CHANNELS` | Optional. Comma-separated Slack channel IDs, such as `C0AV038G751` for `#marketing-crew`. Leave it blank and the bot will not propose Asana status updates. |
| `REDIS_URL` | Filled in by the blueprint from the Key Value service. Leave it alone. |

The same secret names are listed in `.env.example`. That file has no secrets in it. Do not fill it in and commit it.

If the service fails immediately and the log says `Missing environment variables`, one of the Slack, Anthropic, or Asana boxes was empty, or `REDIS_URL` was not wired. Open the service in Render, go to **Environment**, paste any missing secret, and save. Render restarts on its own. If `REDIS_URL` is the one missing, apply the blueprint again instead of typing a value.

Key Value holds the brief for each Slack thread or DM, the id of each Slack delivery for 15 minutes, and the Canva connection once you finish the steps below. The delivery id is how a retry is ignored. A thread that is waiting on copy and photos is stored on that same thread key, so a reply later in the thread picks up where it left off.

## 5. Turn on events and buttons in Slack

The Slack app was created without Event Subscriptions and without Interactivity. Slack requires a Request URL inside the manifest before it will save those sections, and there was no public address yet. Now that Render is live, turn them on in the app settings. Do not put them back into the manifest until you are ready to paste the live URL there too.

1. On the Render service page, copy the public URL. It looks like `https://proper-marketing-intake.onrender.com`.
2. Add `/slack/events` on the end. The full address is:

```text
https://YOUR-RENDER-URL.onrender.com/slack/events
```

3. In the Slack app, open **Event Subscriptions**.
4. Turn events **On**.
5. Set **Request URL** to that address. Wait for the green **Verified** check.
6. Under **Subscribe to bot events**, add all of these if they are not already listed:
   - `app_mention`
   - `message.im`
   - `message.channels`
   - `message.groups`
   - `message.mpim`
7. Click **Save Changes**. Slack may ask you to reinstall the app. Do that.
8. Open **Interactivity & Shortcuts**.
9. Turn interactivity **On**.
10. Set **Request URL** to the same address, including `/slack/events`.
11. Click **Save Changes**.

`message.im` is direct messages. `message.channels` is a public channel, and `message.groups` is a private channel. A reply in the thread, including a photo upload, is one of those message events. It is not an `app_mention` unless the text @mentions the bot. Without `message.channels` and `message.groups`, Slack never sends the reply, and the bot cannot answer or post an error.

If verification fails:

- The address must be `https://`, not `http://`.
- It must end in `/slack/events`.
- `SLACK_SIGNING_SECRET` on Render must be the signing secret of this app. Save it, wait for the restart, then click Retry in Slack.
- Open the Render **Logs** while you click Retry. A line that says the signing secret is missing, or `Invalid signature`, tells you which of those two it is.
- A browser visit to `https://YOUR-RENDER-URL.onrender.com/health` should show the word `ok`. That only checks that the service is up. It does not check Slack.

## 6. Test in a private channel

Do this in a private channel, not in a channel the whole company is watching.

1. Create a private channel, for example `#intake-bot-test`.
2. Invite the bot: type `/invite @Marketing Intake`. The display name comes from the manifest. Slack's member name may be slightly different; pick the one from this app.
3. Mention it:

```text
@Marketing Intake Can you help me get a holiday email designed for Santa Monica?
```

4. The bot should reply in the thread, not in the channel. It should ask one thing, then the next, not the whole form at once. The date and why that date are one question.
5. Reply in that same thread. You can answer just that question, or include a few answers at once. Say skip or not sure to move on. Say back to change the last answer.
6. If a Canva template fits and Canva is connected, the bot offers to build the design and asks for the final copy and the photos in that same thread. Upload the photos or paste links. If you don't have them, it tells you to find them or check with your marketing manager and reply in that thread. It then sends a Canva edit link. A change request in the thread makes a new design and says it is a fresh version. If Canva is not connected, or the template cannot be filled, it sends the template link and the copy instead. Reply that you want the team to design it if you want the normal brief.
7. When the brief is complete, the bot posts a summary with a green **Confirm** button and a **Make changes** button. Nothing is created in Asana before Confirm.
8. Click **Confirm**. The reply should include an Asana link on New Intake Board. Open it and check:
   - The task name looks like `SMP, Holiday newsletter` (property code, then the request name).
   - Request Type, the matching Task Type, and Property are filled in.
   - Status in Que becomes **New Request** and Estimated time is filled in. The board's own rules do that. The bot does not type those by hand. If they stay empty, the bot says so in the thread. Tell Elena; don't try to set them in the task to "fix" it.
9. Also send the bot a direct message. It should answer there without an @mention.
10. Ask `where is the intake form?` It should reply with [the Marketing Intake Form](https://form.asana.com/?k=JYO_VqiFFnSlwJs_3XoMIg&d=361605662576941) and not create a task.
11. In the same channel, ask `@Marketing Intake Find any task that has Elena Ruiz as assignee and mark them complete`. It should list matches with the assignee, project, due date, and link, then wait for **Confirm**. After you click Confirm, open one of those tasks. It should be complete, with a comment that says it was marked complete from Slack by you.

A direct message keeps one ongoing brief. A channel mention starts a thread, and that thread is its own brief.

## Existing sales collateral

For sales collateral, menus, and fact sheets, the bot checks a curated catalog before it builds a new brief. Canva templates still come first. If a template fits, the bot offers that first. After the template is declined, or when no template fits, it can ask one year question and then show original links.

Saying *I'll use this* stops there. Nothing is filed in Asana. Saying the file is outdated, or that a new year is needed, continues the normal one-question brief. The same files are not offered again.

Counts, by what was actually usable:

- Verified documents with text or an image description on record: 5. SMP Holiday Menu 2025, SMP Holiday Menu 2026, Santa Monica Proper Fact Sheet, SMP-MediaBook-2026, and Charmaine's floor plan.
- Verified Santa Monica Canva links whose view URL was checked, with the design body not copied here: 18 current menus, fact-sheet templates, and wedding packages, matched by title and type. Holiday Menu 2025 is the older verified file. Menus titled 2026–2027 cover both years. Fact sheets with no year stay unknown.
- Not offered: the OBB Media proposal (candidate-only) and the SMP DO NOT USE folder.
- Source candidates, not opened documents: 5. Three San Francisco PDFs (banquet menu, meetings brochure, and `SFP-Fact-Sheet-2025_ADA.pdf`, whose filename year is 2025) have working Slack links and no PDF bytes. The Shelborne Recovery Room one-pager is filename year 2026 and the PDF bytes are missing. Lindsay's Ocean Way deck `DAHQtuWCJSw` resolved, then Canva denied access. Its year is unknown and it is not treated as a current canonical file. It is offered only when the request mentions Ocean Way, cabanas, or a partnership deck.
- Folder pointers, not an indexed library: 2. Shelborne `1-RESOURCES` returned 403, so no files were listed. `1-PICTURES` resolves and is imagery only. It is not a menu, fact sheet, or deck.
- Verified Hotel June and Downtown LA files, text read, year 2026 by Elena's confirmation of the current folders (8): Hotel June brochure, Hotel June tour script, DTLAP fact sheet, DTLAP sports-team fact sheet, DTLAP capacity chart, DTLAP meetings brochure, DTLAP banquet menu, and Proper Fact Sheet.pdf. That confirmation is not copied onto Santa Monica, San Francisco, or Shelborne files. Proper Fact Sheet.pdf was stored in the Downtown LA folder. Its text names Santa Monica, San Francisco, Downtown LA, Austin, Hotel June Malibu, Hotel June West LA, Avalon Beverly Hills, Avalon Palm Springs, and The Culver Hotel, so it is not DTLA-only.
- Austin Proper, five Slack attachments from Ryan Galvin in #atxp-sales on 2026-11-05 (https://properhospitalitycorp.slack.com/archives/C0B62QUHBK4/p1793928288710819). There is no Austin folder. Years are unknown. The Travel + Leisure 2022 line on the fact sheet is an award year, not the document year. The Hotel June / Downtown LA 2026 confirmation does not apply. Text was read for the fact sheet, Kappo Kappo events one-pager, capacity chart, and the clean second-floor meetings plan. Updated Floor Plan is an eight-page image-only guest-room set with page descriptions and no text layer. It is not the same file as Austin Proper Floor Plan.
- Avalon Palm Springs client-facing files Elena exported on Nov 10, 2026 (3): Avalon Facts Deck and Ingleside Facts Deck, both with no printed year and current only by that export, and Melvyn's prix-fixe menu, Jul 2026 as reported rather than printed. Map & Room List and Room Capacities are named on the Sales Resources canvas and are not file records.
- San Francisco, Montauk, and Culver are pending. Their sales-doc location is not confirmed yet. Avalon Beverly Hills is updating its collateral, so the bot says new files are coming and does not offer older Beverly Hills files. The HERO Drive folder stays an imagery-only note. San Francisco's existing Slack files stay in the catalog.

Shelborne sales collateral is included. A separate request removed Shelborne from Claude Design templates in another repository. That does not remove SMB from this catalog. The Canva template list in this bot is unchanged.

Elena's confirmation that the current Hotel June and Downtown LA files are 2026 applies only to those eight files. It does not apply to Santa Monica, San Francisco, or Shelborne. A 2026 Hotel June or Downtown LA file is an older starting point for a 2027 request, not the current file.

Both replies include the Notion list of where each property's sales docs live (`SALES_COLLATERAL_SOURCE_URL`). The bot does not fetch that page. If no catalog file matches the property and the type, the bot says where that property's sales docs were reported to live, or that no location is confirmed. That note is separate from the 47 file records. A confirmed location is a place to look, not a claim that the requested file is in the catalog. A partial location, including Avalon Beverly Hills, is labeled partial. San Francisco, Montauk, and Culver have no confirmed location. The Nov request was never posted in `#myc-sales` or `#tch-sales`. Austin has no central folder; the five cataloged PDFs are the files Ryan attached. These location links were not opened, and the catalog does not sync them.

Opening a link still depends on that person's Canva, Slack, or SharePoint access. The bot does not sync folders and does not refresh itself.

To refresh the catalog, replace the records in `src/intake/collateral/catalog.ts` from a new verified handoff. Keep each file's own year, the place that year came from (title, filename, or text), and whether it is verified, metadata-only, or a 403 pointer. Do not copy a year from another property, and do not use a file's modified date as its content year. Leave a file's year unknown when the handoff does not prove one. Do not mark a 403 folder or an unread PDF as a verified document.

No new environment variable and no new Slack scope are required. The catalog ships with the app. After this branch is merged, deploy the existing Render service the same way as the other intake updates. The bot does not sync SharePoint, Canva, or Slack folders on its own.

## How a request is filed

The bot follows the same path as the Marketing Intake Form.

- Project: New Intake Board (`1217171684008018`)
- Section at creation: New requests - Manually Created (`1217518666052136`)
- The task is created first with the name, the description, the requester, and the completion date.
- Then three fields are set one at a time, in this order: **Request Type**, then **Task Type**, then **Property**. The board's automations only run if they arrive in that order. They are never set on the create call.
- The bot reads the task back. If the automations ran, the task moves to New requests - Submitted via Form, Status in Que is New Request, Estimated time is filled in, and the task is also added to the team queue.
- The bot does not assign the task.

Request types are Creative, Web, CRM & Paid, Social, and Marketing. Designing an email is Creative. Sending a newsletter is CRM & Paid. A new offer is Marketing → Offers. Building or editing a live web page is Web.

## Connect Canva so the bot can build a design

Skip this until you want the bot to create the Canva file. Until these steps are done, a matching template still gets a link only, and the rest of intake works as before.

The Slack app already asks for the `files:read` scope in `manifest.json`. That scope lets the bot call `files.info` and download the file's private URL (`url_private`) with the bot token. If the app was installed before that scope was on the manifest, open **Install App** and click **Reinstall to Workspace** after you paste the current manifest. A photo uploaded in a channel thread also requires the `message.channels` or `message.groups` event from step 5.

1. Open [https://www.canva.com/developers](https://www.canva.com/developers) and create an integration (a Canva app that uses the Connect API). Use a Canva account that can see the Proper brand templates. Autofill requires a Canva plan that includes it. Canva documents that as Pro, Teams, or Enterprise. If the account cannot autofill, the bot sends the template link and the copy instead of a finished design.
2. In the integration settings, set the redirect URL to exactly:

```text
https://proper-marketing-intake.onrender.com/canva/callback
```

3. Enable these scopes, and no others are required:

```text
brandtemplate:meta:read
brandtemplate:content:read
design:content:write
design:meta:read
asset:write
asset:read
```

4. Copy the client ID and the client secret.
5. On the Render web service, open **Environment**. Set `CANVA_CLIENT_ID` and `CANVA_CLIENT_SECRET`. Save. Wait until the service is Live again.
6. While logged into that Canva account, open:

```text
https://proper-marketing-intake.onrender.com/canva/connect
```

7. Approve the request. The page should say Canva is connected. The tokens are stored in Render Key Value and refresh on their own. You do not repeat this unless the connection is removed.

After that, a request that matches one live template asks for the final copy and the photos before it builds anything. The pending request stays on that Slack thread.

## Intake channels

You can name channels where people do not have to @mention the bot. Every top-level message from a person starts the same intake as a direct message or an @mention. The bot answers in a thread on that message. Later replies in that thread stay on the same request. Messages from other bots, channel join and leave notices, and edits of the original message are ignored.

On the Render service, set the channel IDs separated by commas:

```text
SLACK_INTAKE_CHANNELS=C0123456789
```

To find an ID, open the channel in Slack, click the channel name, and copy the ID at the bottom of the details. Invite the bot to the channel with `/invite @Marketing Intake`. The event subscriptions `message.channels` (public) and `message.groups` (private) have to be on, which they already are if thread replies work. No new Slack scope is required.

If someone @mentions the bot in that channel as well, the bot handles the message once.

An intake channel does not also propose Asana status updates. Those stay on `SLACK_STATUS_CHANNELS`, and only when the message is clearly a status update, such as something going live or a new due date. You can put a channel in both lists. A design request still starts intake only. A line like "the SMP menu is live" can also offer an Asana update.

## Status updates from Slack

The bot can notice a status update in a channel it has joined and offer to write that onto an Asana task. It never changes Asana until someone clicks **Confirm**. Confirm works for the person who wrote the message, or for the Asana assignee.

It looks for a task that is done, live, or sent, a new due date, a note that the work is no longer needed, or a short progress note. Thanks, jokes, and other chit-chat are ignored before Claude is asked. An Asana link in the message or the thread is used first. Otherwise it searches incomplete tasks by the words in the message, a property code such as SMP or AUP, and the speaker as the assignee. If more than one task fits, it shows up to three choices.

The card is visible only to the speaker when Slack allows an ephemeral reply in the thread. Otherwise it is a normal thread reply. **Pick another task** shows the other matches. **Dismiss** leaves Asana unchanged. After Confirm, the card updates and the task gets a comment that starts with `Updated from Slack by` plus a link back to the Slack message.

This stays off until you list channel IDs. On the Render service, set:

```text
SLACK_STATUS_CHANNELS=C0AV038G751
```

`C0AV038G751` is `#marketing-crew`. Add more IDs separated by commas. The bot has to be in each channel. The same event subscriptions as thread replies are required: `message.channels` for public channels and `message.groups` for private channels, plus `message.im` and `app_mention`. No new Slack scope is required. `chat:write` is already on the app, which is what sends the ephemeral card.

The bot will not propose twice for the same message, and it will not propose more than eight updates in one channel in ten minutes.

## If something goes wrong

- **Slack says the bot didn't respond.** Open the Render logs. `slack_retry` means Slack sent the message again. `slack_retry_skipped` means the bot ignored that copy on purpose.
- **The thread says Asana failed.** No task was created, or a task was created but the later fields did not save. The message includes Asana's reason and the form link. Click Confirm again only if the message says a task already exists and the remaining fields can be retried. Otherwise fix the token or the field and start again. The bot will not invent a second task for a brief it already created.
- **`ASANA_ACCESS_TOKEN is not set` or the log lists missing variables.** Add them under **Environment** on the Render service and save.
- **The bot forgets the thread.** `REDIS_URL` is missing or the Key Value service is in a different region from the web service. Both are set to Oregon in the blueprint. Apply the blueprint again. Do not paste a Redis address by hand.
- **Claude errors.** Check `ANTHROPIC_API_KEY` and that the Anthropic account has credit.
- **Buttons do nothing.** Interactivity Request URL is empty or different from the Events Request URL. Both must be `https://YOUR-RENDER-URL.onrender.com/slack/events`.
- **`/health` does not say ok.** The build or start command failed. Read the latest Render deploy log. The build command is `npm install --include=dev && npm run build`. The start command is `npm start`.
- **The bot sends a template link and says the template needs fields tagged.** That template has no autofill fields. Canva's Connect API cannot add those tags. In the Canva editor, open the template, choose Apps, then Bulk Create, then Labels, and add a Data field on each text or photo element. A developer can list which live templates are tagged with `npm run datasets` on a machine that has `REDIS_URL`, `CANVA_CLIENT_ID`, and `CANVA_CLIENT_SECRET`.
- **The bot sends a template link instead of building a design.** Canva is not connected, or the Canva account cannot use autofill. Connect it with the steps above, or reply that the team should design it.
- **The bot stays silent on a thread reply or a photo.** In Event Subscriptions, `message.channels` and `message.groups` have to be listed next to `message.im` and `app_mention`. Save, and reinstall if Slack asks. A photo is a `file_share` message. If the bot receives the message and then fails, it replies in the thread that something went wrong. Silence means Slack did not deliver the event.

## For a developer helping Elena

```bash
npm install
npm test
npm run typecheck
npm run build
npm run dev
```

`npm run dev` listens on port 3000 (or `PORT`) and serves `POST /slack/events` plus `GET /health`. Slack still has to reach a public https address, so a tunnel has to point at that port. Put the variables from `.env.example` in a `.env` file that is not committed. Without `REDIS_URL`, the process keeps briefs in memory and forgets them when it stops. That is only for a local experiment. On Render, `REDIS_URL` is the private Key Value connection string.

Tests cover field order, the Canva matcher, the confirm gate, Slack retry dedupe, and the health route. Asana and Claude are mocked.

## Known open questions

- The older **Proper-Social-Press-2026** brand template was archived. The bot offers only the remaining live file, `EAHVrNTlM1M`. Archived templates are never suggested.
- The intake notes name self-serve resources (stats, brand assets, logos, photo libraries, access requests) but do not include the URLs. The bot will not invent those links. Send Elena the URLs if they should be added.
- DeeDee Brown (Proper & By Proper) and Koral Captain (Collective) are named when a question needs a second contact. Their Slack member ids are not in the source notes, so the bot cannot @mention them until those ids are added.
- Disabled Asana property options are not offered: All By Proper, Residences, and the old New Projects option. The bot offers **New Projects/Development** and **MIN** instead, matching the current board.
- Routing Bucket, Status in Que, and Estimated time are left for the board automations. The bot never writes them.
- The requester's name and email come from their Slack profile, not from the Asana token. The token is a service account. If Slack does not share the email (the workspace must allow the `users:read.email` scope, and the member's email must be visible), the bot asks for it.
