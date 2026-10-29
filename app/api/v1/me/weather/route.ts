import { clearWeatherResponse, reportWeatherResponse } from "../../../../../server/v1/weather";

export const dynamic = "force-dynamic";

/** PUT /api/v1/me/weather: my coarse weather summary (no location stored). */
export async function PUT(request: Request) {
  return reportWeatherResponse(request);
}

/** DELETE /api/v1/me/weather: forget it. */
export async function DELETE(request: Request) {
  return clearWeatherResponse(request);
}
