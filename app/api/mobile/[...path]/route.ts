import gameHandler from "../../../../api/game";
import { MAX_PHOTO_BYTES, resolvePhrase, validatePhoto } from "../../../photo-moments.js";
import { storePhoto } from "../../../photo-storage";
import { mobileAction } from "../mobile-routes.js";
import { resolveMobileRoom } from "../mobile-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const noStore = { "Cache-Control": "no-store, max-age=0" };
const error = (message: string, status: number, code?: string) => Response.json({ error: message, ...(code ? { code } : {}) }, { status, headers: noStore });

async function run(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const action = mobileAction(request.method, path);
  if (!action) return error("Not found", 404);
  const url = new URL(request.url);
  let body: Record<string, unknown> = Object.fromEntries(url.searchParams);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- internal handler request shape
  const req: Record<string, any> = { method: "POST", query: {}, headers: request.headers };

  if (action === "photoUpload") {
    let form: FormData;
    try { form = await request.formData(); } catch { return error("Send the photo as multipart/form-data.", 400); }
    for (const [key, value] of form.entries()) if (typeof value === "string") body[key] = value;
    const file = form.get("photo");
    if (!(file instanceof Blob)) return error("Choose a photo.", 400);
    let phrase: { key: string | null; text: string }; let checked: { type: string; ext: string }; let bytes: Uint8Array;
    try {
      if (file.size > MAX_PHOTO_BYTES) throw new Error("Photos must be 5 MB or smaller.");
      bytes = new Uint8Array(await file.arrayBuffer());
      checked = validatePhoto(bytes, bytes.byteLength);
      phrase = resolvePhrase(body.phraseKey, body.phrase);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Invalid photo.";
      return error(message, message.includes("5 MB") ? 413 : message.startsWith("Only") ? 415 : 400);
    }
    req.photoUpload = { phraseKey: phrase.key, phrase: phrase.text, contentType: checked.type, size: bytes.byteLength, store: (coupleId: string) => storePhoto(coupleId, bytes, checked.type, checked.ext) };
  } else if (request.method !== "GET") {
    try { body = { ...body, ...(await request.json()) }; } catch { /* empty body */ }
  }
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Room ")) body.token = auth.slice(5).trim();
  body = await resolveMobileRoom(request, body);
  if (!body.code || !body.token) return error("No room yet: pass code and token, or join/create a room first.", 401, "no_room");
  body.action = action;
  req.body = body;
  let status = 200;
  let payload: unknown = null;
  const response = {
    setHeader() { return response; },
    status(next: number) { status = next; return response; },
    json(next: unknown) { payload = next; return next; },
  };
  await gameHandler(req, response);
  return Response.json(payload, { status, headers: noStore });
}

export const GET = run;
export const POST = run;
export const PUT = run;
