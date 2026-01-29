import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wallet, Loader2 } from "lucide-react";
import { useWallet } from "@/hooks/use-wallet";

export function WalletConnect() {
  const { wallet, isConnecting, connectWallet, disconnectWallet, getCurrentNetwork } = useWallet();
  const currentNetwork = getCurrentNetwork();

  const handleConnect = async () => {
    try {
      await connectWallet();
    } catch (error) {
      console.error("Failed to connect wallet:", error);
    }
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  if (wallet.isConnected && wallet.address) {
    return (
      <div className="flex items-center space-x-4">
        {currentNetwork && (
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
            <div className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse" />
            {currentNetwork.name}
          </Badge>
        )}
        <Button
          variant="outline"
          onClick={disconnectWallet}
          className="font-mono"
        >
          <Wallet className="w-4 h-4 mr-2" />
          {formatAddress(wallet.address)}
        </Button>
      </div>
    );
  }

  return (
    <Button
      onClick={handleConnect}
      disabled={isConnecting}
      className="bg-blue-600 hover:bg-blue-700 text-white"
    >
      {isConnecting ? (
        <>
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          Connecting...
        </>
      ) : (
        <>
          <Wallet className="w-4 h-4 mr-2" />
          Connect Wallet
        </>
      )}
    </Button>
  );
}
