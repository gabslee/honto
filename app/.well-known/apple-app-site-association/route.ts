export const dynamic = "force-static";

const APP_ID = "4AW8H42XNA.com.hontogame.app";

/** iOS universal links: magic-link sign-in and pairing links open the app. Served as JSON without an extension. */
export function GET() {
  const body = {
    applinks: {
      details: [{
        appIDs: [APP_ID],
        components: [{ "/": "/auth/email*", comment: "Email magic link" }, { "/": "/j/*", comment: "Pairing code" }],
      }],
    },
  };
  return Response.json(body, { headers: { "Cache-Control": "public, max-age=3600" } });
}
