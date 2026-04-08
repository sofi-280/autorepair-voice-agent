import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Smart Choice Auto Shop — Voice Agent Dashboard",
  description: "Real-time call monitoring and post-call analytics",
};

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/calls",     label: "Calls" },
  { href: "/live",      label: "Live" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen flex flex-col">
          {/* Top nav */}
          <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
              <div className="flex items-center gap-6">
                <span className="font-bold text-gray-900 text-sm">
                  🔧 Smart Choice Auto Shop
                </span>
                <nav className="flex items-center gap-1">
                  {navItems.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="px-3 py-1.5 rounded-md text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
                    >
                      {item.label}
                    </Link>
                  ))}
                </nav>
              </div>
              <span className="text-xs text-gray-400">Voice Agent v0.1</span>
            </div>
          </header>

          {/* Page content */}
          <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
