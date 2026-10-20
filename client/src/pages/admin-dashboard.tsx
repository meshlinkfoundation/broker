import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useToast } from "@/hooks/use-toast";
import {
  Users, Activity, DollarSign, Database, Shield, LogOut, Wifi,
  Edit, Trash2, RefreshCw, Search, Layers
} from "lucide-react";

interface Analytics {
  totalSessions: number;
  activeSessions: number;
  todaySessions: number;
  weekSessions: number;
  totalDataUsed: number;
  totalRevenue: number;
  tierStats: Record<string, { name: string; count: number; revenue: number }>;
  paymentMethods: { stripe: number; crypto: number };
  portalFunnel?: {
    date: string;
    uniquePortalIps: number;
    steps: Array<{
      eventName: string;
      label: string;
      uniqueIps: number;
      eventCount: number;
      conversionFromPortal: number;
    }>;
    accessByMethod: Record<string, number>;
    hourlyActivity: Array<{
      hour: number;
      label: string;
      portalViews: number;
      tierSelections: number;
      checkouts: number;
      payments: number;
      accessGrants: number;
    }>;
  };
  recentSessions: Array<{
    sessionGuid: string;
    clientIp?: string;
    tierName: string;
    paymentMethod: string;
    status: string;
    dataUsedMB: number;
    createdAt: string;
    expiryDate: string;
  }>;
  sessionsToday: Array<{
    sessionGuid: string;
    clientIp?: string;
    tierName: string;
    paymentMethod: string;
    status: string;
    dataUsedMB: number;
    createdAt: string;
    expiryDate: string;
  }>;
}

interface AccessSession {
  id: number;
  sessionGuid: string;
  userIdentifier: string;
  clientIp?: string;
  tierId: string;
  tierName: string;
  paymentMethod: string;
  paymentReference: string | null;
  status: string;
  startDate: string;
  expiryDate: string;
  dataLimitMB: number;
  dataUsedMB: number;
  speedMbps: string;
  nodeOperator: string;
  createdAt: string;
  lastAccessAt: string | null;
}

interface NetworkClient {
  ip: string;
  tier: string;
  sessionGuid: string;
  startedAt?: string;
  expiryDate: string;
  status: string;
  speedMbps?: string;
}

interface EditFormData {
  [key: string]: string | number | boolean;
}

interface ServiceProfileTier {
  id: string;
  name: string;
  price?: number;
  durationHours: number;
  speedMbps: number | string;
  dataLimitMB: number;
  isFree: boolean;
  enabled?: boolean;
}

interface ServiceProfile {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  tierCount: number;
  pricing: {
    currency?: string;
    tiers: ServiceProfileTier[];
  };
}

interface ExtenderStatus {
  name: string;
  hostname: string;
  mac: string;
  ip: string | null;
  linked: boolean;
  signalDbm: number | null;
  snr: number | null;
  lastHeardSeconds: number | null;
  txRate: string | null;
}

interface ExtenderReport {
  accessPoint: {
    name: string;
    ip: string | null;
    reachable: boolean;
  };
  extenders: ExtenderStatus[];
}

interface ServiceProfilesResponse {
  activeProfileId: string;
  profiles: ServiceProfile[];
}

export default function AdminDashboard() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [isLogging, setIsLogging] = useState(false);
  const [authToken, setAuthToken] = useState("");
  const [nodeInfo, setNodeInfo] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'clients' | 'sessions' | 'analytics' | 'profiles'>('overview');
  const [searchTerm, setSearchTerm] = useState("");
  const [editingRecord, setEditingRecord] = useState<AccessSession | null>(null);
  const [editFormData, setEditFormData] = useState<EditFormData>({});
  const [showEditDialog, setShowEditDialog] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const expiredTokenHandled = useRef(false);

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (token) {
      setAuthToken(token);
      setIsAuthenticated(true);
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLogging(true);

    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();

      if (response.ok) {
        expiredTokenHandled.current = false;
        setAuthToken(data.token);
        setNodeInfo(data.nodeInfo);
        setIsAuthenticated(true);
        localStorage.setItem('admin_token', data.token);
        queryClient.invalidateQueries({ queryKey: ["/api/admin/analytics"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/sessions"] });
        queryClient.invalidateQueries({ queryKey: ["/api/network/clients"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/profiles"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/extenders"] });
        toast({
          title: "Authentication Successful",
          description: `Welcome to ${data.nodeInfo.name} dashboard`,
        });
      } else {
        toast({
          title: "Authentication Failed",
          description: data.error || "Invalid password",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Login Error",
        description: "Unable to connect to server",
        variant: "destructive",
      });
    } finally {
      setIsLogging(false);
    }
  };

  const handleLogout = () => {
    expiredTokenHandled.current = false;
    setIsAuthenticated(false);
    setAuthToken("");
    setPassword("");
    localStorage.removeItem('admin_token');
    toast({
      title: "Logged Out",
      description: "Successfully logged out of admin dashboard",
    });
  };

  const requireAdminResponse = (response: Response, fallbackMessage: string) => {
    if (response.status === 401) {
      if (!expiredTokenHandled.current) {
        expiredTokenHandled.current = true;
        localStorage.removeItem('admin_token');
        setAuthToken("");
        setIsAuthenticated(false);
        toast({
          title: "Signed Out",
          description: "Sign in again whenever you want the dashboard.",
          variant: "destructive",
        });
      }
      throw new Error('Admin session expired');
    }
    if (!response.ok) throw new Error(fallbackMessage);
    return response;
  };

  // Fetch analytics
  const { data: analytics } = useQuery<Analytics>({
    queryKey: ["/api/admin/analytics"],
    queryFn: async () => {
      const response = await fetch('/api/admin/analytics', {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      requireAdminResponse(response, 'Failed to fetch analytics');
      return response.json();
    },
    enabled: isAuthenticated && !!authToken,
    refetchInterval: 30000,
  });

  // Fetch sessions
  const { data: sessionsData, isLoading: sessionsLoading } = useQuery<{
    sessions: AccessSession[];
    total: number;
  }>({
    queryKey: ["/api/admin/sessions"],
    queryFn: async () => {
      const response = await fetch('/api/admin/sessions?limit=100', {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      requireAdminResponse(response, 'Failed to fetch sessions');
      return response.json();
    },
    enabled: isAuthenticated && !!authToken,
    refetchInterval: 15000,
  });

  // Fetch network clients
  const { data: clientsData, isLoading: clientsLoading } = useQuery<{
    totalClients: number;
    clients: NetworkClient[];
  }>({
    queryKey: ["/api/network/clients"],
    queryFn: async () => {
      const response = await fetch('/api/network/clients', {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      requireAdminResponse(response, 'Failed to fetch clients');
      return response.json();
    },
    enabled: isAuthenticated && !!authToken,
    refetchInterval: 15000,
  });

  const { data: profilesData, isLoading: profilesLoading } = useQuery<ServiceProfilesResponse>({
    queryKey: ["/api/admin/profiles"],
    queryFn: async () => {
      const response = await fetch('/api/admin/profiles', {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      requireAdminResponse(response, 'Failed to fetch service profiles');
      return response.json();
    },
    enabled: isAuthenticated && !!authToken,
  });

  const { data: extenderReport } = useQuery<ExtenderReport>({
    queryKey: ["/api/admin/extenders"],
    queryFn: async () => {
      const response = await fetch('/api/admin/extenders', {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      requireAdminResponse(response, 'Failed to fetch extenders');
      return response.json();
    },
    enabled: isAuthenticated && !!authToken,
    refetchInterval: 15000,
  });

  const activateProfileMutation = useMutation({
    mutationFn: async (profileId: string) => {
      const response = await fetch(`/api/admin/profiles/${encodeURIComponent(profileId)}/activate`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      requireAdminResponse(response, 'Failed to activate service profile');
      return response.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/profiles"] });
      toast({
        title: "Profile Activated",
        description: `${result.activeProfile.name} is now offered to new clients.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Activation Failed",
        description: error instanceof Error ? error.message : "Unable to activate profile",
        variant: "destructive",
      });
    },
  });

  // Delete session
  const deleteSessionMutation = useMutation({
    mutationFn: async (sessionId: number) => {
      const response = await fetch(`/api/admin/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      requireAdminResponse(response, 'Failed to delete session');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/network/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/analytics"] });
      toast({ title: "Success", description: "Session deleted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete session", variant: "destructive" });
    },
  });

  // Update session
  const updateSessionMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: EditFormData }) => {
      const response = await fetch(`/api/admin/sessions/${id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      requireAdminResponse(response, 'Failed to update session');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/sessions"] });
      setShowEditDialog(false);
      setEditingRecord(null);
      toast({ title: "Success", description: "Session updated" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update session", variant: "destructive" });
    },
  });

  // Disconnect client
  const removeClientMutation = useMutation({
    mutationFn: async (clientIp: string) => {
      const response = await fetch(`/api/network/clients/${clientIp}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      requireAdminResponse(response, 'Failed to disconnect client');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/network/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/analytics"] });
      toast({ title: "Success", description: "Client disconnected" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to disconnect client", variant: "destructive" });
    },
  });

  const handleEditRecord = (record: AccessSession) => {
    setEditingRecord(record);
    setEditFormData(record as any);
    setShowEditDialog(true);
  };

  const handleFormChange = (field: string, value: string | number | boolean) => {
    setEditFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleUpdateRecord = () => {
    if (editingRecord) {
      updateSessionMutation.mutate({ id: editingRecord.id, data: editFormData });
    }
  };

  const snrTone = (snr: number) => {
    if (snr < 10) return { label: "Poor", className: "bg-red-100 text-red-700" };
    if (snr < 20) return { label: "Low", className: "bg-orange-100 text-orange-700" };
    if (snr < 30) return { label: "Fair", className: "bg-amber-100 text-amber-700" };
    if (snr < 40) return { label: "Good", className: "bg-yellow-100 text-yellow-800" };
    if (snr < 50) return { label: "Strong", className: "bg-lime-100 text-lime-800" };
    if (snr < 60) return { label: "Very good", className: "bg-green-100 text-green-700" };
    return { label: "Excellent", className: "bg-emerald-200 text-emerald-800" };
  };

  const formatHeard = (seconds: number | null) => {
    if (seconds == null) return "—";
    if (seconds < 5) return "just now";
    if (seconds < 60) return `${seconds}s ago`;
    return `${Math.round(seconds / 60)}m ago`;
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/sessions"] });
    queryClient.invalidateQueries({ queryKey: ["/api/network/clients"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/analytics"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/profiles"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/extenders"] });
    toast({ title: "Refreshed", description: "Dashboard data refreshed" });
  };

  // Filtering
  const filteredSessions = sessionsData?.sessions.filter((session) =>
    session.userIdentifier.toLowerCase().includes(searchTerm.toLowerCase()) ||
    session.sessionGuid.toLowerCase().includes(searchTerm.toLowerCase()) ||
    session.tierName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (session.clientIp && session.clientIp.includes(searchTerm))
  ) || [];

  const filteredClients = clientsData?.clients.filter((client) =>
    client.ip.includes(searchTerm) ||
    client.tier.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  const formatSessionTime = (value?: string) => {
    if (!value) return '—';
    const normalized = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value.replace(' ', 'T')}Z`;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 MB';
    const mb = bytes;
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    return `${(mb / 1024).toFixed(1)} GB`;
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-500';
      case 'expired': return 'bg-red-500';
      case 'suspended': return 'bg-yellow-500';
      default: return 'bg-gray-500';
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <Shield className="w-12 h-12 mx-auto text-blue-600 mb-2" />
            <CardTitle className="text-2xl">Admin Dashboard</CardTitle>
            <p className="text-gray-600">Node Operator Access</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Password</label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter admin password"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={isLogging}>
                {isLogging ? "Authenticating..." : "Login"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">meshlink Dashboard</h1>
            {(nodeInfo?.location || nodeInfo?.operator) && (
              <p className="text-gray-600">
                {[nodeInfo?.location, nodeInfo?.operator && `Operated by ${nodeInfo.operator}`]
                  .filter(Boolean)
                  .join(' • ')}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex flex-wrap gap-2">
              <Button
                variant={activeTab === 'overview' ? 'default' : 'outline'}
                onClick={() => setActiveTab('overview')}
                size="sm"
              >
                Overview
              </Button>
              <Button
                variant={activeTab === 'clients' ? 'default' : 'outline'}
                onClick={() => setActiveTab('clients')}
                size="sm"
              >
                Clients
              </Button>
              <Button
                variant={activeTab === 'sessions' ? 'default' : 'outline'}
                onClick={() => setActiveTab('sessions')}
                size="sm"
              >
                Sessions
              </Button>
              <Button
                variant={activeTab === 'analytics' ? 'default' : 'outline'}
                onClick={() => setActiveTab('analytics')}
                size="sm"
              >
                Analytics
              </Button>
              <Button
                variant={activeTab === 'profiles' ? 'default' : 'outline'}
                onClick={() => setActiveTab('profiles')}
                size="sm"
              >
                <Layers className="w-4 h-4 mr-2" />
                Profiles
              </Button>
              <Button variant="outline" onClick={handleRefresh} size="sm">
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
            <Button variant="outline" onClick={handleLogout} size="sm">
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>HaLow</CardTitle>
                <p className="text-sm text-gray-600">
                  Black is the access point. The extenders join it.
                </p>
              </CardHeader>
              <CardContent>
                <div className="border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Unit</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Signal</TableHead>
                        <TableHead>Last heard</TableHead>
                        <TableHead>Link</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell>
                          <div className="font-medium">Black</div>
                          <div className="text-xs text-gray-500 font-mono">{extenderReport?.accessPoint.ip || "halow-black"}</div>
                        </TableCell>
                        <TableCell>
                          {extenderReport?.accessPoint.reachable ? (
                            <Badge>Access point</Badge>
                          ) : (
                            <Badge variant="destructive">Not answering</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-gray-500">—</TableCell>
                        <TableCell className="text-sm text-gray-500">—</TableCell>
                        <TableCell className="text-sm text-gray-500">—</TableCell>
                      </TableRow>
                      {(extenderReport?.extenders || []).map((extender) => (
                        <TableRow key={extender.mac}>
                          <TableCell>
                            <div className="font-medium">{extender.name}</div>
                            <div className="text-xs text-gray-500 font-mono">{extender.ip || extender.hostname || extender.mac}</div>
                          </TableCell>
                          <TableCell>
                            {!extenderReport?.accessPoint.reachable ? (
                              <Badge variant="outline">Can't check</Badge>
                            ) : extender.linked ? (
                              <Badge>Linked</Badge>
                            ) : (
                              <Badge variant="destructive">Not linked</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            {extender.signalDbm == null ? "—" : `${extender.signalDbm} dBm`}
                            {extender.snr != null ? (
                              <span className={`ml-2 inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${snrTone(extender.snr).className}`}>
                                SNR {extender.snr} · {snrTone(extender.snr).label}
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-sm">{formatHeard(extender.lastHeardSeconds)}</TableCell>
                          <TableCell className="text-sm">{extender.txRate || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Active Sessions</CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{analytics?.activeSessions || 0}</div>
                  <p className="text-xs text-muted-foreground">
                    {analytics?.todaySessions || 0} today
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {formatCurrency(analytics?.totalRevenue || 0)}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {analytics?.weekSessions || 0} sales this week
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Data Usage</CardTitle>
                  <Database className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {formatBytes(analytics?.totalDataUsed || 0)}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Total consumed
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Sessions</CardTitle>
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{analytics?.totalSessions || 0}</div>
                  <p className="text-xs text-muted-foreground">
                    All time
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {analytics?.recentSessions.slice(0, 5).map((session) => (
                    <div key={session.sessionGuid} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center space-x-3">
                        <Wifi className="w-4 h-4 text-blue-600" />
                        <div>
                          <p className="font-medium">{session.tierName}</p>
                          <p className="text-sm text-gray-600">
                            <span className="font-mono">{session.clientIp || 'IP unavailable'}</span>
                            {' • '}{session.paymentMethod} • {formatBytes(session.dataUsedMB)}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <Badge className={getStatusColor(session.status)}>
                          {session.status}
                        </Badge>
                        <p className="text-xs text-gray-500 mt-1">
                          {formatSessionTime(session.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Clients Tab */}
        {activeTab === 'clients' && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Connected Clients</CardTitle>
                  <p className="text-gray-600 text-sm mt-1">{clientsData?.totalClients || 0} active clients on the network</p>
                </div>
                <div className="flex items-center space-x-2">
                  <Search className="w-4 h-4 text-gray-400" />
                  <Input
                    placeholder="Search by IP or tier..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-64"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>IP Address</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead>Tier</TableHead>
                      <TableHead>Speed</TableHead>
                      <TableHead>Expiry</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clientsLoading ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8">Loading clients...</TableCell>
                      </TableRow>
                    ) : filteredClients.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-gray-500">No active clients</TableCell>
                      </TableRow>
                    ) : (
                      filteredClients.map((client, index) => (
                        <TableRow key={index}>
                          <TableCell className="font-mono">{client.ip}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{formatSessionTime(client.startedAt)}</TableCell>
                          <TableCell>
                            <Badge variant={client.tier === 'Free Access' ? 'secondary' : 'default'}>
                              {client.tier}
                            </Badge>
                          </TableCell>
                          <TableCell>{client.speedMbps ? `${client.speedMbps} Mbps` : '\u2014'}</TableCell>
                          <TableCell className="text-sm">
                            {formatSessionTime(client.expiryDate)}
                          </TableCell>
                          <TableCell>
                            <Badge className={getStatusColor(client.status)}>
                              {client.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="sm" variant="destructive">
                                  Disconnect
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Disconnect Client</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Disconnect {client.ip} from the network? This will immediately revoke their internet access.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => removeClientMutation.mutate(client.ip)}
                                    className="bg-red-600 hover:bg-red-700"
                                  >
                                    Disconnect
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Sessions Tab */}
        {activeTab === 'sessions' && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Sessions</CardTitle>
                  <p className="text-gray-600 text-sm mt-1">{sessionsData?.total || 0} total sessions</p>
                </div>
                <div className="flex items-center space-x-2">
                  <Search className="w-4 h-4 text-gray-400" />
                  <Input
                    placeholder="Search by user, tier, IP..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-64"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Started</TableHead>
                      <TableHead>IP</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Tier</TableHead>
                      <TableHead>Speed</TableHead>
                      <TableHead>Data Usage</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Expiry</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessionsLoading ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-8">Loading sessions...</TableCell>
                      </TableRow>
                    ) : filteredSessions.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-8 text-gray-500">No sessions found</TableCell>
                      </TableRow>
                    ) : (
                      filteredSessions.map((session) => (
                        <TableRow key={session.id}>
                          <TableCell className="text-sm whitespace-nowrap">{formatSessionTime(session.createdAt)}</TableCell>
                          <TableCell className="font-mono text-xs">{session.clientIp || '\u2014'}</TableCell>
                          <TableCell className="text-sm max-w-[140px] truncate">{session.userIdentifier}</TableCell>
                          <TableCell>
                            <Badge variant={session.tierId === 'free' ? 'secondary' : 'default'}>
                              {session.tierName}
                            </Badge>
                          </TableCell>
                          <TableCell>{session.speedMbps} Mbps</TableCell>
                          <TableCell>
                            <div className="text-sm">
                              {session.dataLimitMB > 0
                                ? `${session.dataUsedMB} / ${session.dataLimitMB} MB`
                                : `${session.dataUsedMB} MB used`}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={session.status === 'active' ? 'default' : 'destructive'}>
                              {session.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">
                            {formatSessionTime(session.expiryDate)}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleEditRecord(session)}
                              >
                                <Edit className="w-3 h-3" />
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button size="sm" variant="destructive">
                                    <Trash2 className="w-3 h-3" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete Session</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Are you sure? This will revoke access and cannot be undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => deleteSessionMutation.mutate(session.id)}
                                      className="bg-red-600 hover:bg-red-700"
                                    >
                                      Delete
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Analytics Tab */}
        {activeTab === 'analytics' && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle>Today's Portal Funnel</CardTitle>
                    <p className="text-sm text-gray-600 mt-1">
                      Unique client IPs for {analytics?.portalFunnel?.date || 'today'}. Repeat refreshes are counted once.
                    </p>
                  </div>
                  <Badge variant="outline">
                    {analytics?.portalFunnel?.uniquePortalIps || 0} visitors
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                  {(analytics?.portalFunnel?.steps || []).map((step) => (
                    <div key={step.eventName} className="rounded-lg border bg-white p-4">
                      <p className="text-sm text-gray-600">{step.label}</p>
                      <p className="text-3xl font-bold mt-1">{step.uniqueIps}</p>
                      <Progress value={Math.min(100, step.conversionFromPortal)} className="mt-3 h-2" />
                      <p className="text-xs text-gray-500 mt-2">
                        {step.conversionFromPortal}% of portal visitors
                      </p>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 mt-5">
                  {Object.entries(analytics?.portalFunnel?.accessByMethod || {}).map(([method, count]) => (
                    <Badge key={method} variant="secondary">
                      {method}: {count} granted
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-4">
                  Checkout and paid counts apply to paid tiers; access granted includes free access.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Sessions today</CardTitle>
                <p className="text-sm text-gray-600">
                  Each new session with the local time it started.
                </p>
              </CardHeader>
              <CardContent>
                {(analytics?.sessionsToday || []).length === 0 ? (
                  <p className="text-sm text-gray-500">No sessions yet today.</p>
                ) : (
                  <div className="border rounded-lg">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Started</TableHead>
                          <TableHead>IP</TableHead>
                          <TableHead>Tier</TableHead>
                          <TableHead>Data</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {analytics?.sessionsToday.map((session) => (
                          <TableRow key={session.sessionGuid}>
                            <TableCell className="text-sm whitespace-nowrap">
                              {formatSessionTime(session.createdAt)}
                            </TableCell>
                            <TableCell className="font-mono text-xs">{session.clientIp || '—'}</TableCell>
                            <TableCell>{session.tierName}</TableCell>
                            <TableCell>{formatBytes(session.dataUsedMB)}</TableCell>
                            <TableCell>
                              <Badge className={getStatusColor(session.status)}>{session.status}</Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Portal Activity by Hour</CardTitle>
                  <p className="text-sm text-gray-600">Unique visitors reaching the portal and choosing a tier today.</p>
                </CardHeader>
                <CardContent>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={analytics?.portalFunnel?.hourlyActivity || []} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="label" interval={2} tick={{ fontSize: 11 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="portalViews" name="Portal views" stroke="#2563eb" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="tierSelections" name="Tier selections" stroke="#7c3aed" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Conversions by Hour</CardTitle>
                  <p className="text-sm text-gray-600">Checkout starts, verified payments, and granted access today.</p>
                </CardHeader>
                <CardContent>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={analytics?.portalFunnel?.hourlyActivity || []} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="label" interval={2} tick={{ fontSize: 11 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="checkouts" name="Checkouts" stroke="#f59e0b" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="payments" name="Paid" stroke="#16a34a" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="accessGrants" name="Access granted" stroke="#0891b2" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Payment Methods</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <span>Stripe Payments</span>
                      <Badge>{analytics?.paymentMethods.stripe || 0}</Badge>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>Crypto Payments</span>
                      <Badge>{analytics?.paymentMethods.crypto || 0}</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Tier Performance</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {Object.entries(analytics?.tierStats || {}).map(([tierId, stats]) => (
                      <div key={tierId} className="flex justify-between items-center">
                        <div>
                          <p className="font-medium">{stats.name}</p>
                          <p className="text-sm text-gray-600">{stats.count} sessions</p>
                        </div>
                        <Badge variant="outline">
                          {formatCurrency(stats.revenue)}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Profiles Tab */}
        {activeTab === 'profiles' && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Service Profiles</CardTitle>
                <p className="text-gray-600 text-sm">
                  Switch the pricing and service tiers offered to new clients. Existing sessions keep their original terms.
                </p>
              </CardHeader>
            </Card>

            {profilesLoading ? (
              <Card><CardContent className="py-10 text-center text-gray-500">Loading profiles…</CardContent></Card>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {profilesData?.profiles.map((profile) => (
                  <Card key={profile.id} className={profile.isActive ? "border-blue-500 ring-1 ring-blue-500" : ""}>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <CardTitle>{profile.name}</CardTitle>
                          <p className="text-gray-600 text-sm mt-2">{profile.description}</p>
                        </div>
                        {profile.isActive ? <Badge>Active</Badge> : <Badge variant="outline">{profile.tierCount} tiers</Badge>}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        {profile.pricing.tiers.filter((tier) => tier.enabled !== false).map((tier) => (
                          <div key={tier.id} className="flex items-center justify-between rounded-lg bg-slate-50 p-3 text-sm">
                            <div>
                              <div className="font-medium">{tier.name}</div>
                              <div className="text-gray-500">
                                {tier.durationHours}h · {tier.speedMbps} Mbps · {formatBytes(tier.dataLimitMB)}
                              </div>
                            </div>
                            <Badge variant={tier.isFree ? "secondary" : "outline"}>
                              {tier.isFree ? "Free" : `${tier.price || 0} ${profile.pricing.currency || "MESH"}`}
                            </Badge>
                          </div>
                        ))}
                      </div>

                      {profile.isActive ? (
                        <Button className="w-full" disabled>Currently Active</Button>
                      ) : (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button className="w-full" disabled={activateProfileMutation.isPending}>
                              Activate Profile
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Activate {profile.name}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                New portal visitors will immediately see this profile. Existing client sessions will not change.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => activateProfileMutation.mutate(profile.id)}>
                                Activate
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Edit Session Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Session</DialogTitle>
            <DialogDescription>
              Update session details and settings
            </DialogDescription>
          </DialogHeader>

          {editingRecord && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select
                  value={editFormData.status as string}
                  onValueChange={(value) => handleFormChange('status', value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="dataUsedMB">Data Used (MB)</Label>
                <Input
                  id="dataUsedMB"
                  type="number"
                  value={editFormData.dataUsedMB as number}
                  onChange={(e) => handleFormChange('dataUsedMB', parseInt(e.target.value))}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="dataLimitMB">Data Limit (MB)</Label>
                <Input
                  id="dataLimitMB"
                  type="number"
                  value={editFormData.dataLimitMB as number}
                  onChange={(e) => handleFormChange('dataLimitMB', parseInt(e.target.value))}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="speedMbps">Speed (Mbps)</Label>
                <Input
                  id="speedMbps"
                  value={editFormData.speedMbps as string}
                  onChange={(e) => handleFormChange('speedMbps', e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="expiryDate">Expiry Date</Label>
                <Input
                  id="expiryDate"
                  type="datetime-local"
                  value={editFormData.expiryDate ? new Date(editFormData.expiryDate as string).toISOString().slice(0, 16) : ''}
                  onChange={(e) => handleFormChange('expiryDate', new Date(e.target.value).toISOString())}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleUpdateRecord}
              disabled={updateSessionMutation.isPending}
            >
              {updateSessionMutation.isPending ? "Updating..." : "Update Session"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
