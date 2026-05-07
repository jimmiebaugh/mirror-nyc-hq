import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function firstName(user: { email?: string | null; user_metadata?: Record<string, unknown> } | null) {
  if (!user) return "there";
  const meta = (user.user_metadata ?? {}) as Record<string, string>;
  const name = meta.full_name || meta.name || meta.given_name;
  if (name) return String(name).split(" ")[0];
  if (user.email) return user.email.split("@")[0].split(".")[0].replace(/^./, (c) => c.toUpperCase());
  return "there";
}

const cards = [
  { title: "My Tasks", body: "Coming soon" },
  { title: "My Projects", body: "Coming soon" },
  { title: "Recent Activity", body: "Coming soon" },
];

export default function Dashboard() {
  const { user } = useAuth();
  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <div className="text-[14px] font-mono uppercase tracking-widest text-primary">Dashboard</div>
        <h1 className="h-page">
          Welcome, {firstName(user)}
        </h1>
      </header>
      <div className="grid gap-4 md:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.title} className="border-border">
            <CardHeader>
              <CardTitle className="text-base font-medium">{c.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{c.body}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
