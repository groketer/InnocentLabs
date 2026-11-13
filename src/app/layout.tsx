import type { Metadata } from "next";
// The font ships with the app (from npm) instead of being downloaded from
// Google Fonts during every build. That download (next/font/google) was
// failing Vercel builds with "An error occurred in `next/font`".
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "./globals.css";
import EngineTicker from "@/components/EngineTicker";

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
      <body className="antialiased">
        <EngineTicker />
        {children}
      </body>
    </html>
  );
}
