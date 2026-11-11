import type { SlackMessageShape } from "../../src/slack/incoming.js";

/**
 * Live retest, 2026-11-11 1:48 PM PT. Elena forwarded Rowan's forward of Jamie's email.
 * Rowan is a recipient and an intermediate forwarder, not the requester.
 */
export const NESTED_CHANNEL = "C0CBU9X6F0F";
export const NESTED_TS = "1794433726.712909";
export const NESTED_SUBJECT = "FW: Lake Tahoe Membership Page + Interest List";

export const NESTED_BODY = `Elena Ruiz Galarreta
Manager, Sales Operations and AI
(424) 413-7328
Proper Hotels<https://www.properhotel.com/>   |   By Proper   |   <https://shelborne.com/> The Collective<https://www.properhotel.com/the-collective/>
From: Rowan Hand <rowan.hand@properhotel.com>
Date: Tuesday, November 10, 2026 at 5:18 PM
To: Kinsey East <kinsey.east@properhotel.com>; Elena Ruiz <elena.ruiz@properhotel.com>
Subject: FW: Lake Tahoe Membership Page + Interest List

Can you guys use this as an example with the asana bot, please?

Rowan Hand
Senior Vice President, Sales & Marketing
(917) 742-3630
Proper Hotels<https://www.properhotel.com/>   |   By Proper   |   <https://shelborne.com/> The Collective<https://www.properhotel.com/the-collective/>
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

Proper Hotels<https://www.properhotel.com/>   |   By Proper   |   <https://shelborne.com/> The Collective<https://www.properhotel.com/the-collective/>

Disclaimer

The information contained in this communication from the sender is confidential.
`;

export function nestedSlackEvent(): SlackMessageShape {
  return {
    type: "message",
    subtype: "file_share",
    channel: NESTED_CHANNEL,
    channel_type: "channel",
    bot_id: "USLACKBOT",
    user: "USLACKBOT",
    username: "Slackbot",
    text: "",
    ts: NESTED_TS,
    files: [{
      id: "F0CH09GK5CZ",
      name: "FW: Lake Tahoe Membership Page + Interest List",
      mimetype: "text/html",
      filetype: "email",
      subject: NESTED_SUBJECT,
      plain_text: NESTED_BODY,
      from: [{
        name: "Elena Ruiz",
        address: "elena.ruiz@properhotel.com",
        original: "Elena Ruiz <elena.ruiz@properhotel.com>",
      }],
    }],
  };
}
