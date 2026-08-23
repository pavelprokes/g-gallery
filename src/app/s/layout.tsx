// Share-link routes are guest-facing too — same brand font treatment as src/app/g/layout.tsx.
export default function ShareLinkLayout({ children }: LayoutProps<"/s">) {
  return <div className="font-brand contents">{children}</div>;
}
