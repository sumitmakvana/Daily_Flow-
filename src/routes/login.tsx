import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { auth } from "@/integrations/backend/auth";
import { getMyRoles } from "@/services/auth.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, Mail, Lock, ArrowRight, Eye, EyeOff } from "lucide-react";
import noesisLogo from "@/components/ui/noesis_analytics_logo.svg";

const loginSearchSchema = z.object({
  redirect: z.string().optional(),
  mode: z.enum(["signin", "signup"]).optional(),
});

export const Route = createFileRoute("/login")({
  validateSearch: loginSearchSchema,
  component: LoginPage,
});

async function resolveLanding(fallback?: string): Promise<string> {
  if (fallback && fallback.startsWith("/") && !fallback.startsWith("//") && fallback !== "/login") {
    return fallback;
  }
  try {
    const roles = (await getMyRoles()) as string[];
    const isManager = roles.includes("manager") || roles.includes("admin");
    return isManager ? "/executive" : "/my-day";
  } catch {
    return "/my-day";
  }
}

function LoginPage() {
  const navigate = useNavigate();
  const { redirect, mode } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [redirectingToSignUp, setRedirectingToSignUp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSignUpRedirect = async () => {
    setRedirectingToSignUp(true);
    try {
      await auth.signUp({});
    } catch (e: any) {
      toast.error(e.message || "Failed to redirect to registration.");
      setRedirectingToSignUp(false);
    }
  };

  useEffect(() => {
    let active = true;
    auth.getSession().then(async ({ data }) => {
      if (!active) return;
      if (data.session) {
        const to = await resolveLanding(redirect);
        window.location.replace(to);
      } else if (mode === "signup") {
        handleSignUpRedirect();
      }
    });
    return () => {
      active = false;
    };
  }, [redirect, mode]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await auth.signInWithPassword({ email, password });
      if (error) throw error;
      const to = await resolveLanding(redirect);
      window.location.replace(to);
    } catch (e: any) {
      toast.error(e.message || "Failed to sign in. Please check your credentials.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center bg-background p-4 overflow-hidden">
      {/* Background glowing effects */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,var(--primary)/0.04,transparent_65%)] pointer-events-none" />
      <div 
        className="absolute inset-0 pointer-events-none opacity-[0.02]" 
        style={{
          backgroundImage: `radial-gradient(var(--foreground) 1px, transparent 1px)`,
          backgroundSize: '24px 24px'
        }}
      />
      
      <Card className="w-full max-w-sm p-8 bg-card/60 backdrop-blur-lg border border-border/80 shadow-2xl relative z-10">
        <div className="flex flex-col items-center mb-8">
          <div className="relative mb-3">
            <div className="absolute -inset-1 rounded-full bg-primary/20 blur-md opacity-75 transition duration-1000" />
            <img src={noesisLogo} alt="Noesis Analytics" className="h-12 w-auto relative" />
          </div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">Welcome Back</h2>
          <p className="text-xs text-muted-foreground mt-1">Daily execution for operational teams</p>
        </div>

        {redirectingToSignUp ? (
          <div className="flex flex-col items-center justify-center py-10 space-y-4 animate-in fade-in zoom-in duration-200">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <div className="space-y-1 text-center">
              <p className="text-sm font-medium text-foreground">Redirecting to registration...</p>
              <p className="text-xs text-muted-foreground">Opening secure sign-up on Keycloak</p>
            </div>
          </div>
        ) : (
          <>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Email Address
                </Label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-muted-foreground/75">
                    <Mail className="h-4 w-4" />
                  </span>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    placeholder="you@example.com"
                    className="pl-10 bg-background/50 border-border/80 focus:border-primary/80 focus:ring-1 focus:ring-primary/80 transition-all duration-200"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Password
                </Label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-muted-foreground/75">
                    <Lock className="h-4 w-4" />
                  </span>
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="pl-10 pr-10 bg-background/50 border-border/80 focus:border-primary/80 focus:ring-1 focus:ring-primary/80 transition-all duration-200"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground/70 hover:text-foreground transition-colors cursor-pointer"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium py-2 rounded-md shadow-lg shadow-primary/20 transition-all duration-200 flex items-center justify-center gap-2 group cursor-pointer"
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    Sign in
                    <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
                  </>
                )}
              </Button>
            </form>

            <div className="mt-6 flex flex-col items-center space-y-4">
              <button
                type="button"
                onClick={handleSignUpRedirect}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors duration-200 underline underline-offset-4 cursor-pointer"
              >
                No account? Sign up
              </button>
              
              <div className="w-full flex items-center justify-center gap-2">
                <div className="h-px bg-border flex-1" />
                <span className="text-[10px] text-muted-foreground/60 uppercase tracking-widest font-mono">Info</span>
                <div className="h-px bg-border flex-1" />
              </div>

              <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
                First user to sign up becomes admin.
              </p>
            </div>
          </>
        )}
        <button type="button" onClick={() => navigate({ to: "/" })} className="hidden" />
        <Link to="/" className="hidden" />
      </Card>
    </div>
  );
}

