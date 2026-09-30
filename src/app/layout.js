import "./globals.css";

export const metadata = {
  title: "API · UpB Student's",
  description: "Service de la bibliothèque numérique UpB Student's",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body className="antialiased">{children}</body>
    </html>
  );
}
