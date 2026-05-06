import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminRoute } from "@/components/AdminRoute";
import AppShell from "@/components/AppShell";
import Dashboard from "./pages/Dashboard";
import Projects from "./pages/Projects";
import ComingSoon from "./pages/ComingSoon";
import NotFound from "./pages/NotFound.tsx";
import TalentScoutIndex from "./pages/talent-scout/Index";
import NewRoleDetails from "./pages/talent-scout/NewRoleDetails";
import NewRoleSearch from "./pages/talent-scout/NewRoleSearch";
import NewRoleScorecard from "./pages/talent-scout/NewRoleScorecard";
import RoleDashboard from "./pages/talent-scout/RoleDashboard";
import RoleSettings from "./pages/talent-scout/RoleSettings";
import PullDetail from "./pages/talent-scout/PullDetail";
import CandidateDetail from "./pages/talent-scout/CandidateDetail";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/venues" element={<ComingSoon title="Venues" />} />
              <Route path="/clients" element={<ComingSoon title="Clients" />} />
              <Route path="/tasks" element={<ComingSoon title="Tasks" />} />
              <Route
                path="/talent-scout"
                element={
                  <AdminRoute>
                    <TalentScoutIndex />
                  </AdminRoute>
                }
              />
              <Route
                path="/talent-scout/new/details"
                element={
                  <AdminRoute>
                    <NewRoleDetails />
                  </AdminRoute>
                }
              />
              <Route
                path="/talent-scout/new/search"
                element={
                  <AdminRoute>
                    <NewRoleSearch />
                  </AdminRoute>
                }
              />
              <Route
                path="/talent-scout/new/scorecard"
                element={
                  <AdminRoute>
                    <NewRoleScorecard />
                  </AdminRoute>
                }
              />
              <Route
                path="/talent-scout/roles/:id"
                element={
                  <AdminRoute>
                    <RoleDashboard />
                  </AdminRoute>
                }
              />
              <Route
                path="/talent-scout/roles/:id/settings"
                element={
                  <AdminRoute>
                    <RoleSettings />
                  </AdminRoute>
                }
              />
              <Route
                path="/talent-scout/roles/:id/pulls/:pullRoundId"
                element={
                  <AdminRoute>
                    <PullDetail />
                  </AdminRoute>
                }
              />
              <Route
                path="/talent-scout/candidates/:id"
                element={
                  <AdminRoute>
                    <CandidateDetail />
                  </AdminRoute>
                }
              />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
