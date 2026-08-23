// Guest-facing gallery routes get the brand font (Bitter) — see src/lib/fonts.ts and the
// design-unification plan. `display: contents` keeps this wrapper out of the layout box model
// so it can't interfere with flex/grid assumptions in the pages below it.
export default function GuestGalleryLayout({ children }: LayoutProps<"/g">) {
  return <div className="font-brand contents">{children}</div>;
}
