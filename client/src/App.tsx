import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import Landing from "@/pages/Landing";
import Home from "@/pages/Home";
import RatingsPage from "@/pages/RatingsPage";
import { PaymentsPage } from "@/pages/PaymentsPage";
import { CardSetupPage } from "@/pages/CardSetupPage";
import TestLogin from "@/pages/TestLogin";
import EmergencyTracking from "@/pages/EmergencyTracking";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import AdminDashboard from "@/pages/AdminDashboard";
import DriverInsights from "@/pages/DriverInsights";
import DriverRateCard from "@/pages/DriverRateCard";
import NotFound from "@/pages/not-found";

function AuthRedirect({ component: Component }: { component: React.ComponentType }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (!isLoading && isAuthenticated) {
    return <Redirect to="/" />;
  }

  return <Component />;
}

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

  return (
    <Switch>
      {/* Public emergency tracking route (no auth required) */}
      <Route path="/emergency/:token" component={EmergencyTracking} />
      
      {/* Auth routes redirect to home if already logged in */}
      <Route path="/login">{() => <AuthRedirect component={Login} />}</Route>
      <Route path="/signup">{() => <AuthRedirect component={Signup} />}</Route>
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/test-login" component={TestLogin} />
      
      {isLoading || !isAuthenticated ? (
        <Route path="/" component={Landing} />
      ) : (
        <>
          <Route path="/" component={Home} />
          <Route path="/ratings" component={RatingsPage} />
          <Route path="/payments" component={PaymentsPage} />
          <Route path="/card-setup" component={CardSetupPage} />
          <Route path="/admin" component={AdminDashboard} />
          <Route path="/driver/insights" component={DriverInsights} />
          <Route path="/driver/rate-card" component={DriverRateCard} />
        </>
      )}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
