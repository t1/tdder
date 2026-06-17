// Use the same pi-ai module instance that @earendil-works/pi-coding-agent resolves at runtime.
// Importing @earendil-works/pi-ai directly from the repo root can hit a different module instance,
// which makes faux provider registrations invisible to createAgentSession().
export {
  fauxAssistantMessage,
  fauxToolCall,
  registerFauxProvider,
} from "../../../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/index.js";
