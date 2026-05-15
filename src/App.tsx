import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminRoute } from "@/components/AdminRoute";
import { StandardOrAdminRoute } from "@/components/StandardOrAdminRoute";
import AppShell from "@/components/AppShell";
import Home from "./pages/Home";
import PendingState from "./pages/PendingState";
import Projects from "./pages/Projects";
import ComingSoon from "./pages/ComingSoon";
import NotFound from "./pages/NotFound.tsx";
import TalentScoutIndex from "./pages/talent-scout/Index";
import TalentScoutSettings from "./pages/talent-scout/Settings";
import NewRoleDetails from "./pages/talent-scout/NewRoleDetails";
import NewRoleSearch from "./pages/talent-scout/NewRoleSearch";
import NewRoleScorecard from "./pages/talent-scout/NewRoleScorecard";
import RoleDashboard from "./pages/talent-scout/RoleDashboard";
import RoleSettings from "./pages/talent-scout/RoleSettings";
import PullDetail from "./pages/talent-scout/PullDetail";
import CandidateDetail from "./pages/talent-scout/CandidateDetail";
import FinalReviewLoading from "./pages/talent-scout/FinalReviewLoading";
import FinalReviewDetail from "./pages/talent-scout/FinalReviewDetail";
import ScoutIndex from "./pages/venue-scout/ScoutIndex";
import NewScout from "./pages/venue-scout/NewScout";
import BriefIndex from "./pages/venue-scout/BriefIndex";
import BriefEvent from "./pages/venue-scout/BriefEvent";
import BriefVenue from "./pages/venue-scout/BriefVenue";
import BriefReport from "./pages/venue-scout/BriefReport";
import SheetPrompt from "./pages/venue-scout/SheetPrompt";
import SheetUpload from "./pages/venue-scout/SheetUpload";
import Researching from "./pages/venue-scout/Researching";
import SourcingReport from "./pages/venue-scout/SourcingReport";
import Shortlist from "./pages/venue-scout/Shortlist";
import Review from "./pages/venue-scout/Review";
import Compiling from "./pages/venue-scout/Compiling";
import DeckPrep from "./pages/venue-scout/DeckPrep";
import Generating from "./pages/venue-scout/Generating";
import ErrorState from "./pages/venue-scout/ErrorState";
import ScoutSettings from "./pages/venue-scout/ScoutSettings";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Pending state: ProtectedRoute with the pending-redirect bypassed
                so the page renders rather than looping. No shell. */}
            <Route
              path="/pending"
              element={
                <ProtectedRoute bypassPending>
                  <PendingState />
                </ProtectedRoute>
              }
            />

            {/* Authed routes inside the new left-rail shell. */}
            <Route
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              {/* Authed `/` redirects to /home; unauthed `/` is intercepted
                  by ProtectedRoute and renders the stealth Landing. */}
              <Route path="/" element={<Navigate to="/home" replace />} />
              <Route
                path="/home"
                element={
                  <StandardOrAdminRoute>
                    <Home />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/projects"
                element={
                  <StandardOrAdminRoute>
                    <Projects />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/projects/:id"
                element={
                  <StandardOrAdminRoute>
                    <ComingSoon title="Project detail" />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/tasks"
                element={
                  <StandardOrAdminRoute>
                    <ComingSoon title="Tasks" />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/tasks/:id"
                element={
                  <StandardOrAdminRoute>
                    <ComingSoon title="Task detail" />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/deliverables"
                element={
                  <StandardOrAdminRoute>
                    <ComingSoon title="Deliverables" />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/calendar"
                element={
                  <StandardOrAdminRoute>
                    <ComingSoon title="Calendar" />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/venues"
                element={
                  <StandardOrAdminRoute>
                    <ComingSoon title="Venues" />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/venues/:id"
                element={
                  <StandardOrAdminRoute>
                    <ComingSoon title="Venue detail" />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/clients"
                element={
                  <StandardOrAdminRoute>
                    <ComingSoon title="Clients" />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/organizations"
                element={
                  <StandardOrAdminRoute>
                    <ComingSoon title="Organizations" />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/people"
                element={
                  <StandardOrAdminRoute>
                    <ComingSoon title="People" />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/activity"
                element={
                  <StandardOrAdminRoute>
                    <ComingSoon title="Activity Feed" />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/search"
                element={
                  <StandardOrAdminRoute>
                    <ComingSoon title="Search" />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/wiki"
                element={
                  <StandardOrAdminRoute>
                    <ComingSoon title="Wiki" />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/team"
                element={
                  <AdminRoute>
                    <ComingSoon title="Team" />
                  </AdminRoute>
                }
              />
              <Route
                path="/outlook"
                element={
                  <AdminRoute>
                    <ComingSoon title="Outlook" />
                  </AdminRoute>
                }
              />
              <Route
                path="/settings"
                element={
                  <AdminRoute>
                    <ComingSoon title="Settings" />
                  </AdminRoute>
                }
              />
              <Route
                path="/talent-scout"
                element={
                  <AdminRoute>
                    <TalentScoutIndex />
                  </AdminRoute>
                }
              />
              <Route
                path="/talent-scout/settings"
                element={
                  <AdminRoute>
                    <TalentScoutSettings />
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
              <Route
                path="/talent-scout/roles/:id/final-review"
                element={
                  <AdminRoute>
                    <FinalReviewDetail />
                  </AdminRoute>
                }
              />
              <Route
                path="/talent-scout/roles/:id/final-review/:reviewId"
                element={
                  <AdminRoute>
                    <FinalReviewDetail />
                  </AdminRoute>
                }
              />
              <Route
                path="/talent-scout/roles/:id/final-review/:reviewId/generating"
                element={
                  <AdminRoute>
                    <FinalReviewLoading />
                  </AdminRoute>
                }
              />
              <Route path="/venue-scout" element={<ScoutIndex />} />
              <Route path="/venue-scout/scouts/new" element={<NewScout />} />
              <Route
                path="/venue-scout/scouts/:id/brief"
                element={<BriefIndex />}
              />
              <Route
                path="/venue-scout/scouts/:id/brief/event"
                element={<BriefEvent />}
              />
              <Route
                path="/venue-scout/scouts/:id/brief/venue"
                element={<BriefVenue />}
              />
              <Route
                path="/venue-scout/scouts/:id/brief/report"
                element={<BriefReport />}
              />
              <Route
                path="/venue-scout/scouts/:id/settings"
                element={<ScoutSettings />}
              />
              <Route
                path="/venue-scout/scouts/:id/sourcing/sheet-prompt"
                element={<SheetPrompt />}
              />
              <Route
                path="/venue-scout/scouts/:id/sourcing/sheet-upload"
                element={<SheetUpload />}
              />
              <Route
                path="/venue-scout/scouts/:id/sourcing/researching"
                element={<Researching />}
              />
              <Route
                path="/venue-scout/scouts/:id/sourcing/report"
                element={<SourcingReport />}
              />
              <Route
                path="/venue-scout/scouts/:id/sourcing/shortlist"
                element={<Shortlist />}
              />
              <Route
                path="/venue-scout/scouts/:id/sourcing/review"
                element={<Review />}
              />
              <Route
                path="/venue-scout/scouts/:id/sourcing/compiling"
                element={<Compiling />}
              />
              <Route
                path="/venue-scout/scouts/:id/deck/prep"
                element={<DeckPrep />}
              />
              <Route
                path="/venue-scout/scouts/:id/deck/generating"
                element={<Generating />}
              />
              <Route
                path="/venue-scout/scouts/:id/deck/error/:errorKey"
                element={<ErrorState />}
              />
              <Route
                path="/venue-scout/scouts/:id/sourcing/error/:errorKey"
                element={<ErrorState />}
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