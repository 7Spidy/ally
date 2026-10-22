// The LLM client posts to `${LLM_BASE_URL}/chat/completions`; in E2E the base
// URL is /api/test/llm-mock, so this path forwards to the mock handler.
export { POST } from "../../route";
