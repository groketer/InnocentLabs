import { NextRequest, NextResponse } from "next/server";
import { createProspect, listAllProspectEmails } from "@/lib/models/prospects";
import { getProductByName } from "@/lib/models/products";
import { parseCsv } from "@/lib/csv/csv";
import { LOCAL_USER_ID } from "@/lib/localUser";
import type { ProspectType, ProspectQualificationStatus } from "@/lib/models/prospects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TYPES = new Set<string>(["person", "organization", "partner", "investor", "customer", "publisher", "other"]);
const VALID_QUALIFICATIONS = new Set<string>(["candidate", "needs_review", "qualified", "unqualified"]);

/**
 * Expected columns (case-insensitive, extra columns ignored):
 * name, email, product_name, source_url — required
 * organization, role, prospect_type, qualification_status, fit_reason,
 * opportunity_signal — optional
 *
 * source_url is required and must be a real http(s) URL — every prospect
 * needs at least one verifiable source, the same standard the AI itself
 * is held to when it discovers someone on its own; a manual import
 * doesn't get a lower bar just because a human typed it in instead.
 *
 * This deliberately mirrors what the CSV export produces, so an exported
 * file can be edited and re-imported (e.g. after restoring from a backup,
 * or bulk-adding a list from somewhere else) without reformatting.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }

    const text = await file.text();
    const rows = parseCsv(text);

    if (rows.length === 0) {
      return NextResponse.json({ error: "The CSV file has no data rows." }, { status: 400 });
    }

    const existingEmails = await listAllProspectEmails(LOCAL_USER_ID);
    const productCache = new Map<string, Awaited<ReturnType<typeof getProductByName>>>();

    let imported = 0;
    const skipped: Array<{ row: number; reason: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const get = (key: string) =>
        (row[key] ?? row[key.toLowerCase()] ?? row[key.toUpperCase()] ?? "").trim();

      const name = get("name");
      const email = get("email");
      const productName = get("product_name");
      const sourceUrl = get("source_url");

      if (!name || !email || !productName) {
        skipped.push({ row: i + 2, reason: "Missing required name, email, or product_name." });
        continue;
      }

      if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) {
        skipped.push({
          row: i + 2,
          reason:
            "Missing or invalid source_url — every prospect needs a real, verifiable source (e.g. their LinkedIn profile or company page), the same standard the AI itself is held to.",
        });
        continue;
      }

      if (existingEmails.has(email.toLowerCase())) {
        skipped.push({ row: i + 2, reason: `A prospect with email ${email} already exists.` });
        continue;
      }

      if (!productCache.has(productName)) {
        productCache.set(productName, await getProductByName(productName));
      }
      const product = productCache.get(productName);

      if (!product) {
        skipped.push({ row: i + 2, reason: `Product "${productName}" was not found in the portfolio.` });
        continue;
      }

      const prospectTypeRaw = get("prospect_type").toLowerCase() || "organization";
      const prospectType: ProspectType = VALID_TYPES.has(prospectTypeRaw)
        ? (prospectTypeRaw as ProspectType)
        : "organization";

      const qualificationRaw = get("qualification_status").toLowerCase() || "needs_review";
      const qualification: ProspectQualificationStatus = VALID_QUALIFICATIONS.has(qualificationRaw)
        ? (qualificationRaw as ProspectQualificationStatus)
        : "needs_review";

      try {
        await createProspect({
          user_id: LOCAL_USER_ID,
          name,
          email,
          organization: get("organization") || undefined,
          role: get("role") || undefined,
          prospect_type: prospectType,
          qualification_status: qualification,
          product_id: product.id,
          fit_reason: get("fit_reason") || "Manually imported by Innocent.",
          opportunity_signal:
            get("opportunity_signal") || "Manually identified and imported by Innocent.",
          evidence: [
            {
              observation: `Manually imported by Innocent from ${sourceUrl}.`,
              source: sourceUrl,
              observed_at: new Date().toISOString(),
            },
          ],
          unknowns: [],
        });
        existingEmails.add(email.toLowerCase());
        imported++;
      } catch (error) {
        skipped.push({
          row: i + 2,
          reason: error instanceof Error ? error.message : "Could not create this prospect.",
        });
      }
    }

    return NextResponse.json({ imported, skipped });
  } catch (error) {
    console.error("[api/prospects/import] POST failed:", error);
    return NextResponse.json({ error: "Could not import prospects." }, { status: 500 });
  }
}
