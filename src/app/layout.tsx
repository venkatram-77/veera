import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Veera — Local AI Assistant",
  description: "A private, zero-cost AI assistant running entirely on your PC.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
