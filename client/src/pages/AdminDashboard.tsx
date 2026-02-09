import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
  LayoutDashboard, Users, Car, MapPin, AlertTriangle,
  DollarSign, Award, TrendingUp, Shield, Activity,
  CheckCircle, XCircle, Eye, Ban, UserCheck, Clock,
  ChevronLeft, BarChart3, Brain, AlertCircle, BookOpen,
  RefreshCw, Loader2, ThumbsUp, ThumbsDown, Zap, Trash2
} from "lucide-react";
import { useLocation } from "wouter";

type AdminTab = "dashboard" | "users" | "drivers" | "rides" | "disputes" | "finances" | "ownership" | "profits" | "activity" | "analytics";

export default function AdminDashboard() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>("dashboard");
  const [, setLocation] = useLocation();

  if (!user?.isAdmin && !user?.isSuperAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen" data-testid="admin-access-denied">
        <Card className="w-96">
          <CardContent className="pt-6 text-center">
            <Shield className="w-16 h-16 mx-auto mb-4 text-red-500" />
            <h2 className="text-xl font-bold mb-2">Access Denied</h2>
            <p className="text-muted-foreground">You need admin privileges to access this page.</p>
            <Button className="mt-4" onClick={() => setLocation("/")} data-testid="btn-back-home">Go Home</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const tabs: { id: AdminTab; label: string; icon: any }[] = [
    { id: "dashboard", label: "Overview", icon: LayoutDashboard },
    { id: "users", label: "Users", icon: Users },
    { id: "drivers", label: "Drivers", icon: Car },
    { id: "rides", label: "Rides", icon: MapPin },
    { id: "disputes", label: "Disputes", icon: AlertTriangle },
    { id: "finances", label: "Finances", icon: DollarSign },
    { id: "ownership", label: "Ownership", icon: Award },
    { id: "profits", label: "Profits", icon: TrendingUp },
    { id: "activity", label: "Activity Log", icon: Activity },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
  ];

  return (
    <div className="min-h-screen bg-gray-50" data-testid="admin-dashboard">
      <div className="flex">
        <aside className="w-64 bg-white border-r min-h-screen p-4 hidden md:block" data-testid="admin-sidebar">
          <div className="flex items-center gap-2 mb-6">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/")} data-testid="btn-admin-back">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <h1 className="text-lg font-bold">PG Ride Admin</h1>
          </div>
          <nav className="space-y-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  activeTab === tab.id ? "bg-primary text-primary-foreground" : "hover:bg-gray-100 text-gray-700"
                }`}
                data-testid={`nav-${tab.id}`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </nav>
        </aside>

        <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-white border-b p-2 overflow-x-auto">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/")} data-testid="btn-admin-back-mobile">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`whitespace-nowrap px-3 py-1.5 rounded text-xs font-medium ${
                  activeTab === tab.id ? "bg-primary text-primary-foreground" : "text-gray-600"
                }`}
                data-testid={`nav-mobile-${tab.id}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <main className="flex-1 p-6 md:p-8 mt-12 md:mt-0 max-w-6xl">
          {activeTab === "dashboard" && <DashboardOverview />}
          {activeTab === "users" && <UsersPanel />}
          {activeTab === "drivers" && <DriversPanel />}
          {activeTab === "rides" && <RidesPanel />}
          {activeTab === "disputes" && <DisputesPanel />}
          {activeTab === "finances" && <FinancesPanel />}
          {activeTab === "ownership" && <OwnershipPanel />}
          {activeTab === "profits" && <ProfitsPanel />}
          {activeTab === "activity" && <ActivityPanel />}
          {activeTab === "analytics" && <AnalyticsPanel />}
        </main>
      </div>
    </div>
  );
}

function DashboardOverview() {
  const { data: stats, isLoading } = useQuery<{
    totalUsers: number; totalDrivers: number; onlineDrivers: number;
    activeRides: number; completedRidesToday: number; revenueToday: number;
    revenueThisMonth: number; pendingDisputes: number; totalOwners: number;
  }>({ queryKey: ["/api/admin/dashboard"] });

  if (isLoading) return <div className="text-center py-12" data-testid="loading-dashboard">Loading dashboard...</div>;

  const cards = [
    { label: "Total Users", value: stats?.totalUsers || 0, icon: Users, color: "text-blue-600" },
    { label: "Total Drivers", value: stats?.totalDrivers || 0, icon: Car, color: "text-green-600" },
    { label: "Online Drivers", value: stats?.onlineDrivers || 0, icon: Activity, color: "text-emerald-600" },
    { label: "Active Rides", value: stats?.activeRides || 0, icon: MapPin, color: "text-orange-600" },
    { label: "Rides Today", value: stats?.completedRidesToday || 0, icon: CheckCircle, color: "text-purple-600" },
    { label: "Revenue Today", value: `$${(stats?.revenueToday || 0).toFixed(2)}`, icon: DollarSign, color: "text-green-700" },
    { label: "Revenue This Month", value: `$${(stats?.revenueThisMonth || 0).toFixed(2)}`, icon: TrendingUp, color: "text-blue-700" },
    { label: "Pending Disputes", value: stats?.pendingDisputes || 0, icon: AlertTriangle, color: "text-red-600" },
    { label: "Driver Owners", value: stats?.totalOwners || 0, icon: Award, color: "text-yellow-600" },
  ];

  return (
    <div data-testid="panel-dashboard">
      <h2 className="text-2xl font-bold mb-6">Dashboard Overview</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((card) => (
          <Card key={card.label} data-testid={`stat-${card.label.toLowerCase().replace(/\s+/g, '-')}`}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{card.label}</p>
                  <p className="text-2xl font-bold mt-1">{card.value}</p>
                </div>
                <card.icon className={`w-8 h-8 ${card.color}`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function UsersPanel() {
  const { user: currentUser } = useAuth();
  const { data: users = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/admin/users"] });
  const { toast } = useToast();
  const [showCreateAdmin, setShowCreateAdmin] = useState(false);
  const [newAdmin, setNewAdmin] = useState({ email: '', password: '', firstName: '', lastName: '' });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const isSuperAdmin = currentUser?.isSuperAdmin && currentUser?.email === 'thrynovainsights@gmail.com';

  const updateUser = useMutation({
    mutationFn: async ({ userId, updates }: { userId: string; updates: any }) => {
      await apiRequest("PATCH", `/api/admin/users/${userId}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard"] });
      toast({ title: "User updated" });
    },
  });

  const approveUser = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest("POST", `/api/admin/users/${userId}/approve`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User approved" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const revokeApproval = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest("POST", `/api/admin/users/${userId}/revoke-approval`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User approval revoked" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const makeAdmin = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest("POST", `/api/admin/users/${userId}/make-admin`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User promoted to admin" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const removeAdmin = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest("POST", `/api/admin/users/${userId}/remove-admin`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Admin demoted" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteUser = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest("DELETE", `/api/admin/users/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard"] });
      setDeleteConfirm(null);
      toast({ title: "User deleted" });
    },
    onError: (err: any) => {
      setDeleteConfirm(null);
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const createAdmin = useMutation({
    mutationFn: async (data: typeof newAdmin) => {
      await apiRequest("POST", "/api/admin/create-admin", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setShowCreateAdmin(false);
      setNewAdmin({ email: '', password: '', firstName: '', lastName: '' });
      toast({ title: "Admin account created" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  if (isLoading) return <div data-testid="loading-users">Loading users...</div>;

  const filteredUsers = users.filter((u: any) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (u.firstName?.toLowerCase().includes(term) || u.lastName?.toLowerCase().includes(term) || u.email?.toLowerCase().includes(term));
  });

  const pendingApproval = filteredUsers.filter((u: any) => !u.isApproved && !u.isSuperAdmin);
  const approvedUsers = filteredUsers.filter((u: any) => u.isApproved || u.isSuperAdmin);

  return (
    <div data-testid="panel-users">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h2 className="text-2xl font-bold">User Management</h2>
        <div className="flex gap-2">
          {isSuperAdmin && (
            <Dialog open={showCreateAdmin} onOpenChange={setShowCreateAdmin}>
              <DialogTrigger asChild>
                <Button data-testid="btn-create-admin"><UserCheck className="w-4 h-4 mr-2" /> Create Admin</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Admin Account</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 mt-2">
                  <Input placeholder="First Name" value={newAdmin.firstName} onChange={e => setNewAdmin({...newAdmin, firstName: e.target.value})} data-testid="input-admin-firstname" />
                  <Input placeholder="Last Name" value={newAdmin.lastName} onChange={e => setNewAdmin({...newAdmin, lastName: e.target.value})} data-testid="input-admin-lastname" />
                  <Input placeholder="Email" type="email" value={newAdmin.email} onChange={e => setNewAdmin({...newAdmin, email: e.target.value})} data-testid="input-admin-email" />
                  <Input placeholder="Password (min 8 chars)" type="password" value={newAdmin.password} onChange={e => setNewAdmin({...newAdmin, password: e.target.value})} data-testid="input-admin-password" />
                  <Button className="w-full" onClick={() => createAdmin.mutate(newAdmin)} disabled={createAdmin.isPending} data-testid="btn-submit-create-admin">
                    {createAdmin.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Create Admin
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <Input placeholder="Search users by name or email..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="mb-4" data-testid="input-search-users" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Card className="border-orange-200 bg-orange-50 dark:bg-orange-950/20">
          <CardContent className="pt-4 pb-3 text-center">
            <Clock className="w-6 h-6 mx-auto mb-1 text-orange-500" />
            <p className="text-2xl font-bold text-orange-600" data-testid="count-pending">{users.filter((u: any) => !u.isApproved && !u.isSuperAdmin).length}</p>
            <p className="text-xs text-muted-foreground">Pending</p>
          </CardContent>
        </Card>
        <Card className="border-green-200 bg-green-50 dark:bg-green-950/20">
          <CardContent className="pt-4 pb-3 text-center">
            <CheckCircle className="w-6 h-6 mx-auto mb-1 text-green-500" />
            <p className="text-2xl font-bold text-green-600" data-testid="count-approved">{users.filter((u: any) => (u.isApproved || u.isSuperAdmin) && !u.isSuspended).length}</p>
            <p className="text-xs text-muted-foreground">Active</p>
          </CardContent>
        </Card>
        <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20">
          <CardContent className="pt-4 pb-3 text-center">
            <Car className="w-6 h-6 mx-auto mb-1 text-blue-500" />
            <p className="text-2xl font-bold text-blue-600" data-testid="count-drivers">{users.filter((u: any) => u.isDriver).length}</p>
            <p className="text-xs text-muted-foreground">Drivers</p>
          </CardContent>
        </Card>
        <Card className="border-red-200 bg-red-50 dark:bg-red-950/20">
          <CardContent className="pt-4 pb-3 text-center">
            <Ban className="w-6 h-6 mx-auto mb-1 text-red-500" />
            <p className="text-2xl font-bold text-red-600" data-testid="count-suspended">{users.filter((u: any) => u.isSuspended).length}</p>
            <p className="text-xs text-muted-foreground">Suspended</p>
          </CardContent>
        </Card>
      </div>

      {pendingApproval.length > 0 && (
        <>
          <h3 className="text-lg font-semibold mb-3 text-orange-600 flex items-center gap-2"><Clock className="w-5 h-5" /> Pending Approval ({pendingApproval.length})</h3>
          <div className="space-y-3 mb-6">
            {pendingApproval.map((u: any) => (
              <Card key={u.id} className="border-l-4 border-l-orange-400 border-orange-200" data-testid={`user-card-${u.id}`}>
                <CardContent className="pt-4 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-3 flex-1 min-w-[200px]">
                    <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center shrink-0">
                      <span className="text-orange-600 font-bold text-sm">{u.firstName?.[0]}{u.lastName?.[0]}</span>
                    </div>
                    <div>
                      <p className="font-semibold" data-testid={`user-name-${u.id}`}>{u.firstName} {u.lastName}</p>
                      <p className="text-sm text-muted-foreground">{u.email}</p>
                      {u.phone && <p className="text-xs text-muted-foreground">{u.phone}</p>}
                      <div className="flex gap-1 mt-1">
                        <Badge className="bg-orange-500 text-white text-xs" data-testid={`status-pending-${u.id}`}>
                          <Clock className="w-3 h-3 mr-1" /> Pending
                        </Badge>
                        {u.isDriver ? (
                          <Badge className="bg-blue-500 text-white text-xs" data-testid={`role-driver-${u.id}`}>
                            <Car className="w-3 h-3 mr-1" /> Driver
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs" data-testid={`role-rider-${u.id}`}>
                            <MapPin className="w-3 h-3 mr-1" /> Rider
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => approveUser.mutate(u.id)} data-testid={`btn-approve-user-${u.id}`}>
                      <CheckCircle className="w-3 h-3 mr-1" /> Approve
                    </Button>
                    {deleteConfirm === u.id ? (
                      <div className="flex gap-1">
                        <Button size="sm" variant="destructive" onClick={() => deleteUser.mutate(u.id)} data-testid={`btn-confirm-delete-${u.id}`}>Confirm</Button>
                        <Button size="sm" variant="outline" onClick={() => setDeleteConfirm(null)} data-testid={`btn-cancel-delete-${u.id}`}>Cancel</Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="destructive" onClick={() => setDeleteConfirm(u.id)} data-testid={`btn-delete-user-${u.id}`}>
                        <XCircle className="w-3 h-3 mr-1" /> Reject
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      <h3 className="text-lg font-semibold mb-3 flex items-center gap-2"><CheckCircle className="w-5 h-5 text-green-600" /> Active Users ({approvedUsers.length})</h3>
      <div className="space-y-3">
        {approvedUsers.map((u: any) => (
          <Card key={u.id} className={`border-l-4 ${u.isSuspended ? 'border-l-red-400' : u.isSuperAdmin ? 'border-l-purple-400' : u.isAdmin ? 'border-l-indigo-400' : u.isDriver ? 'border-l-blue-400' : 'border-l-green-400'}`} data-testid={`user-card-${u.id}`}>
            <CardContent className="pt-4 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3 flex-1 min-w-[200px]">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${u.isSuspended ? 'bg-red-100 dark:bg-red-900/30' : u.isSuperAdmin ? 'bg-purple-100 dark:bg-purple-900/30' : u.isAdmin ? 'bg-indigo-100 dark:bg-indigo-900/30' : u.isDriver ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-green-100 dark:bg-green-900/30'}`}>
                  <span className={`font-bold text-sm ${u.isSuspended ? 'text-red-600' : u.isSuperAdmin ? 'text-purple-600' : u.isAdmin ? 'text-indigo-600' : u.isDriver ? 'text-blue-600' : 'text-green-600'}`}>{u.firstName?.[0]}{u.lastName?.[0]}</span>
                </div>
                <div>
                  <p className="font-semibold" data-testid={`user-name-${u.id}`}>{u.firstName} {u.lastName}</p>
                  <p className="text-sm text-muted-foreground">{u.email}</p>
                  {u.phone && <p className="text-xs text-muted-foreground">{u.phone}</p>}
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {u.isSuperAdmin && (
                      <Badge className="bg-purple-600 text-white text-xs" data-testid={`role-superadmin-${u.id}`}>
                        <Shield className="w-3 h-3 mr-1" /> Super Admin
                      </Badge>
                    )}
                    {u.isAdmin && !u.isSuperAdmin && (
                      <Badge className="bg-indigo-600 text-white text-xs" data-testid={`role-admin-${u.id}`}>
                        <Shield className="w-3 h-3 mr-1" /> Admin
                      </Badge>
                    )}
                    {u.isDriver ? (
                      <Badge className="bg-blue-500 text-white text-xs" data-testid={`role-driver-${u.id}`}>
                        <Car className="w-3 h-3 mr-1" /> Driver
                      </Badge>
                    ) : !u.isAdmin && !u.isSuperAdmin ? (
                      <Badge variant="outline" className="text-xs" data-testid={`role-rider-${u.id}`}>
                        <MapPin className="w-3 h-3 mr-1" /> Rider
                      </Badge>
                    ) : null}
                    {u.isSuspended && (
                      <Badge variant="destructive" className="text-xs" data-testid={`status-suspended-${u.id}`}>
                        <Ban className="w-3 h-3 mr-1" /> Suspended
                      </Badge>
                    )}
                    {u.isApproved && !u.isSuspended && (
                      <Badge className="bg-green-500 text-white text-xs" data-testid={`status-active-${u.id}`}>
                        <CheckCircle className="w-3 h-3 mr-1" /> Active
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                {!u.isSuperAdmin && (
                  <>
                    {isSuperAdmin && (
                      <Button size="sm" variant={u.isAdmin ? "destructive" : "outline"}
                        onClick={() => u.isAdmin ? removeAdmin.mutate(u.id) : makeAdmin.mutate(u.id)}
                        data-testid={`btn-toggle-admin-${u.id}`}
                      >
                        {u.isAdmin ? "Remove Admin" : "Make Admin"}
                      </Button>
                    )}
                    {u.isApproved && (
                      <Button size="sm" variant="outline"
                        onClick={() => revokeApproval.mutate(u.id)}
                        data-testid={`btn-revoke-approval-${u.id}`}
                      >
                        Revoke Approval
                      </Button>
                    )}
                    <Button size="sm" variant={u.isSuspended ? "default" : "destructive"}
                      onClick={() => updateUser.mutate({ userId: u.id, updates: { isSuspended: !u.isSuspended } })}
                      data-testid={`btn-toggle-suspend-${u.id}`}
                    >
                      {u.isSuspended ? "Unsuspend" : "Suspend"}
                    </Button>
                    {deleteConfirm === u.id ? (
                      <div className="flex gap-1">
                        <Button size="sm" variant="destructive" onClick={() => deleteUser.mutate(u.id)} data-testid={`btn-confirm-delete-${u.id}`}>Confirm Delete</Button>
                        <Button size="sm" variant="outline" onClick={() => setDeleteConfirm(null)} data-testid={`btn-cancel-delete-${u.id}`}>Cancel</Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="destructive" onClick={() => setDeleteConfirm(u.id)} data-testid={`btn-delete-user-${u.id}`}>
                        <XCircle className="w-3 h-3 mr-1" /> Delete
                      </Button>
                    )}
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {approvedUsers.length === 0 && <p className="text-muted-foreground text-center py-8">No approved users found.</p>}
      </div>
    </div>
  );
}

function DriversPanel() {
  const { data: drivers = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/admin/drivers"] });
  const { toast } = useToast();
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const updateDriver = useMutation({
    mutationFn: async ({ userId, updates }: { userId: string; updates: any }) => {
      await apiRequest("PATCH", `/api/admin/drivers/${userId}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/drivers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Driver updated" });
    },
  });

  const deleteDriverProfile = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest("DELETE", `/api/admin/drivers/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/drivers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setDeleteConfirm(null);
      toast({ title: "Driver profile deleted", description: "The driver profile and associated data have been removed. The user account still exists." });
    },
    onError: (err: any) => {
      setDeleteConfirm(null);
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) return <div data-testid="loading-drivers">Loading drivers...</div>;

  const pendingDrivers = drivers.filter((d: any) => !d.approvalStatus || d.approvalStatus === 'pending');
  const rejectedDrivers = drivers.filter((d: any) => d.approvalStatus === 'rejected');
  const approvedDrivers = drivers.filter((d: any) => d.approvalStatus === 'approved');

  const searchFilter = (d: any) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (d.user?.firstName?.toLowerCase().includes(term) || d.user?.lastName?.toLowerCase().includes(term) || d.user?.email?.toLowerCase().includes(term));
  };

  const filteredPending = pendingDrivers.filter(searchFilter);
  const filteredRejected = rejectedDrivers.filter(searchFilter);
  const filteredApproved = approvedDrivers.filter(searchFilter);

  return (
    <div data-testid="panel-drivers">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h2 className="text-2xl font-bold">Driver Management</h2>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-sm">{drivers.length} total</Badge>
          <Badge className="bg-orange-500 text-white text-sm">{pendingDrivers.length} pending</Badge>
          <Badge className="bg-green-500 text-white text-sm">{approvedDrivers.length} approved</Badge>
        </div>
      </div>

      <div className="mb-4">
        <Input
          placeholder="Search drivers by name or email..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          data-testid="input-search-drivers"
        />
      </div>

      {filteredPending.length > 0 && (
        <>
          <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Clock className="w-5 h-5 text-orange-500" /> Pending Approval ({filteredPending.length})
          </h3>
          <div className="space-y-3 mb-6">
            {filteredPending.map((d: any) => (
              <Card key={d.id} className="border-l-4 border-l-orange-400" data-testid={`driver-card-${d.id}`}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between flex-wrap gap-3">
                    <div className="flex-1 min-w-[200px]">
                      <p className="font-semibold" data-testid={`driver-name-${d.id}`}>{d.user?.firstName} {d.user?.lastName}</p>
                      <p className="text-sm text-muted-foreground">{d.user?.email}</p>
                      <p className="text-xs text-muted-foreground">{d.user?.phone}</p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {d.isOnline && <Badge className="bg-green-500 text-white">Online</Badge>}
                        <Badge className="bg-orange-500 text-white">Pending</Badge>
                        {d.licenseNumber && <Badge variant="outline">License: {d.licenseNumber}</Badge>}
                      </div>
                      {d.currentLocation && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Location: {(d.currentLocation as any)?.lat?.toFixed(4)}, {(d.currentLocation as any)?.lng?.toFixed(4)}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        Registered: {new Date(d.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => updateDriver.mutate({ userId: d.userId, updates: { approvalStatus: "approved", isVerifiedNeighbor: true } })}
                        data-testid={`btn-approve-driver-${d.id}`}
                      >
                        <CheckCircle className="w-3 h-3 mr-1" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => updateDriver.mutate({ userId: d.userId, updates: { approvalStatus: "rejected" } })}
                        data-testid={`btn-reject-driver-${d.id}`}
                      >
                        <XCircle className="w-3 h-3 mr-1" /> Reject
                      </Button>
                      {deleteConfirm === d.id ? (
                        <div className="flex gap-1">
                          <Button size="sm" variant="destructive" onClick={() => deleteDriverProfile.mutate(d.userId)} data-testid={`btn-confirm-delete-driver-${d.id}`}>Confirm</Button>
                          <Button size="sm" variant="outline" onClick={() => setDeleteConfirm(null)} data-testid={`btn-cancel-delete-driver-${d.id}`}>Cancel</Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="destructive" onClick={() => setDeleteConfirm(d.id)} data-testid={`btn-delete-driver-${d.id}`}>
                          <Trash2 className="w-3 h-3 mr-1" /> Delete Profile
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {filteredRejected.length > 0 && (
        <>
          <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <XCircle className="w-5 h-5 text-red-500" /> Rejected Drivers ({filteredRejected.length})
          </h3>
          <div className="space-y-3 mb-6">
            {filteredRejected.map((d: any) => (
              <Card key={d.id} className="border-l-4 border-l-red-400" data-testid={`driver-card-${d.id}`}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between flex-wrap gap-3">
                    <div className="flex-1 min-w-[200px]">
                      <p className="font-semibold" data-testid={`driver-name-${d.id}`}>{d.user?.firstName} {d.user?.lastName}</p>
                      <p className="text-sm text-muted-foreground">{d.user?.email}</p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        <Badge variant="destructive">Rejected</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Registered: {new Date(d.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => updateDriver.mutate({ userId: d.userId, updates: { approvalStatus: "approved", isVerifiedNeighbor: true } })}
                        data-testid={`btn-approve-driver-${d.id}`}
                      >
                        <CheckCircle className="w-3 h-3 mr-1" /> Approve
                      </Button>
                      {deleteConfirm === d.id ? (
                        <div className="flex gap-1">
                          <Button size="sm" variant="destructive" onClick={() => deleteDriverProfile.mutate(d.userId)} data-testid={`btn-confirm-delete-driver-${d.id}`}>Confirm</Button>
                          <Button size="sm" variant="outline" onClick={() => setDeleteConfirm(null)} data-testid={`btn-cancel-delete-driver-${d.id}`}>Cancel</Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="destructive" onClick={() => setDeleteConfirm(d.id)} data-testid={`btn-delete-driver-${d.id}`}>
                          <Trash2 className="w-3 h-3 mr-1" /> Delete Profile
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <CheckCircle className="w-5 h-5 text-green-600" /> Approved Drivers ({filteredApproved.length})
      </h3>
      <div className="space-y-3">
        {filteredApproved.map((d: any) => (
          <Card key={d.id} className={`border-l-4 ${d.isSuspended ? 'border-l-red-400' : 'border-l-green-400'}`} data-testid={`driver-card-${d.id}`}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div className="flex-1 min-w-[200px]">
                  <p className="font-semibold" data-testid={`driver-name-${d.id}`}>{d.user?.firstName} {d.user?.lastName}</p>
                  <p className="text-sm text-muted-foreground">{d.user?.email}</p>
                  <p className="text-xs text-muted-foreground">{d.user?.phone}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {d.isOnline && <Badge className="bg-green-500 text-white">Online</Badge>}
                    {d.isVerifiedNeighbor && <Badge className="bg-blue-500 text-white">Verified Neighbor</Badge>}
                    {d.isSuspended && <Badge variant="destructive">Suspended</Badge>}
                    <Badge className="bg-green-500 text-white">Approved</Badge>
                    {d.licenseNumber && <Badge variant="outline">License: {d.licenseNumber}</Badge>}
                  </div>
                  {d.vehicles?.length > 0 && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      {d.vehicles.map((v: any) => (
                        <span key={v.id} className="mr-2">
                          {v.year} {v.make} {v.model} ({v.licensePlate})
                        </span>
                      ))}
                    </div>
                  )}
                  {d.currentLocation && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Location: {(d.currentLocation as any)?.lat?.toFixed(4)}, {(d.currentLocation as any)?.lng?.toFixed(4)}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    Registered: {new Date(d.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  {!d.isSuspended && (
                    <Button size="sm" variant="destructive"
                      onClick={() => updateDriver.mutate({ userId: d.userId, updates: { isSuspended: true } })}
                      data-testid={`btn-suspend-driver-${d.id}`}
                    >
                      <Ban className="w-3 h-3 mr-1" /> Suspend
                    </Button>
                  )}
                  {d.isSuspended && (
                    <Button size="sm" variant="outline"
                      onClick={() => updateDriver.mutate({ userId: d.userId, updates: { isSuspended: false } })}
                      data-testid={`btn-unsuspend-driver-${d.id}`}
                    >
                      <UserCheck className="w-3 h-3 mr-1" /> Unsuspend
                    </Button>
                  )}
                  {!d.isVerifiedNeighbor && (
                    <Button size="sm" variant="outline"
                      onClick={() => updateDriver.mutate({ userId: d.userId, updates: { isVerifiedNeighbor: true } })}
                      data-testid={`btn-verify-driver-${d.id}`}
                    >
                      <Shield className="w-3 h-3 mr-1" /> Verify
                    </Button>
                  )}
                  {deleteConfirm === d.id ? (
                    <div className="flex gap-1">
                      <Button size="sm" variant="destructive" onClick={() => deleteDriverProfile.mutate(d.userId)} data-testid={`btn-confirm-delete-driver-${d.id}`}>Confirm</Button>
                      <Button size="sm" variant="outline" onClick={() => setDeleteConfirm(null)} data-testid={`btn-cancel-delete-driver-${d.id}`}>Cancel</Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="destructive" onClick={() => setDeleteConfirm(d.id)} data-testid={`btn-delete-driver-${d.id}`}>
                      <Trash2 className="w-3 h-3 mr-1" /> Delete Profile
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {filteredApproved.length === 0 && <p className="text-muted-foreground text-center py-8">No approved drivers found.</p>}
      </div>
    </div>
  );
}

function RidesPanel() {
  const { data: allRides = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/admin/rides"] });

  if (isLoading) return <div data-testid="loading-rides">Loading rides...</div>;

  return (
    <div data-testid="panel-rides">
      <h2 className="text-2xl font-bold mb-6">Ride Management</h2>
      <div className="space-y-3">
        {allRides.map((ride: any) => (
          <Card key={ride.id} data-testid={`ride-card-${ride.id}`}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between flex-wrap gap-2">
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2">
                    <Badge variant={ride.status === "completed" ? "default" : ride.status === "cancelled" ? "destructive" : "secondary"}>
                      {ride.status}
                    </Badge>
                    <Badge variant="outline">{ride.paymentMethod || "N/A"}</Badge>
                    <Badge variant="outline">{ride.paymentStatus || "N/A"}</Badge>
                  </div>
                  <div className="mt-2 text-sm">
                    <p><span className="font-medium">From:</span> {typeof ride.pickupLocation === 'object' ? `${ride.pickupLocation.lat?.toFixed(4)}, ${ride.pickupLocation.lng?.toFixed(4)}` : ride.pickupLocation}</p>
                    <p><span className="font-medium">To:</span> {typeof ride.destinationLocation === 'object' ? `${ride.destinationLocation.lat?.toFixed(4)}, ${ride.destinationLocation.lng?.toFixed(4)}` : ride.destinationLocation}</p>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    <span>Est: ${ride.estimatedFare}</span>
                    {ride.actualFare && <span className="ml-3">Actual: ${ride.actualFare}</span>}
                    {ride.tipAmount && <span className="ml-3">Tip: ${ride.tipAmount}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Created: {new Date(ride.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {allRides.length === 0 && <p className="text-muted-foreground text-center py-8">No rides found.</p>}
      </div>
    </div>
  );
}

function DisputesPanel() {
  const { data: allDisputes = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/admin/disputes"] });
  const { toast } = useToast();
  const [resolution, setResolution] = useState("");
  const [selectedDispute, setSelectedDispute] = useState<string | null>(null);

  const resolveDispute = useMutation({
    mutationFn: async ({ disputeId, resolution }: { disputeId: string; resolution: string }) => {
      await apiRequest("PATCH", `/api/admin/disputes/${disputeId}`, { resolution });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/disputes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard"] });
      setSelectedDispute(null);
      setResolution("");
      toast({ title: "Dispute resolved" });
    },
  });

  if (isLoading) return <div data-testid="loading-disputes">Loading disputes...</div>;

  return (
    <div data-testid="panel-disputes">
      <h2 className="text-2xl font-bold mb-6">Dispute Management</h2>
      <div className="space-y-3">
        {allDisputes.map((dispute: any) => (
          <Card key={dispute.id} data-testid={`dispute-card-${dispute.id}`}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between flex-wrap gap-2">
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant={dispute.status === "resolved" ? "default" : "destructive"}>{dispute.status}</Badge>
                    <Badge variant="outline">{dispute.type}</Badge>
                  </div>
                  <p className="text-sm">{dispute.description}</p>
                  {dispute.resolution && (
                    <p className="text-sm text-green-700 mt-1"><span className="font-medium">Resolution:</span> {dispute.resolution}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    Ride: {dispute.rideId} | Filed: {new Date(dispute.createdAt).toLocaleString()}
                  </p>
                </div>
                {dispute.status === "pending" && (
                  <div>
                    {selectedDispute === dispute.id ? (
                      <div className="flex flex-col gap-2 w-64">
                        <Textarea
                          placeholder="Enter resolution..."
                          value={resolution}
                          onChange={(e) => setResolution(e.target.value)}
                          data-testid={`input-resolution-${dispute.id}`}
                        />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => resolveDispute.mutate({ disputeId: dispute.id, resolution })}
                            disabled={!resolution.trim()} data-testid={`btn-submit-resolution-${dispute.id}`}>
                            Submit
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { setSelectedDispute(null); setResolution(""); }}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <Button size="sm" onClick={() => setSelectedDispute(dispute.id)} data-testid={`btn-resolve-dispute-${dispute.id}`}>
                        Resolve
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {allDisputes.length === 0 && <p className="text-muted-foreground text-center py-8">No disputes found.</p>}
      </div>
    </div>
  );
}

function FinancesPanel() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);

  const { data: summary, isLoading } = useQuery<{
    totalRevenue: number; totalFares: number; totalTips: number;
    totalCancellationFees: number; rideCount: number;
  }>({ queryKey: [`/api/admin/finances?year=${year}`] });

  if (isLoading) return <div data-testid="loading-finances">Loading finances...</div>;

  return (
    <div data-testid="panel-finances">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Financial Summary</h2>
        <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v))}>
          <SelectTrigger className="w-32" data-testid="select-year">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[currentYear, currentYear - 1, currentYear - 2].map(y => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card data-testid="stat-total-revenue">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Revenue</p>
            <p className="text-3xl font-bold text-green-700">${(summary?.totalRevenue || 0).toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card data-testid="stat-total-fares">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Fares</p>
            <p className="text-2xl font-bold">${(summary?.totalFares || 0).toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card data-testid="stat-total-tips">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Tips</p>
            <p className="text-2xl font-bold">${(summary?.totalTips || 0).toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card data-testid="stat-cancellation-fees">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Cancellation Fees</p>
            <p className="text-2xl font-bold">${(summary?.totalCancellationFees || 0).toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card data-testid="stat-ride-count">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Completed Rides</p>
            <p className="text-2xl font-bold">{summary?.rideCount || 0}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function OwnershipPanel() {
  const { data, isLoading } = useQuery<{
    owners: any[]; allRecords: any[]; certificates: any[]; rebalanceLog: any[];
  }>({ queryKey: ["/api/admin/ownership"] });
  const { toast } = useToast();

  const recalculate = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/ownership/recalculate");
      return res.json();
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ownership"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard"] });
      toast({
        title: "Ownership recalculated",
        description: `Qualified: ${result.qualified?.length || 0}, Disqualified: ${result.disqualified?.length || 0}`,
      });
    },
  });

  if (isLoading) return <div data-testid="loading-ownership">Loading ownership data...</div>;

  const owners = data?.owners || [];
  const allRecords = data?.allRecords || [];
  const certificates = data?.certificates || [];

  return (
    <div data-testid="panel-ownership">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Driver Ownership</h2>
        <Button onClick={() => recalculate.mutate()} disabled={recalculate.isPending} data-testid="btn-recalculate-ownership">
          {recalculate.isPending ? "Recalculating..." : "Recalculate Ownership"}
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-sm text-muted-foreground">Active Owners</p>
            <p className="text-3xl font-bold text-yellow-600">{owners.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-sm text-muted-foreground">Active Certificates</p>
            <p className="text-3xl font-bold text-blue-600">{certificates.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-sm text-muted-foreground">Driver Pool</p>
            <p className="text-3xl font-bold text-green-600">49%</p>
          </CardContent>
        </Card>
      </div>

      <h3 className="text-lg font-semibold mb-3">All Driver Ownership Records</h3>
      <div className="space-y-3">
        {allRecords.map((record: any) => (
          <Card key={record.id} data-testid={`ownership-record-${record.id}`}>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="font-semibold">{record.driver?.firstName} {record.driver?.lastName}</p>
                  <p className="text-sm text-muted-foreground">{record.driver?.email}</p>
                  <div className="flex gap-2 mt-1">
                    <Badge variant={record.status === "lifetime" ? "default" : record.status === "ad_hoc" ? "secondary" : "outline"}>
                      {record.status}
                    </Badge>
                    {record.hasAdverseRecord && <Badge variant="destructive">Adverse Record</Badge>}
                  </div>
                </div>
                <div className="text-right text-sm">
                  <p>Qualifying Weeks: <span className="font-bold">{record.totalQualifyingWeeks || 0}</span>/12</p>
                  <p>Total Hours: <span className="font-bold">{((record.totalLifetimeMinutes || 0) / 60).toFixed(1)}</span></p>
                  {record.ratingAtQualification && <p>Rating: {record.ratingAtQualification}</p>}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {allRecords.length === 0 && <p className="text-muted-foreground text-center py-8">No ownership records yet.</p>}
      </div>

      {certificates.length > 0 && (
        <>
          <h3 className="text-lg font-semibold mb-3 mt-6">Active Share Certificates</h3>
          <div className="space-y-2">
            {certificates.map((cert: any) => (
              <Card key={cert.id} data-testid={`certificate-${cert.id}`}>
                <CardContent className="pt-4 flex items-center justify-between">
                  <div>
                    <p className="font-mono text-sm">{cert.certificateNumber}</p>
                    <p className="text-xs text-muted-foreground">Owner: {cert.ownerId}</p>
                  </div>
                  <Badge className="text-lg">{parseFloat(cert.sharePercentage || "0").toFixed(2)}%</Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ProfitsPanel() {
  const { data: declarations = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/admin/profits"] });
  const { toast } = useToast();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState({
    fiscalYear: new Date().getFullYear(),
    totalRevenue: "",
    totalExpenses: "",
    netProfit: "",
    distributableProfit: "",
    boardNotes: "",
  });

  const createDeclaration = useMutation({
    mutationFn: async (data: any) => {
      await apiRequest("POST", "/api/admin/profits", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/profits"] });
      setShowCreateForm(false);
      toast({ title: "Profit declaration created" });
    },
  });

  const declareProfit = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/admin/profits/${id}/declare`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/profits"] });
      toast({ title: "Profit declared for board approval" });
    },
  });

  const distributeProfit = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/admin/profits/${id}/distribute`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/profits"] });
      toast({ title: "Profits distributed to owners" });
    },
  });

  if (isLoading) return <div data-testid="loading-profits">Loading profits...</div>;

  return (
    <div data-testid="panel-profits">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Profit Declarations</h2>
        <Button onClick={() => setShowCreateForm(!showCreateForm)} data-testid="btn-create-declaration">
          {showCreateForm ? "Cancel" : "New Declaration"}
        </Button>
      </div>

      {showCreateForm && (
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Fiscal Year</label>
                <Input type="number" value={formData.fiscalYear}
                  onChange={(e) => setFormData({ ...formData, fiscalYear: parseInt(e.target.value) })}
                  data-testid="input-fiscal-year" />
              </div>
              <div>
                <label className="text-sm font-medium">Total Revenue</label>
                <Input type="number" step="0.01" placeholder="0.00" value={formData.totalRevenue}
                  onChange={(e) => setFormData({ ...formData, totalRevenue: e.target.value })}
                  data-testid="input-total-revenue" />
              </div>
              <div>
                <label className="text-sm font-medium">Total Expenses</label>
                <Input type="number" step="0.01" placeholder="0.00" value={formData.totalExpenses}
                  onChange={(e) => setFormData({ ...formData, totalExpenses: e.target.value })}
                  data-testid="input-total-expenses" />
              </div>
              <div>
                <label className="text-sm font-medium">Net Profit</label>
                <Input type="number" step="0.01" placeholder="0.00" value={formData.netProfit}
                  onChange={(e) => setFormData({ ...formData, netProfit: e.target.value })}
                  data-testid="input-net-profit" />
              </div>
              <div>
                <label className="text-sm font-medium">Distributable Profit</label>
                <Input type="number" step="0.01" placeholder="0.00" value={formData.distributableProfit}
                  onChange={(e) => setFormData({ ...formData, distributableProfit: e.target.value })}
                  data-testid="input-distributable-profit" />
              </div>
              <div>
                <label className="text-sm font-medium">Board Notes</label>
                <Textarea value={formData.boardNotes}
                  onChange={(e) => setFormData({ ...formData, boardNotes: e.target.value })}
                  data-testid="input-board-notes" />
              </div>
            </div>
            <Button className="mt-4" onClick={() => createDeclaration.mutate(formData)}
              disabled={createDeclaration.isPending || !formData.totalRevenue}
              data-testid="btn-submit-declaration">
              Create Declaration
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {declarations.map((decl: any) => (
          <Card key={decl.id} data-testid={`declaration-${decl.id}`}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between flex-wrap gap-2">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold">FY {decl.fiscalYear}</h3>
                    <Badge variant={decl.status === "distributed" ? "default" : decl.status === "declared" ? "secondary" : "outline"}>
                      {decl.status}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 text-sm">
                    <p>Revenue: <span className="font-medium">${parseFloat(decl.totalRevenue || "0").toFixed(2)}</span></p>
                    <p>Expenses: <span className="font-medium">${parseFloat(decl.totalExpenses || "0").toFixed(2)}</span></p>
                    <p>Net Profit: <span className="font-medium">${parseFloat(decl.netProfit || "0").toFixed(2)}</span></p>
                    <p>Distributable: <span className="font-medium">${parseFloat(decl.distributableProfit || "0").toFixed(2)}</span></p>
                  </div>
                  {decl.boardNotes && <p className="text-xs text-muted-foreground mt-1">{decl.boardNotes}</p>}
                </div>
                <div className="flex gap-2">
                  {decl.status === "draft" && (
                    <Button size="sm" onClick={() => declareProfit.mutate(decl.id)}
                      disabled={declareProfit.isPending} data-testid={`btn-declare-${decl.id}`}>
                      Declare
                    </Button>
                  )}
                  {decl.status === "declared" && (
                    <Button size="sm" onClick={() => distributeProfit.mutate(decl.id)}
                      disabled={distributeProfit.isPending} data-testid={`btn-distribute-${decl.id}`}>
                      Distribute
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {declarations.length === 0 && <p className="text-muted-foreground text-center py-8">No profit declarations yet.</p>}
      </div>
    </div>
  );
}

function ActivityPanel() {
  const { data: activityLog = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/admin/activity-log"] });

  if (isLoading) return <div data-testid="loading-activity">Loading activity log...</div>;

  return (
    <div data-testid="panel-activity">
      <h2 className="text-2xl font-bold mb-6">Admin Activity Log</h2>
      <div className="space-y-2">
        {activityLog.map((entry: any) => (
          <Card key={entry.id} data-testid={`activity-${entry.id}`}>
            <CardContent className="pt-3 pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{entry.action}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.targetType && `${entry.targetType}: ${entry.targetId || 'N/A'}`}
                  </p>
                  {entry.details && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {JSON.stringify(entry.details).substring(0, 100)}
                    </p>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</p>
              </div>
            </CardContent>
          </Card>
        ))}
        {activityLog.length === 0 && <p className="text-muted-foreground text-center py-8">No activity recorded yet.</p>}
      </div>
    </div>
  );
}

function AnalyticsPanel() {
  const { toast } = useToast();

  const { data: eventStats, isLoading: loadingEvents } = useQuery<{
    totalEvents: number;
    uniqueUsers: number;
    topEvents: { eventType: string; count: number }[];
    last24h: number;
  }>({ queryKey: ["/api/admin/analytics/events"] });

  const { data: aiFeedback, isLoading: loadingFeedback } = useQuery<{
    totalFeedback: number;
    helpful: number;
    notHelpful: number;
    helpfulRate: number;
  }>({ queryKey: ["/api/admin/analytics/ai-feedback"] });

  const { data: conversion, isLoading: loadingConversion } = useQuery<{
    searches: number;
    bookings: number;
    completions: number;
    searchToBookRate: number;
    bookToCompleteRate: number;
  }>({ queryKey: ["/api/admin/analytics/conversion"] });

  const { data: insights = [], isLoading: loadingInsights } = useQuery<any[]>({
    queryKey: ["/api/admin/analytics/insights"],
  });

  const { data: safetyAlerts = [], isLoading: loadingSafety } = useQuery<any[]>({
    queryKey: ["/api/admin/analytics/safety-alerts"],
  });

  const refreshScoreCards = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/admin/analytics/refresh-scorecards");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/analytics/scorecards"] });
      toast({ title: "Scorecards refreshed" });
    },
    onError: () => {
      toast({ title: "Error refreshing scorecards", variant: "destructive" });
    },
  });

  const detectSafety = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/admin/analytics/detect-safety-patterns");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/analytics/safety-alerts"] });
      toast({ title: "Safety patterns analyzed" });
    },
    onError: () => {
      toast({ title: "Error detecting safety patterns", variant: "destructive" });
    },
  });

  const generateHeatmap = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/admin/analytics/generate-demand-heatmap");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/demand-heatmap"] });
      toast({ title: "Demand heatmap generated" });
    },
    onError: () => {
      toast({ title: "Error generating heatmap", variant: "destructive" });
    },
  });

  const generateFaq = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/admin/analytics/generate-faq");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/faq"] });
      toast({ title: "FAQ entries generated from AI conversations" });
    },
    onError: () => {
      toast({ title: "Error generating FAQ", variant: "destructive" });
    },
  });

  const resolveAlert = useMutation({
    mutationFn: async (alertId: number) => {
      await apiRequest("POST", `/api/admin/analytics/safety-alerts/${alertId}/resolve`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/analytics/safety-alerts"] });
      toast({ title: "Alert resolved" });
    },
  });

  const markInsightRead = useMutation({
    mutationFn: async (insightId: number) => {
      await apiRequest("POST", `/api/admin/analytics/insights/${insightId}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/analytics/insights"] });
    },
  });

  const isLoading = loadingEvents || loadingFeedback || loadingConversion;

  return (
    <div data-testid="panel-analytics">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Platform Analytics</h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card data-testid="stat-total-events">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Events</p>
                <p className="text-2xl font-bold mt-1">{isLoading ? '...' : eventStats?.totalEvents || 0}</p>
                <p className="text-xs text-muted-foreground">{eventStats?.last24h || 0} in last 24h</p>
              </div>
              <BarChart3 className="w-8 h-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        <Card data-testid="stat-unique-users">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Unique Users Tracked</p>
                <p className="text-2xl font-bold mt-1">{isLoading ? '...' : eventStats?.uniqueUsers || 0}</p>
              </div>
              <Users className="w-8 h-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card data-testid="stat-ai-satisfaction">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">AI Satisfaction</p>
                <p className="text-2xl font-bold mt-1">
                  {isLoading ? '...' : `${(aiFeedback?.helpfulRate || 0).toFixed(0)}%`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {aiFeedback?.helpful || 0} <ThumbsUp className="w-3 h-3 inline" /> / {aiFeedback?.notHelpful || 0} <ThumbsDown className="w-3 h-3 inline" />
                </p>
              </div>
              <Brain className="w-8 h-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>
        <Card data-testid="stat-conversion">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Search → Book Rate</p>
                <p className="text-2xl font-bold mt-1">
                  {isLoading ? '...' : `${(conversion?.searchToBookRate || 0).toFixed(1)}%`}
                </p>
                <p className="text-xs text-muted-foreground">
                  Book → Complete: {(conversion?.bookToCompleteRate || 0).toFixed(1)}%
                </p>
              </div>
              <TrendingUp className="w-8 h-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card data-testid="card-conversion-funnel">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="w-5 h-5" /> Conversion Funnel
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span>Ride Searches</span>
                  <span className="font-medium">{conversion?.searches || 0}</span>
                </div>
                <Progress value={100} className="h-3" />
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span>Bookings</span>
                  <span className="font-medium">{conversion?.bookings || 0}</span>
                </div>
                <Progress value={conversion?.searchToBookRate || 0} className="h-3" />
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span>Completions</span>
                  <span className="font-medium">{conversion?.completions || 0}</span>
                </div>
                <Progress value={conversion?.bookToCompleteRate || 0} className="h-3" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-top-events">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Zap className="w-5 h-5" /> Top Events
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {eventStats?.topEvents?.slice(0, 8).map((evt) => (
                <div key={evt.eventType} className="flex justify-between items-center py-1 border-b border-border last:border-0">
                  <span className="text-sm">{evt.eventType.replace(/_/g, ' ')}</span>
                  <Badge variant="secondary">{evt.count}</Badge>
                </div>
              ))}
              {(!eventStats?.topEvents || eventStats.topEvents.length === 0) && (
                <p className="text-muted-foreground text-sm text-center py-4">No events tracked yet</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6" data-testid="card-admin-actions">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <RefreshCw className="w-5 h-5" /> Analytics Actions
          </CardTitle>
          <CardDescription>Generate insights, refresh data, and detect patterns</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Button
              variant="outline"
              onClick={() => refreshScoreCards.mutate()}
              disabled={refreshScoreCards.isPending}
              data-testid="btn-refresh-scorecards"
            >
              {refreshScoreCards.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Scorecards
            </Button>
            <Button
              variant="outline"
              onClick={() => detectSafety.mutate()}
              disabled={detectSafety.isPending}
              data-testid="btn-detect-safety"
            >
              {detectSafety.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <AlertCircle className="w-4 h-4 mr-2" />}
              Safety Scan
            </Button>
            <Button
              variant="outline"
              onClick={() => generateHeatmap.mutate()}
              disabled={generateHeatmap.isPending}
              data-testid="btn-generate-heatmap"
            >
              {generateHeatmap.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <MapPin className="w-4 h-4 mr-2" />}
              Heatmap
            </Button>
            <Button
              variant="outline"
              onClick={() => generateFaq.mutate()}
              disabled={generateFaq.isPending}
              data-testid="btn-generate-faq"
            >
              {generateFaq.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <BookOpen className="w-4 h-4 mr-2" />}
              Auto FAQ
            </Button>
          </div>
        </CardContent>
      </Card>

      {safetyAlerts.length > 0 && (
        <Card className="mb-6 border-red-200" data-testid="card-safety-alerts">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" /> Safety Alerts ({safetyAlerts.filter((a: any) => !a.resolved).length} active)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {safetyAlerts.filter((a: any) => !a.resolved).slice(0, 10).map((alert: any) => (
                <div key={alert.id} className="flex items-start justify-between p-3 bg-red-50 rounded-lg border border-red-100" data-testid={`safety-alert-${alert.id}`}>
                  <div>
                    <p className="text-sm font-medium text-red-900">{alert.alertType?.replace(/_/g, ' ')}</p>
                    <p className="text-xs text-red-700 mt-1">{alert.description}</p>
                    <Badge variant="outline" className="mt-1 text-xs">
                      Severity: {alert.severity}
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => resolveAlert.mutate(alert.id)}
                    data-testid={`btn-resolve-alert-${alert.id}`}
                  >
                    <CheckCircle className="w-4 h-4 text-green-600" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {insights.length > 0 && (
        <Card data-testid="card-insights">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Brain className="w-5 h-5" /> Platform Insights
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {insights.filter((i: any) => !i.isRead).slice(0, 10).map((insight: any) => (
                <div key={insight.id} className="flex items-start justify-between p-3 bg-blue-50 rounded-lg border border-blue-100" data-testid={`insight-${insight.id}`}>
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs">{insight.insightType?.replace(/_/g, ' ')}</Badge>
                      <Badge variant="outline" className="text-xs">Priority: {insight.priority}</Badge>
                    </div>
                    <p className="text-sm mt-2">{insight.description}</p>
                    {insight.suggestedAction && (
                      <p className="text-xs text-blue-700 mt-1">Suggested: {insight.suggestedAction}</p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => markInsightRead.mutate(insight.id)}
                    data-testid={`btn-read-insight-${insight.id}`}
                  >
                    <Eye className="w-4 h-4" />
                  </Button>
                </div>
              ))}
              {insights.filter((i: any) => !i.isRead).length === 0 && (
                <p className="text-muted-foreground text-sm text-center py-4">All insights reviewed</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
