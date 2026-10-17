// Maps clean mobile JSON routes onto the game API actions (pure, unit-testable).
export const MOBILE_ROUTES = {
  "GET daily": "daily",
  "POST daily/answer": "dailyAnswer",
  "POST daily/confirm-adult": "dailyConfirmAdult",
  "GET history": "history",
  "PUT reunion": "setReunion",
  "POST reunion": "setReunion",
  "GET moments/latest": "photoLatest",
  "POST moments/photo": "photoUpload",
};
export function mobileAction(method, path) {
  return MOBILE_ROUTES[`${String(method).toUpperCase()} ${path.join("/")}`] ?? null;
}
