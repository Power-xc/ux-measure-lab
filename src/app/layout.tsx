import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UX MeasureLab",
  description: "근거에서 제품 의사결정까지 이어지는 UX 측정 워크스페이스",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
