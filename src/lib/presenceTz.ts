/**
 * The zone each non-Indian face lives in, for the static presence line in the
 * chat header and on the home card. The client cannot import persona files
 * (they are large), so this is a small copy; a unit test ties it to
 * engine.tz in every persona. A face not listed here lives on IST.
 */
export const PERSONA_TZ: Record<string, string> = {
  F14: "Asia/Tokyo",
  F15: "Asia/Manila",
  F16: "America/Sao_Paulo",
  M14: "Asia/Seoul",
  M15: "Africa/Lagos",
  M16: "Europe/Rome",
};
