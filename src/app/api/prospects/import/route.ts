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
 * name, email, product_name — required
 * organization, role, prospect_type, qualification_status, fit_reason,
 * opportunity_signal, source_url — optional
 *
 * MILESTONE 7E — source_url made optional per direct request: it was
 * previously required and strictly validated, which meant a realistic
 * CSV export (name/email/company, no "source URL" column — not a
 * typical field in most prospect lists) failed on every single row.
 * When provided, it's still used as the evidence source, same as
 * before. When it's missing, the import proceeds honestly — the
 * evidence records that this was manually imported without a
 * verified source, rather than fabricating one or blocking the import
 * entirely.
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
      const sourceUrlRaw = get("source_url");
      const hasValidSourceUrl = /^https?:\/\//i.test(sourceUrlRaw);

      if (!name || !email || !productName) {
        skipped.push({ row: i + 2, reason: "Missing required name, email, or product_name." });
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
          evidence: hasValidSourceUrl
            ? [
                {
                  observation: `Manually imported by Innocent from ${sourceUrlRaw}.`,
                  source: sourceUrlRaw,
                  observed_at: new Date().toISOString(),
                },
              ]
            : [],
          allow_missing_evidence_source: !hasValidSourceUrl,
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
