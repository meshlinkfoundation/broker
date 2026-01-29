import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Database, Edit, Trash2, Plus, RefreshCw, Search } from "lucide-react";

interface AccessSession {
  id: number;
  sessionGuid: string;
  userIdentifier: string;
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

interface EditFormData {
  [key: string]: string | number | boolean;
}

export default function DatabaseManager() {
  const [activeTab, setActiveTab] = useState("sessions");
  const [searchTerm, setSearchTerm] = useState("");
  const [editingRecord, setEditingRecord] = useState<any>(null);
  const [editFormData, setEditFormData] = useState<EditFormData>({});
  const [showEditDialog, setShowEditDialog] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch access sessions
  const { data: sessions, isLoading: sessionsLoading, refetch: refetchSessions } = useQuery({
    queryKey: ["/api/admin/sessions"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/admin/sessions");
      if (!response.ok) throw new Error("Failed to fetch sessions");
      const data = await response.json();
      return data.sessions || [];
    },
  });

  // Fetch network clients
  const { data: networkClients, isLoading: clientsLoading, refetch: refetchClients } = useQuery({
    queryKey: ["/api/network/clients"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/network/clients");
      if (!response.ok) throw new Error("Failed to fetch network clients");
      const data = await response.json();
      return data.clients || [];
    },
  });

  // Delete session mutation
  const deleteSessionMutation = useMutation({
    mutationFn: async (sessionId: number) => {
      const response = await apiRequest("DELETE", `/api/admin/sessions/${sessionId}`);
      if (!response.ok) throw new Error("Failed to delete session");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/sessions"] });
      toast({ title: "Success", description: "Session deleted successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete session", variant: "destructive" });
    }
  });

  // Update session mutation
  const updateSessionMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: EditFormData }) => {
      const response = await apiRequest("PUT", `/api/admin/sessions/${id}`, data);
      if (!response.ok) throw new Error("Failed to update session");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/sessions"] });
      setShowEditDialog(false);
      setEditingRecord(null);
      toast({ title: "Success", description: "Session updated successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update session", variant: "destructive" });
    }
  });

  // Remove network client mutation
  const removeClientMutation = useMutation({
    mutationFn: async (clientIp: string) => {
      const response = await apiRequest("DELETE", `/api/network/clients/${clientIp}`);
      if (!response.ok) throw new Error("Failed to remove client");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/network/clients"] });
      toast({ title: "Success", description: "Client removed from network tier" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to remove client", variant: "destructive" });
    }
  });

  const handleEditRecord = (record: any) => {
    setEditingRecord(record);
    setEditFormData(record);
    setShowEditDialog(true);
  };

  const handleFormChange = (field: string, value: string | number | boolean) => {
    setEditFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleUpdateRecord = () => {
    if (editingRecord && activeTab === "sessions") {
      updateSessionMutation.mutate({ id: editingRecord.id, data: editFormData });
    }
  };

  const filteredSessions = sessions?.filter((session: AccessSession) => 
    session.userIdentifier.toLowerCase().includes(searchTerm.toLowerCase()) ||
    session.sessionGuid.toLowerCase().includes(searchTerm.toLowerCase()) ||
    session.tierName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    session.paymentMethod.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  const filteredClients = networkClients?.filter((client: any) => 
    client.ip.includes(searchTerm) ||
    client.tier.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (client.mac && client.mac.toLowerCase().includes(searchTerm.toLowerCase()))
  ) || [];

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Database className="w-8 h-8" />
            Database Manager
          </h1>
          <p className="text-gray-600 mt-2">View, edit, and manage database records</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => { refetchSessions(); refetchClients(); }} variant="outline">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Database Records</CardTitle>
              <CardDescription>Manage access sessions and network clients</CardDescription>
            </div>
            <div className="flex items-center space-x-2">
              <Search className="w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search records..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-64"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="sessions">Access Sessions ({filteredSessions.length})</TabsTrigger>
              <TabsTrigger value="clients">Network Clients ({filteredClients.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="sessions" className="space-y-4">
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Session GUID</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Tier</TableHead>
                      <TableHead>Payment</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Data Usage</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessionsLoading ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8">Loading sessions...</TableCell>
                      </TableRow>
                    ) : filteredSessions.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8">No sessions found</TableCell>
                      </TableRow>
                    ) : (
                      filteredSessions.map((session: AccessSession) => (
                        <TableRow key={session.id}>
                          <TableCell className="font-mono text-xs">
                            {session.sessionGuid.substring(0, 20)}...
                          </TableCell>
                          <TableCell>{session.userIdentifier}</TableCell>
                          <TableCell>
                            <Badge variant={session.tierId === 'free' ? 'secondary' : 'default'}>
                              {session.tierName}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={session.paymentMethod === 'free' ? 'outline' : 'default'}>
                              {session.paymentMethod}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={session.status === 'active' ? 'default' : 'destructive'}>
                              {session.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {session.dataUsedMB} / {session.dataLimitMB} MB
                          </TableCell>
                          <TableCell className="text-xs">
                            {new Date(session.expiryDate).toLocaleDateString()}
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
                                      Are you sure you want to delete this session? This action cannot be undone.
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
            </TabsContent>

            <TabsContent value="clients" className="space-y-4">
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>IP Address</TableHead>
                      <TableHead>MAC Address</TableHead>
                      <TableHead>Tier</TableHead>
                      <TableHead>Bandwidth Limits</TableHead>
                      <TableHead>Session</TableHead>
                      <TableHead>Expires</TableHead>
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
                        <TableCell colSpan={7} className="text-center py-8">No active clients found</TableCell>
                      </TableRow>
                    ) : (
                      filteredClients.map((client: any, index: number) => (
                        <TableRow key={index}>
                          <TableCell className="font-mono">{client.ip}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {client.mac || 'Unknown'}
                          </TableCell>
                          <TableCell>
                            <Badge variant={client.tier === 'Free Access' ? 'secondary' : 'default'}>
                              {client.tier}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">
                            <div>↓ {client.downloadLimit}</div>
                            <div>↑ {client.uploadLimit}</div>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {client.sessionGuid.substring(0, 15)}...
                          </TableCell>
                          <TableCell className="text-xs">
                            {new Date(client.expiryDate).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="sm" variant="destructive">
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Remove Client</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Remove {client.ip} from the network tier? This will immediately block their internet access.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction 
                                    onClick={() => removeClientMutation.mutate(client.ip)}
                                    className="bg-red-600 hover:bg-red-700"
                                  >
                                    Remove
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
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
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