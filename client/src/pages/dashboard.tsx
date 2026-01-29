import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WalletConnect } from "@/components/wallet-connect";
import { HotspotStatus } from "@/components/hotspot-status";
import { NetworkSelector } from "@/components/network-selector";
import { useWallet } from "@/hooks/use-wallet";
import { Link } from "wouter";
import { Wifi, Activity, Database, TrendingUp } from "lucide-react";

export default function Dashboard() {
  const { wallet } = useWallet();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-8">
              <Link href="/">
                <div className="flex items-center space-x-2 cursor-pointer">
                  <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
                    <Wifi className="w-5 h-5 text-white" />
                  </div>
                  <span className="text-xl font-bold text-gray-900">HotspotShare</span>
                </div>
              </Link>
              <nav className="hidden md:flex space-x-6">
                <Link href="/" className="text-gray-600 hover:text-blue-600 transition-colors">
                  <a>Home</a>
                </Link>
                <Link href="/dashboard" className="text-blue-600 font-medium">
                  <a>Dashboard</a>
                </Link>
              </nav>
            </div>
            <WalletConnect />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Dashboard</h1>
          <p className="text-gray-600">
            Monitor your hotspot sessions and network activity
          </p>
        </div>

        {!wallet.isConnected ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Wifi className="w-16 h-16 mx-auto mb-6 text-gray-400" />
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Connect Your Wallet</h2>
              <p className="text-gray-600 mb-6">
                Connect your wallet to view your hotspot sessions and manage your access
              </p>
              <WalletConnect />
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Active Sessions</CardTitle>
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">1</div>
                  <p className="text-xs text-muted-foreground">
                    Currently active
                  </p>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Data Usage</CardTitle>
                  <Database className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">2.1GB</div>
                  <p className="text-xs text-muted-foreground">
                    This month
                  </p>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Spent</CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">$19.99</div>
                  <p className="text-xs text-muted-foreground">
                    All time
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Network Selection */}
            <div>
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Network Selection</h2>
              <NetworkSelector />
            </div>

            {/* Hotspot Sessions */}
            <div>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-gray-900">Your Sessions</h2>
                <Link href="/">
                  <a className="text-sm text-blue-600 hover:text-blue-700">
                    Buy More Bandwidth →
                  </a>
                </Link>
              </div>
              <HotspotStatus />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
