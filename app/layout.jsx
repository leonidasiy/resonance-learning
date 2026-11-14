import "@ui-sdk/core/web.css";
import "./globals.css";
import "../src/styles.css";

export const metadata = {
  title: "Resonance Learning",
  description: "A private adaptive learning workspace for curious minds.",
  manifest: "/manifest.webmanifest",
  icons: "/assets/app-icon-192.png",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f1f2ec",
  colorScheme: "light dark",
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
