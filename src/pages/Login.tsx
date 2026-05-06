import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function Login() {
  const { user, loading, signInWithGoogle } = useAuth();

  useEffect(() => {
    document.title = "Sign in · Mirror NYC HQ";
  }, []);

  if (loading) return null;
  if (user) return <Navigate to="/" replace />;

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <Card className="w-full max-w-sm border-border">
        <CardContent className="space-y-6 p-8">
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-widest text-primary">
              Internal
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Mirror NYC HQ
            </h1>
            <p className="text-sm text-muted-foreground">
              Sign in with your Mirror NYC Google account.
            </p>
          </div>
          <Button onClick={signInWithGoogle} className="w-full" size="lg">
            Continue with Google
          </Button>
          <p className="text-xs text-muted-foreground">
            Access restricted to @mirrornyc.com accounts.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
