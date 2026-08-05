import type { GatewayMessage } from "../providers/provider.js";

export function createCodeModeSystemMessage(agentEnabled: boolean): GatewayMessage {
  const deliveryRules = agentEnabled
    ? `Agent file tools are available. When the user asks you to create, modify, or provide a code deliverable, use write_file for every intended file. ModelDock will package files written in this turn into a downloadable ZIP attachment. Do not merely paste a large implementation or claim a file exists without using write_file.`
    : `You do not have file or terminal tools in this request. Do not claim that you created, saved, executed, or tested a file. When code is required, show each file with a clear filename heading followed by a language-labelled fenced code block, so the browser user can copy it directly.`;

  return {
    role: "system",
    content: `ModelDock Code mode is ENABLED for this conversation.
Treat coding and software-engineering requests as implementation work. Infer and preserve the language, runtime, framework, existing architecture, and constraints from the conversation. If a necessary detail is missing, make the safest reasonable assumption and state it briefly.
Provide a complete, runnable implementation rather than pseudocode, isolated fragments, TODO placeholders, or omitted sections. Keep imports, types, configuration, filenames, setup steps, run commands, and tests internally consistent. Never claim that you executed or verified something unless an available tool actually did so.
For explanation, diagnosis, or review-only requests, answer the requested question directly; do not manufacture files or rewrite unrelated code.
${deliveryRules}`,
  };
}
