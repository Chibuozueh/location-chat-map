"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";

const TARGET_TAB_NAMES: ReadonlySet<string> = new Set([
  "Comm Fitness Classes & Prog",
  "Basketball Courts",
  "Gyms & Fitness Spaces",
  "Parks & Rec",
  "Aquatics & Swim Locations",
  "MARTA Public Transit",
]);

export type DiscoveredTab = {
  gid: string;
  name: string;
  rowCount: number;
};

/**
 * Discover the whitelisted tabs of a publicly-shared Google Sheet by
 * fetching its HTML server-side and parsing the embedded tab metadata.
 *
 * This avoids CORS problems that occur when the browser fetches the
 * `/edit?usp=sharing` page directly.
 */
export const discoverTabs = action({
  args: { sheetId: v.string() },
  returns: v.array(
    v.object({
      gid: v.string(),
      name: v.string(),
      rowCount: v.number(),
    }),
  ),
  handler: async (_ctx, { sheetId }) => {
    const htmlUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit?usp=sharing`;
    const resp = await fetch(htmlUrl);
    if (!resp.ok) {
      console.error(`[sheets.discoverTabs] fetch failed: ${resp.status}`);
      return [];
    }

    const html = await resp.text();
    const tabs: DiscoveredTab[] = [];

    // Match the literal backslash-quote pairs that Google Sheets embeds in
    // its HTML/JSON (e.g. ,"417120538",[{"1":[[0,0,"Comm Fitness Classes & Prog").
    const re =
      /,\\"(\d{6,15})\\",\[{\\"1\\":\[\[0,0,\\"((?:[^\\]|\\.)+?)\\"/g;

    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null && tabs.length < 15) {
      const gid = m[1];
      let rawName = m[2];

      // Decode the double-escaped JS string literals in tab names.
      rawName = rawName
        .replace(/\\\\/g, "\\")
        .replace(/\\u([0-9a-fA-F]{4})/gi, (_, h) =>
          String.fromCharCode(parseInt(h, 16)),
        )
        .replace(/\\"/g, '"');

      if (!rawName || !TARGET_TAB_NAMES.has(rawName.trim())) continue;
      if (!tabs.some((t) => t.gid === gid)) {
        tabs.push({ gid, name: rawName, rowCount: 0 });
      }
    }

    return tabs;
  },
});
