import { Link } from "react-router-dom";

type Contact = {
  id: string;
  full_name: string;
  email: string | null;
};

export function ContactsCard({
  contacts,
  emptyMessage = "No contacts yet.",
  getHref = (id) => `/people/${id}`,
}: {
  contacts: Contact[];
  emptyMessage?: string;
  getHref?: (id: string) => string;
}) {
  return (
    <section className="card">
      <div className="card-headbar">
        <span className="h-card">Contacts</span>
      </div>
      <div className="card-pad">
        {contacts.length === 0 ? (
          <p className="subtle" style={{ fontSize: 13 }}>{emptyMessage}</p>
        ) : (
          <div className="stack-3">
            {contacts.map((c) => (
              <Link
                key={c.id}
                to={getHref(c.id)}
                className="row-c"
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <span className="av-i">
                  {(c.full_name ?? "?").slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <div style={{ fontSize: 15 }}>{c.full_name}</div>
                  <div
                    className="cap"
                    style={{
                      fontSize: 13,
                      ...(c.email ? { color: "hsl(var(--primary-hover))" } : {}),
                    }}
                  >
                    {c.email ?? "-"}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
