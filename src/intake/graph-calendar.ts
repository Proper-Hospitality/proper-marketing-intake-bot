import {
  GRAPH_TIME_ZONE,
  KICKOFF_MINUTES,
  calendarConfigured,
  type CalendarClient,
  type MeetingSuggestion,
  type ScheduleBusy,
} from "./schedule.js";

/**
 * Microsoft Graph application auth. Optional.
 * Needs Calendars.Read (and Calendars.ReadWrite if a later change should send the invite).
 * When the tenant, client id, or secret is missing, the bot never calls Graph.
 */

interface TokenCache {
  token: string;
  expiresAt: number;
}

let cached: TokenCache | undefined;

export function createGraphCalendarClient(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): CalendarClient | null {
  if (!calendarConfigured(env)) return null;
  const tenant = env.MS_GRAPH_TENANT_ID?.trim() as string;
  const clientId = env.MS_GRAPH_CLIENT_ID?.trim() as string;
  const clientSecret = env.MS_GRAPH_CLIENT_SECRET?.trim() as string;
  return {
    async findMeetingTimes(input) {
      const token = await accessToken(fetchImpl, tenant, clientId, clientSecret);
      const body = {
        attendees: input.attendees.map((address) => ({
          type: "required",
          emailAddress: { address },
        })),
        timeConstraint: {
          activityDomain: "work",
          timeSlots: [
            {
              start: { dateTime: input.windowStart, timeZone: GRAPH_TIME_ZONE },
              end: { dateTime: input.windowEnd, timeZone: GRAPH_TIME_ZONE },
            },
          ],
        },
        meetingDuration: `PT${input.durationMinutes || KICKOFF_MINUTES}M`,
        maxCandidates: 3,
        isOrganizerOptional: false,
        returnSuggestionReasons: false,
        minimumAttendeePercentage: 100,
      };
      const payload = await graphPost<{
        meetingTimeSuggestions?: Array<{
          meetingTimeSlot?: {
          start?: { dateTime?: string; timeZone?: string };
          end?: { dateTime?: string; timeZone?: string };
        };
        }>;
      }>(fetchImpl, token, `/users/${encodeURIComponent(input.organizer)}/findMeetingTimes`, body);
      const suggestions: MeetingSuggestion[] = [];
      for (const item of payload.meetingTimeSuggestions ?? []) {
        const start = item.meetingTimeSlot?.start?.dateTime;
        const end = item.meetingTimeSlot?.end?.dateTime;
        if (start && end) {
          suggestions.push({
            start,
            end,
            timeZone: item.meetingTimeSlot?.start?.timeZone,
          });
        }
      }
      return suggestions;
    },
    async getSchedule(input) {
      const token = await accessToken(fetchImpl, tenant, clientId, clientSecret);
      const payload = await graphPost<{
        value?: Array<{
          scheduleItems?: Array<{
            status?: string;
            start?: { dateTime?: string; timeZone?: string };
            end?: { dateTime?: string; timeZone?: string };
          }>;
        }>;
      }>(fetchImpl, token, `/users/${encodeURIComponent(input.organizer)}/calendar/getSchedule`, {
        schedules: input.schedules,
        startTime: { dateTime: input.windowStart, timeZone: GRAPH_TIME_ZONE },
        endTime: { dateTime: input.windowEnd, timeZone: GRAPH_TIME_ZONE },
        availabilityViewInterval: KICKOFF_MINUTES,
      });
      const busy: ScheduleBusy[] = [];
      for (const schedule of payload.value ?? []) {
        for (const item of schedule.scheduleItems ?? []) {
          if (item.status === "free") continue;
          if (!item.start?.dateTime || !item.end?.dateTime) continue;
          busy.push({
            start: item.start.dateTime,
            end: item.end.dateTime,
            timeZone: item.start.timeZone,
          });
        }
      }
      return busy;
    },
  };
}

async function accessToken(fetchImpl: typeof fetch, tenant: string, clientId: string, clientSecret: string): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const response = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Graph token request failed (${response.status}).`);
  }
  const parsed = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!parsed.access_token) throw new Error("Graph token response had no access_token.");
  cached = {
    token: parsed.access_token,
    expiresAt: Date.now() + (parsed.expires_in ?? 3600) * 1000,
  };
  return parsed.access_token;
}

async function graphPost<T>(fetchImpl: typeof fetch, token: string, path: string, body: unknown): Promise<T> {
  const response = await fetchImpl(`https://graph.microsoft.com/v1.0${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Graph ${path} failed (${response.status}).`);
  }
  return text ? JSON.parse(text) as T : ({} as T);
}
