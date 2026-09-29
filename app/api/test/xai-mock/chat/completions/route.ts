// The xAI client posts to `${XAI_BASE_URL}/chat/completions`; in E2E the base
// URL is /api/test/xai-mock, so this path forwards to the mock handler.
export { POST } from "../../route";
