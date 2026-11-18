import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ClipHunter", template: "%s · ClipHunter" },
  description: "Private clip discovery, review and content pipeline.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#09090B" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body
        style={{ ["--font-sans" as string]: '"Inter", "Segoe UI", ui-sans-serif, system-ui, -apple-system, sans-serif' }}
        className="font-sans"
      >
        {children}
        <Toaster theme="dark" position="bottom-right" richColors closeButton toastOptions={{ className: "text-sm" }} />
      </body>
    </html>
  );
}
