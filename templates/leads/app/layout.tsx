import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { publicBranding } from "@/lib/crm/public-branding";
import { defaultBusinessLogo } from "@/lib/crm/business-logo";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const brand = await publicBranding();
  return {
    title: `${brand.businessName} — Support & CRM`,
    description:
      "Customer inquiries, reply reviews, and follow-ups in one workspace.",
    icons: {
      icon: [{ url: brand.businessLogo || (brand.generic ? "/brand/customerlead.svg" : defaultBusinessLogo), type: brand.businessLogo ? "image/webp" : brand.generic ? "image/svg+xml" : "image/png" }],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* Extensions such as Grammarly can add body attributes before hydration. */}
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
