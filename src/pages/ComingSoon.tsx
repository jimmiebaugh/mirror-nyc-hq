import { Card } from "@/components/ui/card";

export default function ComingSoon({ title }: { title: string }) {
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="text-xs uppercase tracking-widest text-primary">{title}</div>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      </header>
      <Card className="border-dashed border-border bg-transparent p-12 text-center">
        <p className="text-sm text-muted-foreground">Coming soon.</p>
      </Card>
    </div>
  );
}
