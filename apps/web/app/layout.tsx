import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Reviewer", template: "%s · Reviewer" },
  description: "High-precision, context-aware pull request review.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
