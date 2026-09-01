import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Innocent Intelligence",
  description:
    "Innocent Intelligence — a private AI business-development partner for Innocent Labs.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
