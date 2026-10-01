import "./globals.css";

export const metadata = {
  title: "Ellimium",
  description: "개인용 TRPG VTT",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
