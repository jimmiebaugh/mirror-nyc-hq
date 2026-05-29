import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminRoute } from "@/components/AdminRoute";
import AppShell from "@/components/AppShell";

// Route components are lazy-loaded so each surface ships in its own chunk and
// the initial bundle no longer eagerly pulls in every page (Talent Scout,
// Venue Scout, bulk-import, etc.). The <Suspense> boundary below renders a
// lightweight fallback while a route chunk loads. The shell + route guards
// above stay eager since they wrap every authed route.
const Home = lazy(() => import("./pages/Home"));
const PendingState = lazy(() => import("./pages/PendingState"));
const ProjectsList = lazy(() => import("./pages/projects/ProjectsList"));
const ProjectDetail = lazy(() => import("./pages/projects/ProjectDetail"));
const ProjectEdit = lazy(() => import("./pages/projects/ProjectEdit"));
const TasksList = lazy(() => import("./pages/tasks/TasksList"));
const TaskDetail = lazy(() => import("./pages/tasks/TaskDetail"));
const TaskEdit = lazy(() => import("./pages/tasks/TaskEdit"));
const DeliverablesList = lazy(() => import("./pages/deliverables/DeliverablesList"));
const DeliverableDetail = lazy(() => import("./pages/deliverables/DeliverableDetail"));
const DeliverableEdit = lazy(() => import("./pages/deliverables/DeliverableEdit"));
const ClientsList = lazy(() => import("./pages/clients/ClientsList"));
const ClientDetail = lazy(() => import("./pages/clients/ClientDetail"));
const ClientEdit = lazy(() => import("./pages/clients/ClientEdit"));
const VendorsList = lazy(() => import("./pages/vendors/VendorsList"));
const VendorDetail = lazy(() => import("./pages/vendors/VendorDetail"));
const VendorEdit = lazy(() => import("./pages/vendors/VendorEdit"));
const OrganizationsRedirect = lazy(() => import("./pages/clients/OrganizationsRedirect"));
const PeopleList = lazy(() => import("./pages/people/PeopleList"));
const PersonDetail = lazy(() => import("./pages/people/PersonDetail"));
const PersonEdit = lazy(() => import("./pages/people/PersonEdit"));
const VenuesList = lazy(() => import("./pages/venues/VenuesList"));
const VenueDetail = lazy(() => import("./pages/venues/VenueDetail"));
const VenueEdit = lazy(() => import("./pages/venues/VenueEdit"));
const CalendarPage = lazy(() => import("./pages/calendar/CalendarPage"));
const OutlookPage = lazy(() => import("./pages/outlook/OutlookPage"));
const WikiPage = lazy(() => import("./pages/wiki/WikiPage"));
const WikiPageEdit = lazy(() => import("./pages/wiki/WikiPageEdit"));
const TeamList = lazy(() => import("./pages/team/TeamList"));
const TeamMemberEdit = lazy(() => import("./pages/team/TeamMemberEdit"));
const UserProfile = lazy(() => import("./pages/users/UserProfile"));
const ProfileSettings = lazy(() => import("./pages/users/ProfileSettings"));
const SettingsPage = lazy(() => import("./pages/settings/SettingsPage"));
const BulkImportEntityPage = lazy(() => import("./pages/bulk-import/BulkImportEntityPage"));
const BulkImportHistoryPage = lazy(() => import("./pages/bulk-import/BulkImportHistoryPage"));
const ActivityFeed = lazy(() => import("./pages/activity/ActivityFeed"));
const SearchPage = lazy(() => import("./pages/search/SearchPage"));
const NotificationPreferences = lazy(() => import("./pages/notifications/NotificationPreferences"));
const NotFound = lazy(() => import("./pages/NotFound"));
const TalentScoutIndex = lazy(() => import("./pages/talent-scout/Index"));
const TalentScoutSettings = lazy(() => import("./pages/talent-scout/Settings"));
const NewRoleDetails = lazy(() => import("./pages/talent-scout/NewRoleDetails"));
const NewRoleSearch = lazy(() => import("./pages/talent-scout/NewRoleSearch"));
const NewRoleScorecard = lazy(() => import("./pages/talent-scout/NewRoleScorecard"));
const RoleDashboard = lazy(() => import("./pages/talent-scout/RoleDashboard"));
const RoleSettings = lazy(() => import("./pages/talent-scout/RoleSettings"));
const PullDetail = lazy(() => import("./pages/talent-scout/PullDetail"));
const CandidateDetail = lazy(() => import("./pages/talent-scout/CandidateDetail"));
const FinalReviewLoading = lazy(() => import("./pages/talent-scout/FinalReviewLoading"));
const FinalReviewDetail = lazy(() => import("./pages/talent-scout/FinalReviewDetail"));
const ScoutIndex = lazy(() => import("./pages/venue-scout/ScoutIndex"));
const Overview = lazy(() => import("./pages/venue-scout/Overview"));
const BriefIndex = lazy(() => import("./pages/venue-scout/BriefIndex"));
const BriefEvent = lazy(() => import("./pages/venue-scout/BriefEvent"));
const BriefVenue = lazy(() => import("./pages/venue-scout/BriefVenue"));
const BriefReport = lazy(() => import("./pages/venue-scout/BriefReport"));
const SheetPrompt = lazy(() => import("./pages/venue-scout/SheetPrompt"));
const Researching = lazy(() => import("./pages/venue-scout/Researching"));
const SourcingReport = lazy(() => import("./pages/venue-scout/SourcingReport"));
const Shortlist = lazy(() => import("./pages/venue-scout/Shortlist"));
const Compiling = lazy(() => import("./pages/venue-scout/Compiling"));
const Review = lazy(() => import("./pages/venue-scout/Review"));
const Generating = lazy(() => import("./pages/venue-scout/Generating"));
const ErrorState = lazy(() => import("./pages/venue-scout/ErrorState"));
const ScoutSettings = lazy(() => import("./pages/venue-scout/ScoutSettings"));
const ScoutGlobalSettings = lazy(() => import("./pages/venue-scout/ScoutGlobalSettings"));

const queryClient = new QueryClient();

// Phase 5.4 feedback: /team/:id/edit -> /users/:id/edit redirect carrier.
function TeamRedirectEdit() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/users/${id}/edit`} replace />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <BrowserRouter>
        <AuthProvider>
          <Suspense
            fallback={
              <div className="flex min-h-screen items-center justify-center bg-black">
                <div className="text-muted-foreground text-sm">Loading…</div>
              </div>
            }
          >
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
                element={<Home />}
              />
              <Route
                path="/projects"
                element={<ProjectsList view="list" />}
              />
              <Route
                path="/projects/board"
                element={<ProjectsList view="board" />}
              />
              <Route
                path="/projects/timeline"
                element={<ProjectsList view="timeline" />}
              />
              <Route
                path="/projects/new"
                element={<ProjectEdit />}
              />
              <Route
                path="/projects/:id"
                element={<ProjectDetail />}
              />
              <Route
                path="/projects/:id/edit"
                element={<ProjectEdit />}
              />
              <Route
                path="/tasks"
                element={<TasksList view="list" />}
              />
              <Route
                path="/tasks/board"
                element={<TasksList view="board" />}
              />
              <Route
                path="/tasks/new"
                element={<TaskEdit />}
              />
              <Route
                path="/tasks/:id"
                element={<TaskDetail />}
              />
              <Route
                path="/tasks/:id/edit"
                element={<TaskEdit />}
              />
              <Route
                path="/deliverables"
                element={<DeliverablesList view="board" />}
              />
              <Route
                path="/deliverables/list"
                element={<DeliverablesList view="list" />}
              />
              <Route
                path="/deliverables/board"
                element={<DeliverablesList view="board" />}
              />
              <Route
                path="/deliverables/calendar"
                element={<DeliverablesList view="calendar" />}
              />
              <Route
                path="/deliverables/new"
                element={<DeliverableEdit />}
              />
              <Route
                path="/deliverables/:id"
                element={<DeliverableDetail />}
              />
              <Route
                path="/deliverables/:id/edit"
                element={<DeliverableEdit />}
              />
              <Route
                path="/calendar"
                element={<CalendarPage />}
              />
              <Route
                path="/venues"
                element={<VenuesList />}
              />
              <Route
                path="/venues/new"
                element={<VenueEdit />}
              />
              <Route
                path="/venues/:id"
                element={<VenueDetail />}
              />
              <Route
                path="/venues/:id/edit"
                element={<VenueEdit />}
              />
              <Route
                path="/clients"
                element={<ClientsList />}
              />
              <Route
                path="/clients/new"
                element={<ClientEdit />}
              />
              <Route
                path="/clients/:id"
                element={<ClientDetail />}
              />
              <Route
                path="/clients/:id/edit"
                element={<ClientEdit />}
              />
              <Route
                path="/vendors"
                element={<VendorsList />}
              />
              <Route
                path="/vendors/new"
                element={<VendorEdit />}
              />
              <Route
                path="/vendors/:id"
                element={<VendorDetail />}
              />
              <Route
                path="/vendors/:id/edit"
                element={<VendorEdit />}
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
                element={<OrganizationsRedirect />}
              />
              <Route
                path="/organizations/:id/edit"
                element={<OrganizationsRedirect editMode />}
              />
              <Route
                path="/people"
                element={<PeopleList />}
              />
              <Route
                path="/people/new"
                element={<PersonEdit />}
              />
              <Route
                path="/people/:id"
                element={<PersonDetail />}
              />
              <Route
                path="/people/:id/edit"
                element={<PersonEdit />}
              />
              <Route
                path="/activity"
                element={<ActivityFeed />}
              />
              <Route
                path="/search"
                element={<SearchPage />}
              />
              {/* Phase 5.5 notification preferences. Auth handled by the
                  outer <ProtectedRoute><AppShell /></ProtectedRoute> group
                  on line 101; no tier gate so all tiers (including
                  Freelance) can manage their preferences. Same shape as
                  /wiki below. */}
              <Route
                path="/notifications/preferences"
                element={<NotificationPreferences />}
              />
              {/* Wiki: all tiers including Freelance. Account Logins page
                  is the only sub-page that excludes Freelance (enforced at
                  component level + RLS on credentials). */}
              <Route path="/wiki" element={<WikiPage />} />
              <Route
                path="/wiki/new"
                element={
                  <AdminRoute>
                    <WikiPageEdit />
                  </AdminRoute>
                }
              />
              <Route
                path="/wiki/:slug/edit"
                element={
                  <AdminRoute>
                    <WikiPageEdit />
                  </AdminRoute>
                }
              />
              <Route path="/wiki/:slug" element={<WikiPage />} />
              <Route
                path="/users"
                element={
                  <AdminRoute>
                    <TeamList />
                  </AdminRoute>
                }
              />
              <Route
                path="/users/new"
                element={
                  <AdminRoute>
                    <TeamMemberEdit />
                  </AdminRoute>
                }
              />
              <Route
                path="/users/:id/edit"
                element={
                  <AdminRoute>
                    <TeamMemberEdit />
                  </AdminRoute>
                }
              />
              {/* Phase 5.7.12: read-only Profile route. All tiers can view.
                  Placed AFTER /users/new + /users/:id/edit so the more
                  specific routes still win during React Router resolution. */}
              <Route path="/users/:id" element={<UserProfile />} />
              {/* Phase 5.7.12: self-only Profile Settings. Non-admin path to
                  edit own role_title / department / Slack fields. Tier
                  columns + name + email stay admin-only (gated by the
                  extended users_protect_admin_columns trigger). */}
              <Route path="/settings/profile" element={<ProfileSettings />} />
              {/* Phase 5.9.1: bulk-import primitive. AdminRoute gates the
                  per-entity surface; the edge function re-checks admin
                  server-side. The history audit page (5.9.5) MUST be
                  declared before the :entity dynamic route, or Router
                  resolves "history" as :entity and lands on the Unknown
                  importer empty state. */}
              <Route
                path="/settings/bulk-import/history"
                element={
                  <AdminRoute>
                    <BulkImportHistoryPage />
                  </AdminRoute>
                }
              />
              <Route
                path="/settings/bulk-import/:entity"
                element={
                  <AdminRoute>
                    <BulkImportEntityPage />
                  </AdminRoute>
                }
              />
              {/* Phase 5.4 feedback round: /team renamed to /users. Keep
                  redirects so old bookmarks + pre-feedback notifications
                  (link_url = '/team') still land on the right surface. */}
              <Route path="/team" element={<Navigate to="/users" replace />} />
              <Route path="/team/new" element={<Navigate to="/users/new" replace />} />
              <Route path="/team/:id/edit" element={<TeamRedirectEdit />} />
              <Route
                path="/outlook"
                element={
                  <AdminRoute>
                    <OutlookPage />
                  </AdminRoute>
                }
              />
              <Route
                path="/settings"
                element={
                  <AdminRoute>
                    <SettingsPage />
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
              <Route
                path="/venue-scout/settings"
                element={
                  <AdminRoute>
                    <ScoutGlobalSettings />
                  </AdminRoute>
                }
              />
              <Route path="/venue-scout" element={<ScoutIndex />} />
              <Route path="/venue-scout/overview" element={<Overview />} />
              {/* R7 § D: /venue-scout/scouts/new route retired. NewScout is
                  now a modal (`NewScoutModal`) opened from ScoutIndex +
                  Overview. Direct nav to the old path falls through to the
                  global 404. */}
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
                path="/venue-scout/scouts/:id/sourcing/compiling"
                element={<Compiling />}
              />
              <Route
                path="/venue-scout/scouts/:id/review"
                element={<Review />}
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
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;