import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";
import EngineTicker from "@/components/EngineTicker";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

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
    <html lang="en" className={spaceGrotesk.variable}>
      <body className="antialiased">
        <EngineTicker />
        {children}
      </body>
    </html>
  );
}
