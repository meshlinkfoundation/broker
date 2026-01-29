import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Wifi, Clock, Database, Zap } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@/hooks/use-wallet";
import type { HotspotSession, BandwidthPackage } from "@shared/schema";

export function HotspotStatus() {
  const { wallet } = useWallet();

  const { data: sessions, isLoading } = useQuery<HotspotSession[]>({
    queryKey: ["/api/user", wallet.address, "sessions"],
    enabled: !!wallet.address,
  });

  const { data: packages } = useQuery<BandwidthPackage[]>({
    queryKey: ["/api/packages"],
  });

  if (!wallet.isConnected) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <Wifi className="w-12 h-12 mx-auto mb-4 text-gray-400" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Connect Wallet</h3>
          <p className="text-gray-600">Connect your wallet to view your hotspot sessions</p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="p-6">
              <div className="h-6 bg-gray-200 rounded mb-4" />
              <div className="space-y-2">
                <div className="h-4 bg-gray-200 rounded" />
                <div className="h-4 bg-gray-200 rounded" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const activeSessions = sessions?.filter(session => session.status === 'active') || [];
  const pendingSessions = sessions?.filter(session => session.status === 'pending') || [];

  const getPackageById = (id: number) => packages?.find(pkg => pkg.id === id);

  const formatTimeRemaining = (endTime: string | null) => {
    if (!endTime) return "N/A";
    
    const end = new Date(endTime);
    const now = new Date();
    const diff = end.getTime() - now.getTime();
    
    if (diff <= 0) return "Expired";
    
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    return `${hours}h ${minutes}m`;
  };

  const calculateDataUsagePercentage = (used: number, limit: number) => {
    return Math.min((used / limit) * 100, 100);
  };

  if (sessions?.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <Database className="w-12 h-12 mx-auto mb-4 text-gray-400" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No Active Sessions</h3>
          <p className="text-gray-600">Purchase a bandwidth package to get started</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Active Sessions */}
      {activeSessions.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-900">Active Sessions</h3>
          {activeSessions.map((session) => {
            const pkg = getPackageById(session.packageId);
            if (!pkg) return null;

            const dataUsagePercent = calculateDataUsagePercentage(session.dataUsedMB, pkg.dataLimitMB);

            return (
              <Card key={session.id} className="border-green-200 bg-green-50">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center space-x-2 text-green-800">
                      <Wifi className="w-5 h-5" />
                      <span>{pkg.name} Package</span>
                    </CardTitle>
                    <Badge className="bg-green-600 text-white">Active</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div className="flex items-center space-x-2">
                      <Database className="w-4 h-4 text-green-600" />
                      <div>
                        <div className="text-green-700">Data Used</div>
                        <div className="font-medium">
                          {session.dataUsedMB}MB / {pkg.dataLimitMB}MB
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Clock className="w-4 h-4 text-green-600" />
                      <div>
                        <div className="text-green-700">Time Left</div>
                        <div className="font-medium">{formatTimeRemaining(session.endTime)}</div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Zap className="w-4 h-4 text-green-600" />
                      <div>
                        <div className="text-green-700">Speed</div>
                        <div className="font-medium">High Speed</div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div>
                        <div className="text-green-700">Session ID</div>
                        <div className="font-mono text-xs">{session.id}</div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-green-700">Data Usage</span>
                      <span className="font-medium">{dataUsagePercent.toFixed(1)}%</span>
                    </div>
                    <Progress 
                      value={dataUsagePercent} 
                      className="h-2"
                    />
                  </div>

                  {session.transactionHash && (
                    <div className="bg-white rounded p-3 border border-green-200">
                      <div className="text-xs text-green-700 mb-1">Transaction Hash</div>
                      <div className="font-mono text-xs text-green-800 break-all">
                        {session.transactionHash}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Pending Sessions */}
      {pendingSessions.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-900">Pending Sessions</h3>
          {pendingSessions.map((session) => {
            const pkg = getPackageById(session.packageId);
            if (!pkg) return null;

            return (
              <Card key={session.id} className="border-yellow-200 bg-yellow-50">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center space-x-2 text-yellow-800">
                      <Clock className="w-5 h-5" />
                      <span>{pkg.name} Package</span>
                    </CardTitle>
                    <Badge variant="outline" className="border-yellow-600 text-yellow-800">
                      Pending
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-yellow-700 mb-3">
                    Your payment is being processed. This usually takes a few seconds.
                  </p>
                  {session.transactionHash && (
                    <div className="bg-white rounded p-3 border border-yellow-200">
                      <div className="text-xs text-yellow-700 mb-1">Transaction Hash</div>
                      <div className="font-mono text-xs text-yellow-800 break-all">
                        {session.transactionHash}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
