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
        requestedCompletionDate: {
          type: "string",
          description: "YYYY-MM-DD. Resolve this Friday, tomorrow, next Tuesday, and EOW against today in America/Los_Angeles. Do not pass ASAP.",
        },
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
        notes: { type: "string", description: "Do not use. The brief is question/answer lines from followUps only." },
        filingOnBehalf: { type: "boolean" },
        pricePending: {
          type: "boolean",
          description: "True when they don't have the price, pricing, or cost yet. Does not waive any other required answer.",
        },
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
  {
    name: "search_open_tasks",
    description:
      "Find incomplete Asana tasks for anyone in the workspace. Use when someone asks to find, list, or complete tasks, including tasks assigned to another person. Pass assigneeName only when they name someone. Pass text, projectName, dueOn, dueBefore, or dueAfter to narrow. This does not mark anything complete.",
    input_schema: {
      type: "object",
      properties: {
        assigneeName: { type: "string", description: "Person the user named. Omit to search every assignee." },
        text: { type: "string", description: "Words that should appear in the task name." },
        projectName: { type: "string" },
        dueOn: { type: "string", description: "Exact due date YYYY-MM-DD." },
        dueBefore: { type: "string", description: "YYYY-MM-DD, due strictly before this date." },
        dueAfter: { type: "string", description: "YYYY-MM-DD, due strictly after this date." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "count_overdue_tasks",
    description:
      "Count incomplete Asana tasks that are overdue for each named person. Overdue means the due date is before today in America/Los_Angeles. Read-only: do not mark anything complete. Pass every name, including a list of first names. Set includeTasks only when they want the task links, not for a count.",
    input_schema: {
      type: "object",
      properties: {
        names: {
          type: "array",
          items: { type: "string" },
          description: "Each person to count, in the order asked. First names are fine.",
        },
        includeTasks: { type: "boolean", description: "True only when they asked to see the overdue tasks or links." },
      },
      required: ["names"],
      additionalProperties: false,
    },
  },
  {
    name: "complete_tasks",
    description:
      "Stage the tasks from the latest search_open_tasks result so the app can show a Confirm button. Does not mark them complete. Call this only when the person asked to mark tasks complete and the search returned 25 or fewer. Pass gids to complete a subset; omit gids to stage every task from that search.",
    input_schema: {
      type: "object",
      properties: {
        gids: { type: "array", items: { type: "string" }, description: "Task GIDs from the latest search. Omit for all of them." },
      },
      additionalProperties: false,
    },
  },
] as const;

export type ToolName = (typeof INTAKE_TOOLS)[number]["name"];
