import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import CaptivePortal from "@/pages/captive-portal";
import Dashboard from "@/pages/dashboard";
import AdminDashboard from "@/pages/admin-dashboard";
import DatabaseManager from "@/pages/database-manager";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={CaptivePortal} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/admin" component={AdminDashboard} />
      <Route path="/admin/database" component={DatabaseManager} />
      <Route component={CaptivePortal} />
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
