/** A template re-mounts on every navigation: the new page springs in from the right (globals.css «Motion»). */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
