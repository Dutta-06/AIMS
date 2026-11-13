/** The line at the bottom of every page. */
export default function SiteFooter({ className = "" }: { className?: string }) {
  return <footer className={`px-5 py-4 text-center text-xs text-faint ${className}`}>AIMS DTU | Odwitiyo Dutta</footer>;
}
