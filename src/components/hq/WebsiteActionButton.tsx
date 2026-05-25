export function WebsiteActionButton({ url }: { url: string | null }) {
  return (
    <a
      className="btn btn-coral btn-sm"
      href={url ?? "#"}
      target={url ? "_blank" : undefined}
      rel={url ? "noopener noreferrer" : undefined}
      style={url ? undefined : { opacity: 0.45, pointerEvents: "none", cursor: "not-allowed" }}
      onClick={(e) => {
        e.stopPropagation();
        if (!url) e.preventDefault();
      }}
    >
      Website
    </a>
  );
}
