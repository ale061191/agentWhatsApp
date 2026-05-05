import type { Metadata } from "next";
import { Roboto } from "next/font/google";
import "./globals.css";

const roboto = Roboto({ 
  weight: ["300", "400", "500", "700"],
  subsets: ["latin"] 
});

export const metadata: Metadata = {
  title: "NOVA TECH AI - Agente WhatsApp",
  description: "Asistente de atención al cliente con IA",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className={roboto.className}>{children}</body>
    </html>
  );
}