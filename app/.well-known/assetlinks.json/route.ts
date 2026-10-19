export const dynamic = "force-static";

/**
 * Android App Links for com.hontogame.app. `ANDROID_CERT_SHA256` holds the signing certificate fingerprint(s)
 * (Play App Signing, plus upload/debug keys if wanted), comma separated, `AB:CD:…` form. Read at build time.
 */
export function GET() {
  const fingerprints = (process.env.ANDROID_CERT_SHA256 ?? "").split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);
  const body = fingerprints.length
    ? [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: "com.hontogame.app", sha256_cert_fingerprints: fingerprints } }]
    : [];
  return Response.json(body, { headers: { "Cache-Control": "public, max-age=3600" } });
}
