export const INTAKE_TOOLS = [
  {
    name: "record_answers",
    description:
      "Save everything you can already tell about this request. Call this before asking follow-ups. Do not call it for a pure process question. Omit fields you don't know. Do not invent verbatim copy, codes, or links.",
    input_schema: {
      type: "object",
      properties: {
        requesterName: { type: "string" },
        requesterEmail: { type: "string" },
        requestName: { type: "string", description: "Descriptive name without the property." },
        properties: {
          type: "array",
          items: { type: "string" },
          description: "Property codes such as SMP, AUP, All Proper.",
        },
        requestedCompletionDate: { type: "string", description: "YYYY-MM-DD" },
        consequenceOfDelay: { type: "string" },
        requestType: { type: "string", description: "Creative, Web, CRM & Paid, Social, or Marketing." },
        taskType: { type: "string", description: "Exact task type for that request type." },
        followUps: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Keys are the exact follow-up labels from the question tree. Verbatim fields must be the user's words.",
        },
        approver: { type: "string" },
        whereItGoesLive: { type: "string" },
        finalCopy: { type: "string" },
        copyOwner: { type: "string" },
        copyDueDate: { type: "string" },
        assets: { type: "array", items: { type: "string" } },
        assetsOwner: { type: "string" },
        assetsDue: { type: "string" },
        notes: { type: "string" },
        filingOnBehalf: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "decline_template",
    description:
      "The requester will not use the offered Canva template. Record why (doesn't fit, don't like it, or they want the team to design it) and continue the full brief.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
      additionalProperties: false,
    },
  },
  {
    name: "accept_template",
    description: "The requester will make the piece from the offered Canva template. Do not file a task.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
] as const;

export type ToolName = (typeof INTAKE_TOOLS)[number]["name"];
