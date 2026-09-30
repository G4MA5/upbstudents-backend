export default function Home() {
  return (
    <main className="min-h-screen grid place-items-center p-8 font-sans">
      <div className="text-center">
        <h1 className="text-xl font-semibold">UpB Student&apos;s · API</h1>
        <p className="mt-2 text-sm opacity-70">
          Ce service alimente la bibliothèque numérique.
        </p>
        <a
          className="mt-4 inline-block underline"
          href="https://upbstudents-labibliotheque.com"
        >
          Accéder à la bibliothèque
        </a>
      </div>
    </main>
  );
}
