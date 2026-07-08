import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { CallProvider } from "@/contexts/CallContext";
import { CallModal } from "@/components/CallModal";
import { NotificationToastListener } from "@/components/NotificationToastListener";

// Pages
import LandingPage from "@/pages/LandingPage";
import SignInPage from "@/pages/SignInPage";
import SignUpPage from "@/pages/SignUpPage";
import FeedPage from "@/pages/FeedPage";
import ExplorePage from "@/pages/ExplorePage";
import ProfilePage from "@/pages/ProfilePage";
import PublicProfilePage from "@/pages/PublicProfilePage";
import UploadPage from "@/pages/UploadPage";
import NotificationsPage from "@/pages/NotificationsPage";
import VideoPage from "@/pages/VideoPage";
import NotFoundPage from "@/pages/NotFoundPage";
import MessagesPage from "@/pages/MessagesPage";
import ConversationPage from "@/pages/ConversationPage";

const queryClient = new QueryClient();

// REQUIRED — copy verbatim
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

// REQUIRED — copy verbatim. Empty in dev, auto-set in prod.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);
  return null;
}

function AppRoutes() {
  return (
    <Switch>
      <Route path="/" component={LandingPage} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/feed" component={FeedPage} />
      <Route path="/explore" component={ExplorePage} />
      <Route path="/profile" component={ProfilePage} />
      <Route path="/profile/:username" component={PublicProfilePage} />
      <Route path="/upload" component={UploadPage} />
      <Route path="/notifications" component={NotificationsPage} />
      <Route path="/messages" component={MessagesPage} />
      <Route path="/messages/:id" component={ConversationPage} />
      <Route path="/video/:id" component={VideoPage} />
      <Route component={NotFoundPage} />
    </Switch>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  const clerkAppearance = {
    theme: shadcn,
    cssLayerName: "clerk",
    options: {
      logoPlacement: "inside" as const,
      logoLinkUrl: basePath || "/",
      logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
    },
    variables: {
      colorPrimary: "#8b5cf6",
      colorForeground: "#f8fafc",
      colorMutedForeground: "#94a3b8",
      colorDanger: "#ef4444",
      colorBackground: "#0f0f14",
      colorInput: "#1e1e2e",
      colorInputForeground: "#f8fafc",
      colorNeutral: "#2d2d3d",
      fontFamily: "'Inter', system-ui, sans-serif",
      borderRadius: "0.75rem",
    },
    elements: {
      rootBox: "w-full flex justify-center",
      cardBox: "bg-[#0f0f14] border border-white/10 rounded-2xl w-[440px] max-w-full overflow-hidden shadow-2xl",
      card: "!shadow-none !border-0 !bg-transparent !rounded-none",
      footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
      headerTitle: "text-white font-semibold text-xl",
      headerSubtitle: "text-slate-400 text-sm",
      socialButtonsBlockButtonText: "text-white",
      formFieldLabel: "text-slate-300 text-sm",
      footerActionLink: "text-violet-400 hover:text-violet-300",
      footerActionText: "text-slate-500",
      dividerText: "text-slate-600",
      identityPreviewEditButton: "text-violet-400",
      formFieldSuccessText: "text-emerald-400",
      alertText: "text-red-400",
      logoBox: "flex justify-center py-2",
      logoImage: "h-8 w-auto",
      socialButtonsBlockButton: "bg-white/5 border border-white/10 hover:bg-white/10",
      formButtonPrimary: "bg-violet-600 hover:bg-violet-500 text-white",
      formFieldInput: "bg-[#1e1e2e] border-white/10 text-white placeholder-slate-600",
      footerAction: "bg-[#0a0a12]",
      dividerLine: "bg-white/10",
      alert: "bg-red-500/10 border-red-500/20",
      otpCodeFieldInput: "bg-[#1e1e2e] border-white/10 text-white",
      main: "gap-4",
    },
  };

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: { start: { title: "Welcome back to Aura", subtitle: "Sign in to continue" } },
        signUp: { start: { title: "Join Aura", subtitle: "Create your account to get started" } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <CallProvider>
          <TooltipProvider>
            {/* Desktop constraint container wrapper for mobile feel */}
            <div className="bg-neutral-950 min-h-[100dvh] flex items-center justify-center text-foreground dark">
              <div className="w-full h-[100dvh] max-w-[430px] bg-background relative overflow-hidden sm:border-x sm:border-white/10 sm:shadow-2xl flex flex-col">
                <div className="flex-1 w-full h-full relative overflow-y-auto overflow-x-hidden hide-scrollbar">
                  <AppRoutes />
                </div>
              </div>
            </div>
            {/* Call modal rendered outside the scroll container so it covers everything */}
            <CallModal />
            <NotificationToastListener />
            <Toaster />
          </TooltipProvider>
        </CallProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
