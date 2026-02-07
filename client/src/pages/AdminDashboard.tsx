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
  ChevronLeft
} from "lucide-react";
import { useLocation } from "wouter";

type AdminTab = "dashboard" | "users" | "drivers" | "rides" | "disputes" | "finances" | "ownership" | "profits" | "activity";

export default function AdminDashboard() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>("dashboard");
  const [, setLocation] = useLocation();

  if (!user?.isAdmin) {
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
  const { data: users = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/admin/users"] });
  const { toast } = useToast();

  const updateUser = useMutation({
    mutationFn: async ({ userId, updates }: { userId: string; updates: any }) => {
      await apiRequest("PATCH", `/api/admin/users/${userId}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User updated" });
    },
  });

  if (isLoading) return <div data-testid="loading-users">Loading users...</div>;

  return (
    <div data-testid="panel-users">
      <h2 className="text-2xl font-bold mb-6">User Management</h2>
      <div className="space-y-3">
        {users.map((u: any) => (
          <Card key={u.id} data-testid={`user-card-${u.id}`}>
            <CardContent className="pt-4 flex items-center justify-between flex-wrap gap-2">
              <div className="flex-1 min-w-[200px]">
                <p className="font-semibold" data-testid={`user-name-${u.id}`}>{u.firstName} {u.lastName}</p>
                <p className="text-sm text-muted-foreground">{u.email}</p>
                <p className="text-xs text-muted-foreground">{u.phone}</p>
                <div className="flex gap-1 mt-1">
                  {u.isDriver && <Badge variant="secondary">Driver</Badge>}
                  {u.isAdmin && <Badge>Admin</Badge>}
                  {u.isSuspended && <Badge variant="destructive">Suspended</Badge>}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant={u.isAdmin ? "destructive" : "outline"}
                  onClick={() => updateUser.mutate({ userId: u.id, updates: { isAdmin: !u.isAdmin } })}
                  data-testid={`btn-toggle-admin-${u.id}`}
                >
                  {u.isAdmin ? "Remove Admin" : "Make Admin"}
                </Button>
                <Button size="sm" variant={u.isSuspended ? "default" : "destructive"}
                  onClick={() => updateUser.mutate({ userId: u.id, updates: { isSuspended: !u.isSuspended } })}
                  data-testid={`btn-toggle-suspend-${u.id}`}
                >
                  {u.isSuspended ? "Unsuspend" : "Suspend"}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {users.length === 0 && <p className="text-muted-foreground text-center py-8">No users found.</p>}
      </div>
    </div>
  );
}

function DriversPanel() {
  const { data: drivers = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/admin/drivers"] });
  const { toast } = useToast();

  const updateDriver = useMutation({
    mutationFn: async ({ userId, updates }: { userId: string; updates: any }) => {
      await apiRequest("PATCH", `/api/admin/drivers/${userId}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/drivers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard"] });
      toast({ title: "Driver updated" });
    },
  });

  if (isLoading) return <div data-testid="loading-drivers">Loading drivers...</div>;

  return (
    <div data-testid="panel-drivers">
      <h2 className="text-2xl font-bold mb-6">Driver Management</h2>
      <div className="space-y-3">
        {drivers.map((d: any) => (
          <Card key={d.id} data-testid={`driver-card-${d.id}`}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div className="flex-1 min-w-[200px]">
                  <p className="font-semibold" data-testid={`driver-name-${d.id}`}>{d.user?.firstName} {d.user?.lastName}</p>
                  <p className="text-sm text-muted-foreground">{d.user?.email}</p>
                  <p className="text-xs text-muted-foreground">{d.user?.phone}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {d.isOnline && <Badge className="bg-green-500">Online</Badge>}
                    {d.isVerifiedNeighbor && <Badge className="bg-blue-500">Verified Neighbor</Badge>}
                    {d.isSuspended && <Badge variant="destructive">Suspended</Badge>}
                    <Badge variant="outline">{d.approvalStatus || "pending"}</Badge>
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
                </div>
                <div className="flex flex-col gap-2">
                  {d.approvalStatus !== "approved" && (
                    <Button size="sm" onClick={() => updateDriver.mutate({ userId: d.userId, updates: { approvalStatus: "approved", isVerifiedNeighbor: true } })}
                      data-testid={`btn-approve-driver-${d.id}`}
                    >
                      <CheckCircle className="w-3 h-3 mr-1" /> Approve
                    </Button>
                  )}
                  {d.approvalStatus === "approved" && !d.isSuspended && (
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
                  {!d.isVerifiedNeighbor && d.approvalStatus === "approved" && (
                    <Button size="sm" variant="outline"
                      onClick={() => updateDriver.mutate({ userId: d.userId, updates: { isVerifiedNeighbor: true } })}
                      data-testid={`btn-verify-driver-${d.id}`}
                    >
                      <Shield className="w-3 h-3 mr-1" /> Verify
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {drivers.length === 0 && <p className="text-muted-foreground text-center py-8">No drivers found.</p>}
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
