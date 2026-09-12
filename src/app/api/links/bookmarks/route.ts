import { NextResponse } from "next/server";
import { defaultBookmarkRoots, discoverBookmarkProfiles } from "@/lib/domain/bookmarks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 发现本机 Chrome/Edge 收藏夹:列出各 profile 及其书签条目(只读)
export async function GET() {
  const profiles = defaultBookmarkRoots().flatMap(({ browser, userDataDir }) => discoverBookmarkProfiles(browser, userDataDir));
  return NextResponse.json({
    profiles: profiles.map((p) => ({
      browser: p.browser,
      profileName: p.profileName,
      bookmarksPath: p.bookmarksPath,
      count: p.items.length,
      folders: [...new Set(p.items.map((i) => i.folder))].filter(Boolean),
      items: p.items,
    })),
  });
}
