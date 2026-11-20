// Size of the front image on the home page. The box always has the picture's own shape,
// so the rounded corners are the picture's corners.
export type FrontSize = 'small' | 'medium' | 'large';
export const FRONT_SIZES: FrontSize[] = ['small', 'medium', 'large'];

// Largest box for each size, as a share of the available width and a height limit.
const LIMITS: Record<FrontSize, { width: number; height: number | null }> = {
  small: { width: 0.6, height: 220 },     // like the first version
  medium: { width: 0.8, height: 340 },
  large: { width: 1, height: null },      // full width
};

// Very tall pictures are trimmed a little (to 4:5) so they don't push everything off the screen.
export function frontAspect(width: number, height: number): number {
  return width > 0 && height > 0 ? Math.max(width / height, 0.8) : 16 / 9;
}

export function frontSize(value: string | null | undefined): FrontSize {
  return FRONT_SIZES.includes(value as FrontSize) ? (value as FrontSize) : 'large';
}

// available: the page width the picture can use; aspect: width / height of the picture
export function frontBox(available: number, aspect: number, size: FrontSize): { width: number; height: number } {
  const limit = LIMITS[size];
  let width = available * limit.width;
  let height = width / aspect;
  if (limit.height !== null && height > limit.height) {
    height = limit.height;
    width = height * aspect;
  }
  return { width: Math.round(width), height: Math.round(height) };
}
