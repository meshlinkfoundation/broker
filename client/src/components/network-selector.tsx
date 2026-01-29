import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/use-wallet";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { L2Network } from "@shared/schema";

export function NetworkSelector() {
  const { wallet, switchNetwork, getCurrentNetwork } = useWallet();
  const currentNetwork = getCurrentNetwork();

  const { data: networks, isLoading } = useQuery<L2Network[]>({
    queryKey: ["/api/networks"],
    enabled: true,
  });

  const handleNetworkSelect = async (chainId: number) => {
    if (!wallet.isConnected) return;
    
    try {
      await switchNetwork(chainId);
    } catch (error) {
      console.error("Failed to switch network:", error);
    }
  };

  if (isLoading) {
    return (
      <div className="grid md:grid-cols-3 gap-6">
        {[1, 2, 3].map((i) => (
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

  return (
    <div className="grid md:grid-cols-3 gap-6">
      {networks?.map((network) => {
        const isSelected = currentNetwork?.chainId === network.chainId;
        const canSelect = wallet.isConnected;

        return (
          <Card 
            key={network.id} 
            className={`cursor-pointer transition-all duration-200 hover:shadow-md ${
              isSelected ? 'ring-2 ring-blue-500 bg-blue-50' : ''
            } ${!canSelect ? 'opacity-50' : ''}`}
            onClick={() => canSelect && handleNetworkSelect(network.chainId)}
          >
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-semibold">{network.name}</h3>
                {isSelected && (
                  <Badge className="bg-blue-600 text-white">Selected</Badge>
                )}
              </div>
              
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Transaction Fee</span>
                  <span className="font-medium">${network.gasPrice}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Confirmation Time</span>
                  <span className="font-medium">~{network.confirmationTime}s</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Chain ID</span>
                  <span className="font-medium">{network.chainId}</span>
                </div>
              </div>

              {!wallet.isConnected && (
                <div className="mt-4 text-center">
                  <span className="text-sm text-gray-500">Connect wallet to select</span>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
