import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { 
  Users, 
  Activity, 
  DollarSign, 
  Database, 
  Clock,
  Shield,
  Eye,
  LogOut,
  Wifi,
  TrendingUp
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
  recentSessions: Array<{
    sessionGuid: string;
    tierName: string;
    paymentMethod: string;
    status: string;
    dataUsedMB: number;
    createdAt: string;
    expiryDate: string;
  }>;
}

interface Session {
  sessionGuid: string;
  userIdentifier: string;
  tierName: string;
  paymentMethod: string;
  status: string;
  dataLimitMB: number;
  dataUsedMB: number;
  speedMbps: string;
  startDate: string;
  expiryDate: string;
  createdAt: string;
}

export default function AdminDashboard() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [isLogging, setIsLogging] = useState(false);
  const [authToken, setAuthToken] = useState("");
  const [nodeInfo, setNodeInfo] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'sessions' | 'analytics'>('overview');
  
  const { toast } = useToast();

  // Check for existing auth token
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
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();

      if (response.ok) {
        setAuthToken(data.token);
        setNodeInfo(data.nodeInfo);
        setIsAuthenticated(true);
        localStorage.setItem('admin_token', data.token);
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
    setIsAuthenticated(false);
    setAuthToken("");
    setPassword("");
    localStorage.removeItem('admin_token');
    toast({
      title: "Logged Out",
      description: "Successfully logged out of admin dashboard",
    });
  };

  // Fetch analytics data
  const { data: analytics, isLoading: analyticsLoading } = useQuery<Analytics>({
    queryKey: ["/api/admin/analytics"],
    queryFn: async () => {
      const response = await fetch('/api/admin/analytics', {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });
      if (!response.ok) {
        throw new Error('Failed to fetch analytics');
      }
      return response.json();
    },
    enabled: isAuthenticated && !!authToken,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch sessions data
  const { data: sessionsData, isLoading: sessionsLoading } = useQuery<{
    sessions: Session[];
    total: number;
  }>({
    queryKey: ["/api/admin/sessions"],
    queryFn: async () => {
      const response = await fetch('/api/admin/sessions?limit=20', {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });
      if (!response.ok) {
        throw new Error('Failed to fetch sessions');
      }
      return response.json();
    },
    enabled: isAuthenticated && !!authToken,
    refetchInterval: 15000, // Refresh every 15 seconds
  });

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
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              {nodeInfo?.name || 'MeshLink'} Dashboard
            </h1>
            <p className="text-gray-600">
              {nodeInfo?.location} • Operated by {nodeInfo?.operator}
            </p>
          </div>
          <div className="flex items-center space-x-4">
            <div className="flex space-x-2">
              <Button
                variant={activeTab === 'overview' ? 'default' : 'outline'}
                onClick={() => setActiveTab('overview')}
                size="sm"
              >
                Overview
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
                variant="outline"
                onClick={() => window.location.href = '/admin/database'}
                size="sm"
              >
                <Database className="w-4 h-4 mr-2" />
                Database
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
            {/* Key Metrics */}
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

            {/* Recent Activity */}
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
                            {session.paymentMethod} • {formatBytes(session.dataUsedMB)}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <Badge className={getStatusColor(session.status)}>
                          {session.status}
                        </Badge>
                        <p className="text-xs text-gray-500 mt-1">
                          {new Date(session.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Sessions Tab */}
        {activeTab === 'sessions' && (
          <Card>
            <CardHeader>
              <CardTitle>Active Sessions</CardTitle>
              <p className="text-gray-600">Real-time session monitoring</p>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {sessionsData?.sessions.map((session) => (
                  <div key={session.sessionGuid} className="border rounded-lg p-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <p className="font-medium">{session.tierName}</p>
                        <p className="text-sm text-gray-600">
                          User: {session.userIdentifier.substring(0, 16)}...
                        </p>
                        <p className="text-sm text-gray-600">
                          Speed: {session.speedMbps} Mbps
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-600">Data Usage</p>
                        <Progress 
                          value={(session.dataUsedMB / session.dataLimitMB) * 100} 
                          className="w-full mt-1"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          {formatBytes(session.dataUsedMB)} / {formatBytes(session.dataLimitMB)}
                        </p>
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <Badge className={getStatusColor(session.status)}>
                            {session.status}
                          </Badge>
                          <p className="text-xs text-gray-500 mt-1">
                            Expires: {new Date(session.expiryDate).toLocaleString()}
                          </p>
                        </div>
                        <Badge variant="outline">
                          {session.paymentMethod}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Analytics Tab */}
        {activeTab === 'analytics' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Payment Methods */}
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

              {/* Tier Performance */}
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
      </div>
    </div>
  );
}