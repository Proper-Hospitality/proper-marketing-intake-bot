import type { SlackMessageShape } from "../../src/slack/incoming.js";

export const TAHOE_CHANNEL = "CEMAIL";
export const TAHOE_TS = "1762880000.000100";
export const TAHOE_SUBJECT = "FW: Lake Tahoe Membership Page + Interest List";

export const TAHOE_BODY = `Hi team — forwarding this from Jamie.

---------- Forwarded message ---------
From: Jamie Mark, SVP Memberships, Partnerships & PR <jamie.mark@properhospitality.com>
Date: Tue, 10 Nov 2026 at 9:14 AM
Subject: Lake Tahoe Membership Page + Interest List
To: Rowan Smith <rowan.smith@properhospitality.com>

Hi,

We need a few things in place for the Lake Tahoe membership launch.

(a) Add interest form fields to the Lake Tahoe membership web page (first/last name, email, zip of primary residence, own a home in the Lake Tahoe area Y/N, primary vs second home, which area [Incline Village, Crystal Bay, Martis Camp, Lahontan, Clear Creek, Truckee, North Shore, West Shore, South Shore, Other], stayed at a Proper before Y/N) and route the answers to the same place as current leads.

(b) Send a short questionnaire with the same questions to a hand-built 500+ person membership interest list.

(c) Merge in people who reached out via info@ or events so everyone is categorized the same way.

(d) Create a plan for project updates (what we share, how often, and who owns it) before launch.

Thank you,
Jamie Mark
SVP Memberships, Partnerships & PR
`;

export function tahoeSlackEvent(overrides: Partial<SlackMessageShape> = {}): SlackMessageShape {
  return {
    type: "message",
    subtype: "file_share",
    channel: TAHOE_CHANNEL,
    channel_type: "channel",
    bot_id: "BEMAIL",
    user: "UEMAILAPP",
    username: "Email",
    text: "",
    ts: TAHOE_TS,
    files: [{
      id: "FEMAIL",
      name: "FW: Lake Tahoe Membership Page + Interest List.eml",
      mimetype: "message/rfc822",
      filetype: "email",
      mode: "email",
      subject: TAHOE_SUBJECT,
      plain_text: TAHOE_BODY,
      permalink: "https://properhospitalitycorp.slack.com/files/FEMAIL/email.eml",
      from: [{
        name: "Rowan Smith",
        address: "rowan.smith@properhospitality.com",
        original: "Rowan Smith <rowan.smith@properhospitality.com>",
      }],
      attachments: [{
        id: "FLIST",
        name: "interest-list.xlsx",
        mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        permalink: "https://properhospitalitycorp.slack.com/files/FLIST/interest-list.xlsx",
      }],
    }],
    ...overrides,
  };
}
