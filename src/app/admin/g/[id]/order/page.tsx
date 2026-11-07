import { redirect } from "next/navigation";

/** Arranging by hand moved onto the gallery's own page; old links still land there. */
export default async function GalleryOrderPage(props: PageProps<"/admin/g/[id]/order">) {
  const { id } = await props.params;
  redirect(`/admin/g/${id}?arrange=1`);
}
