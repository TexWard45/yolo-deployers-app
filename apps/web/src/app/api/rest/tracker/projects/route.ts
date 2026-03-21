import { NextResponse } from "next/server";
import { getTrackerService } from "@shared/rest/tracker";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const apiToken = searchParams.get("apiToken");
  const siteUrl = searchParams.get("siteUrl");

  if (!type || !apiToken) {
    return NextResponse.json({ error: "type and apiToken are required" }, { status: 400 });
  }

  try {
    const service = getTrackerService(type);
    const valid = await service.validateToken(apiToken, siteUrl);
    if (!valid) {
      return NextResponse.json({ error: "Invalid API token" }, { status: 400 });
    }
    const projects = await service.listProjects(apiToken, siteUrl);
    return NextResponse.json(projects);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch projects";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
