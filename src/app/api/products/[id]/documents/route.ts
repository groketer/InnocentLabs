import { NextRequest, NextResponse } from "next/server";
import {
  addProductDocument,
  listProductDocuments,
} from "@/lib/models/productDocuments";
import { getProductById } from "@/lib/models/products";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15MB — generous for a full book as PDF/DOCX/TXT

async function extractText(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();

  if (name.endsWith(".pdf")) {
    const pdfParse = (await import("pdf-parse")).default;
    const result = await pdfParse(buffer);
    return result.text;
  }

  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (name.endsWith(".txt") || name.endsWith(".md")) {
    return buffer.toString("utf-8");
  }

  throw new Error(
    `Unsupported file type for "${file.name}" — only .pdf, .docx, .txt, and .md are supported.`
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const documents = await listProductDocuments(params.id);
    return NextResponse.json({ documents });
  } catch (error) {
    console.error("[api/products/[id]/documents] GET failed:", error);
    return NextResponse.json({ error: "Could not load documents." }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const product = await getProductById(params.id);
    if (!product) {
      return NextResponse.json({ error: "Product not found." }, { status: 404 });
    }

    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }

    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `File is too large — max ${MAX_FILE_BYTES / 1024 / 1024}MB.` },
        { status: 400 }
      );
    }

    let text: string;
    try {
      text = await extractText(file);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Could not read this file." },
        { status: 400 }
      );
    }

    const cleanedText = text.trim();
    if (cleanedText.length < 20) {
      return NextResponse.json(
        { error: "Couldn't extract meaningful text from this file — it may be empty, image-only, or corrupted." },
        { status: 400 }
      );
    }

    const document = await addProductDocument({
      product_id: params.id,
      filename: file.name,
      text: cleanedText,
    });

    return NextResponse.json({ document });
  } catch (error) {
    console.error("[api/products/[id]/documents] POST failed:", error);
    return NextResponse.json({ error: "Could not upload document." }, { status: 500 });
  }
}
