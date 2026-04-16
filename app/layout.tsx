import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Multi-tenant SaaS Demo",
  description: "A production-ready minimal multi-tenant SaaS application",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
