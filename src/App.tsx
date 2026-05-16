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
import ProjectsList from "./pages/projects/ProjectsList";
import ProjectDetail from "./pages/projects/ProjectDetail";
import ProjectEdit from "./pages/projects/ProjectEdit";
import TasksList from "./pages/tasks/TasksList";
import TaskDetail from "./pages/tasks/TaskDetail";
import TaskEdit from "./pages/tasks/TaskEdit";
import DeliverablesList from "./pages/deliverables/DeliverablesList";
import DeliverableDetail from "./pages/deliverables/DeliverableDetail";
import DeliverableEdit from "./pages/deliverables/DeliverableEdit";
import ClientsList from "./pages/clients/ClientsList";
import ClientDetail from "./pages/clients/ClientDetail";
import ClientEdit from "./pages/clients/ClientEdit";
import VendorsList from "./pages/vendors/VendorsList";
import VendorDetail from "./pages/vendors/VendorDetail";
import VendorEdit from "./pages/vendors/VendorEdit";
import OrganizationsRedirect from "./pages/clients/OrganizationsRedirect";
import PeopleList from "./pages/people/PeopleList";
import PersonDetail from "./pages/people/PersonDetail";
import PersonEdit from "./pages/people/PersonEdit";
import VenuesList from "./pages/venues/VenuesList";
import VenueDetail from "./pages/venues/VenueDetail";
import VenueEdit from "./pages/venues/VenueEdit";
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
                    <ProjectsList view="list" />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/projects/board"
                element={
                  <StandardOrAdminRoute>
                    <ProjectsList view="board" />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/projects/timeline"
                element={
                  <StandardOrAdminRoute>
                    <ProjectsList view="timeline" />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/projects/new"
                element={
                  <StandardOrAdminRoute>
                    <ProjectEdit />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/projects/:id"
                element={
                  <StandardOrAdminRoute>
                    <ProjectDetail />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/projects/:id/edit"
                element={
                  <StandardOrAdminRoute>
                    <ProjectEdit />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/tasks"
                element={
                  <StandardOrAdminRoute>
                    <TasksList view="list" />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/tasks/board"
                element={
                  <StandardOrAdminRoute>
                    <TasksList view="board" />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/tasks/new"
                element={
                  <StandardOrAdminRoute>
                    <TaskEdit />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/tasks/:id"
                element={
                  <StandardOrAdminRoute>
                    <TaskDetail />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/tasks/:id/edit"
                element={
                  <StandardOrAdminRoute>
                    <TaskEdit />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/deliverables"
                element={
                  <StandardOrAdminRoute>
                    <DeliverablesList view="calendar" />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/deliverables/list"
                element={
                  <StandardOrAdminRoute>
                    <DeliverablesList view="list" />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/deliverables/board"
                element={
                  <StandardOrAdminRoute>
                    <DeliverablesList view="board" />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/deliverables/new"
                element={
                  <StandardOrAdminRoute>
                    <DeliverableEdit />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/deliverables/:id"
                element={
                  <StandardOrAdminRoute>
                    <DeliverableDetail />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/deliverables/:id/edit"
                element={
                  <StandardOrAdminRoute>
                    <DeliverableEdit />
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
                    <VenuesList />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/venues/new"
                element={
                  <StandardOrAdminRoute>
                    <VenueEdit />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/venues/:id"
                element={
                  <StandardOrAdminRoute>
                    <VenueDetail />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/venues/:id/edit"
                element={
                  <StandardOrAdminRoute>
                    <VenueEdit />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/clients"
                element={
                  <StandardOrAdminRoute>
                    <ClientsList />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/clients/new"
                element={
                  <StandardOrAdminRoute>
                    <ClientEdit />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/clients/:id"
                element={
                  <StandardOrAdminRoute>
                    <ClientDetail />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/clients/:id/edit"
                element={
                  <StandardOrAdminRoute>
                    <ClientEdit />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/vendors"
                element={
                  <StandardOrAdminRoute>
                    <VendorsList />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/vendors/new"
                element={
                  <StandardOrAdminRoute>
                    <VendorEdit />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/vendors/:id"
                element={
                  <StandardOrAdminRoute>
                    <VendorDetail />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/vendors/:id/edit"
                element={
                  <StandardOrAdminRoute>
                    <VendorEdit />
                  </StandardOrAdminRoute>
                }
              />
              {/* Backward-compat redirects for the shipped /organizations URLs.
                  Old bookmarks resolve to the right post-split surface based on
                  which table the id is in. Drop this pair in a future polish
                  pass once Mirror's bookmarks update. */}
              <Route
                path="/organizations"
                element={<Navigate to="/vendors" replace />}
              />
              <Route
                path="/organizations/new"
                element={<Navigate to="/vendors/new" replace />}
              />
              <Route
                path="/organizations/:id"
                element={
                  <StandardOrAdminRoute>
                    <OrganizationsRedirect />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/organizations/:id/edit"
                element={
                  <StandardOrAdminRoute>
                    <OrganizationsRedirect editMode />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/people"
                element={
                  <StandardOrAdminRoute>
                    <PeopleList />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/people/new"
                element={
                  <StandardOrAdminRoute>
                    <PersonEdit />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/people/:id"
                element={
                  <StandardOrAdminRoute>
                    <PersonDetail />
                  </StandardOrAdminRoute>
                }
              />
              <Route
                path="/people/:id/edit"
                element={
                  <StandardOrAdminRoute>
                    <PersonEdit />
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