import { HomePolaroidGrid } from "@/components/HomePolaroidGrid";
import { getFilms } from "@/lib/getFilms";

export const revalidate = 21600;

export default async function Home() {
  const { films, error } = await getFilms();

  return (
    <>
      {error ? (
        <p
          className="fixed left-1/2 top-5 z-50 max-w-md -translate-x-1/2 px-4 text-center text-sm text-red-400/90"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      <HomePolaroidGrid films={films} />
    </>
  );
}
