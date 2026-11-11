import type { SlackMessageShape } from "../../src/slack/incoming.js";

/** Verbatim plain text from the 2026-11-11 live forward into #marketing-asana-bot. */
export const TAHOE_LIVE_CHANNEL = "C0CBU9X6F0F";
export const TAHOE_LIVE_TS = "1794432254.897819";
export const TAHOE_LIVE_SUBJECT = "FW: Lake Tahoe Membership Page + Interest List";

export const TAHOE_LIVE_BODY = `Elena Ruiz
Manager, Sales Operations & AI
Proper Hotels   |   By Proper   |   The Collective
From: Jamie Mark <jamie.mark@properhotel.com>
Date: Monday, November 9, 2026 at 5:48 PM
To: Kinsey East <kinsey.east@properhotel.com>, Rowan Hand <rowan.hand@properhotel.com>, Elizabeth Van Bergen <elizabeth.vanbergen@properhotel.com>, Tatiana Ting <tatiana.ting@properhotel.com>
Cc: Talley Carlston <talley.carlston@properhotel.com>
Subject: Lake Tahoe Membership Page + Interest List

Hi team,

I'd like to update the Lake Tahoe membership page so we capture better info up front. Talley, looping you in for visibility. Here's what I'm thinking for the interest form:

- First and last name
- Email
- Zip code of primary residence
- Do you own a home in the Lake Tahoe area? (Yes / No)
- If yes, is it your primary residence or a second home?
- Which area? (Incline Village, Crystal Bay, Martis Camp, Lahontan, Clear Creek, Truckee, North Shore, West Shore, South Shore, Other)
- Have you stayed at a Proper before? (Yes / No)

Separately, I've built up our membership interest list by hand to 500+ people, but the info we have on them is pretty fragmented. I'd like to send them a short questionnaire with these same questions to fill in their profiles. Kinsey, I'll send you the list. Rowan, do we have a database of people who have reached out through info@ or through events? That way we can merge them in and categorize everyone the same way.

The incentive for people to sign up or fill this out is that they'll get updates on the project, which everyone wants. So we need a plan for those updates: what we share, how often, and who owns it. Let's make sure we can deliver on that before we launch.

Tatiana and Elizabeth, can you tell me what it takes to add these fields to the page form and send the answers to the same place as our current leads? Happy to jump on a quick call to finalize.

Thanks,
Jamie

Jamie Mark
Senior Vice President, Memberships, Partnerships, and Public Relations
(305) 606-3202
[cid:image001.png@01DD7150.A7D88450]

Proper Hotels   |   By Proper   |   The Collective

Disclaimer

The information contained in this communication from the sender is confidential. It is intended solely for use by the recipient and others authorized to receive it. If you are not the recipient, you are hereby notified that any disclosure, copying, distribution or taking action in relation of the contents of this information is strictly prohibited and may be unlawful.

This email has been scanned for viruses and malware, and may have been automatically archived by Mimecast, a leader in email security and cyber resilience.
`;

export function tahoeLiveSlackEvent(overrides: Partial<SlackMessageShape> = {}): SlackMessageShape {
  return {
    type: "message",
    subtype: "file_share",
    channel: TAHOE_LIVE_CHANNEL,
    channel_type: "channel",
    bot_id: "USLACKBOT",
    user: "USLACKBOT",
    username: "Slackbot",
    text: "",
    ts: TAHOE_LIVE_TS,
    files: [{
      id: "F0CH1TQQ336",
      name: "FW: Lake Tahoe Membership Page + Interest List",
      mimetype: "text/html",
      filetype: "email",
      subject: TAHOE_LIVE_SUBJECT,
      plain_text: TAHOE_LIVE_BODY,
      from: [{
        name: "Elena Ruiz",
        address: "elena.ruiz@properhotel.com",
        original: "Elena Ruiz <elena.ruiz@properhotel.com>",
      }],
    }],
    ...overrides,
  };
}
