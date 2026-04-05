export interface Film {
  guid: string;
  watchedDate: string;
  image: string | null;
  filmTitle: string;
  filmYear: string;
  memberRating: number | null;
  memberLike: boolean;
}
