import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { WalletConnect } from "@/components/wallet-connect";
import { NetworkSelector } from "@/components/network-selector";
import { PaymentInterface } from "@/components/payment-interface";
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@/hooks/use-wallet";
import { Link } from "wouter";
import { 
  Wifi, 
  Zap, 
  Shield, 
  Globe, 
  ArrowRight, 
  Check,
  Coins,
  Clock
} from "lucide-react";
import type { BandwidthPackage } from "@shared/schema";

export default function Home() {
  const [selectedPackage, setSelectedPackage] = useState<BandwidthPackage | undefined>();
  const [showPayment, setShowPayment] = useState(false);
  const { wallet } = useWallet();

  const { data: packages, isLoading } = useQuery<BandwidthPackage[]>({
    queryKey: ["/api/packages"],
  });

  const handleSelectPackage = (pkg: BandwidthPackage) => {
    setSelectedPackage(pkg);
    setShowPayment(true);
  };

  const handlePaymentComplete = () => {
    setShowPayment(false);
    setSelectedPackage(undefined);
  };

  if (showPayment && selectedPackage) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
                  <Wifi className="w-5 h-5 text-white" />
                </div>
                <span className="text-xl font-bold text-gray-900">HotspotShare</span>
              </div>
              <WalletConnect />
            </div>
          </div>
        </header>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-6">
            <Button
              variant="outline"
              onClick={() => setShowPayment(false)}
            >
              ← Back to Packages
            </Button>
          </div>
          <PaymentInterface 
            selectedPackage={selectedPackage}
            onPaymentComplete={handlePaymentComplete}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-8">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
                  <Wifi className="w-5 h-5 text-white" />
                </div>
                <span className="text-xl font-bold text-gray-900">HotspotShare</span>
              </div>
              <nav className="hidden md:flex space-x-6">
                <Link href="/" className="text-gray-600 hover:text-blue-600 transition-colors">
                  <a>Home</a>
                </Link>
                <Link href="/dashboard" className="text-gray-600 hover:text-blue-600 transition-colors">
                  <a>Dashboard</a>
                </Link>
                <a href="#pricing" className="text-gray-600 hover:text-blue-600 transition-colors">Pricing</a>
                <a href="#features" className="text-gray-600 hover:text-blue-600 transition-colors">Features</a>
              </nav>
            </div>
            <WalletConnect />
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative bg-gradient-to-br from-blue-50 via-purple-50 to-green-50 pt-16 pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-8">
              <div className="space-y-4">
                <Badge className="bg-purple-100 text-purple-700 border-purple-200">
                  <Zap className="w-4 h-4 mr-1" />
                  Powered by Ethereum L2
                </Badge>
                <h1 className="text-4xl lg:text-6xl font-bold text-gray-900 leading-tight">
                  WiFi Access,
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-purple-600">
                    {" "}Crypto Payments
                  </span>
                </h1>
                <p className="text-xl text-gray-600 leading-relaxed">
                  Access premium hotspot bandwidth with fast, low-cost crypto payments. 
                  Powered by Ethereum L2 networks for instant transactions.
                </p>
              </div>
              
              <div className="flex flex-col sm:flex-row gap-4">
                <Button 
                  size="lg" 
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                  onClick={() => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' })}
                >
                  Get Started
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
                <Link href="/dashboard">
                  <Button variant="outline" size="lg">
                    View Dashboard
                  </Button>
                </Link>
              </div>
              
              {/* Key Stats */}
              <div className="grid grid-cols-3 gap-6 pt-8">
                <div className="text-center">
                  <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mx-auto mb-2">
                    <Zap className="w-6 h-6 text-green-600" />
                  </div>
                  <div className="text-sm text-gray-600">Fast Transactions</div>
                  <div className="text-lg font-semibold text-gray-900">&lt;2 seconds</div>
                </div>
                <div className="text-center">
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-2">
                    <Coins className="w-6 h-6 text-blue-600" />
                  </div>
                  <div className="text-sm text-gray-600">Low Fees</div>
                  <div className="text-lg font-semibold text-gray-900">$0.01</div>
                </div>
                <div className="text-center">
                  <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mx-auto mb-2">
                    <Shield className="w-6 h-6 text-purple-600" />
                  </div>
                  <div className="text-sm text-gray-600">Secure</div>
                  <div className="text-lg font-semibold text-gray-900">L2 Protected</div>
                </div>
              </div>
            </div>
            
            <div className="relative">
              <img 
                src="https://images.unsplash.com/photo-1563013544-824ae1b704d3?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&h=600" 
                alt="Modern smartphone displaying wifi connection interface" 
                className="rounded-2xl shadow-2xl w-full h-auto"
              />
              
              {/* Floating UI Elements */}
              <div className="absolute -top-4 -right-4 bg-white p-4 rounded-xl shadow-lg border border-gray-200">
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="text-sm font-medium">Transaction Confirmed</span>
                </div>
              </div>
              
              <div className="absolute -bottom-4 -left-4 bg-white p-4 rounded-xl shadow-lg border border-gray-200">
                <div className="flex items-center space-x-2">
                  <Wifi className="w-4 h-4 text-blue-600" />
                  <span className="text-sm font-medium">High-Speed Access</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Network Selection */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Choose Your Network</h2>
            <p className="text-xl text-gray-600">Select the Ethereum L2 network that works best for you</p>
          </div>
          
          <NetworkSelector />
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-16 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Flexible Bandwidth Plans</h2>
            <p className="text-xl text-gray-600">Choose the plan that fits your needs. Pay with crypto, cancel anytime.</p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            {isLoading ? (
              // Loading skeletons
              [1, 2, 3].map((i) => (
                <Card key={i} className="animate-pulse">
                  <CardContent className="p-8">
                    <div className="h-6 bg-gray-200 rounded mb-4" />
                    <div className="h-8 bg-gray-200 rounded mb-6" />
                    <div className="space-y-3">
                      {[1, 2, 3, 4].map((j) => (
                        <div key={j} className="h-4 bg-gray-200 rounded" />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : (
              packages?.map((pkg, index) => {
                const isPopular = index === 1; // Make the second package popular
                
                return (
                  <Card 
                    key={pkg.id} 
                    className={`relative hover:shadow-xl transition-shadow duration-200 ${
                      isPopular ? 'border-2 border-blue-500' : ''
                    }`}
                  >
                    {isPopular && (
                      <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                        <Badge className="bg-blue-600 text-white">Most Popular</Badge>
                      </div>
                    )}
                    
                    <CardHeader className="text-center pb-2">
                      <CardTitle className="text-2xl font-bold text-gray-900 mb-2">
                        {pkg.name}
                      </CardTitle>
                      <p className="text-gray-600 mb-4">{pkg.description}</p>
                      <div className="text-4xl font-bold text-gray-900 mb-2">
                        ${pkg.priceUSD}
                      </div>
                      <div className="text-gray-500">one-time payment</div>
                    </CardHeader>
                    
                    <CardContent className="space-y-6">
                      <ul className="space-y-3">
                        <li className="flex items-center space-x-3">
                          <Check className="w-5 h-5 text-green-600" />
                          <span className="text-gray-700">
                            {pkg.dataLimitMB / 1024}GB high-speed data
                          </span>
                        </li>
                        <li className="flex items-center space-x-3">
                          <Check className="w-5 h-5 text-green-600" />
                          <span className="text-gray-700">
                            {Math.floor(pkg.durationHours / 24)} days access
                          </span>
                        </li>
                        <li className="flex items-center space-x-3">
                          <Check className="w-5 h-5 text-green-600" />
                          <span className="text-gray-700">Unlimited device connections</span>
                        </li>
                        <li className="flex items-center space-x-3">
                          <Check className="w-5 h-5 text-green-600" />
                          <span className="text-gray-700">24/7 network monitoring</span>
                        </li>
                        <li className="flex items-center space-x-3">
                          <Check className="w-5 h-5 text-green-600" />
                          <span className="text-gray-700">Instant activation</span>
                        </li>
                      </ul>
                      
                      <Button
                        onClick={() => handleSelectPackage(pkg)}
                        className={`w-full py-3 font-semibold transition-colors duration-200 ${
                          isPopular
                            ? 'bg-blue-600 hover:bg-blue-700 text-white'
                            : 'bg-gray-200 hover:bg-gray-300 text-gray-800'
                        }`}
                      >
                        Choose {pkg.name}
                      </Button>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-16 bg-gradient-to-br from-blue-50 to-purple-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Why Choose HotspotShare?</h2>
            <p className="text-xl text-gray-600">Built for the future of decentralized internet access</p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Zap className="w-8 h-8 text-blue-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Lightning Fast</h3>
              <p className="text-gray-600">Transactions complete in seconds with L2 networks</p>
            </div>
            
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Shield className="w-8 h-8 text-green-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Secure</h3>
              <p className="text-gray-600">Built on proven Ethereum security infrastructure</p>
            </div>
            
            <div className="text-center">
              <div className="w-16 h-16 bg-purple-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Coins className="w-8 h-8 text-purple-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Low Fees</h3>
              <p className="text-gray-600">Pay pennies for transactions instead of dollars</p>
            </div>
            
            <div className="text-center">
              <div className="w-16 h-16 bg-yellow-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Globe className="w-8 h-8 text-yellow-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Global Access</h3>
              <p className="text-gray-600">Available worldwide with crypto payments</p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-300 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-8">
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
                  <Wifi className="w-5 h-5 text-white" />
                </div>
                <span className="text-xl font-bold text-white">HotspotShare</span>
              </div>
              <p className="text-gray-400">Decentralized WiFi access powered by crypto payments and Ethereum L2 networks.</p>
            </div>
            
            <div>
              <h3 className="text-white font-semibold mb-4">Product</h3>
              <ul className="space-y-2">
                <li><a href="#" className="text-gray-400 hover:text-white transition-colors">Hotspot Access</a></li>
                <li><a href="#pricing" className="text-gray-400 hover:text-white transition-colors">Pricing</a></li>
                <li><a href="#features" className="text-gray-400 hover:text-white transition-colors">Features</a></li>
                <li><Link href="/dashboard"><a className="text-gray-400 hover:text-white transition-colors">Dashboard</a></Link></li>
              </ul>
            </div>
            
            <div>
              <h3 className="text-white font-semibold mb-4">Support</h3>
              <ul className="space-y-2">
                <li><a href="#" className="text-gray-400 hover:text-white transition-colors">Help Center</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition-colors">Contact</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition-colors">Network Status</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition-colors">Security</a></li>
              </ul>
            </div>
            
            <div>
              <h3 className="text-white font-semibold mb-4">Legal</h3>
              <ul className="space-y-2">
                <li><a href="#" className="text-gray-400 hover:text-white transition-colors">Terms</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition-colors">Privacy</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition-colors">Cookies</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition-colors">Licenses</a></li>
              </ul>
            </div>
          </div>
          
          <div className="border-t border-gray-800 mt-8 pt-8 flex flex-col md:flex-row justify-between items-center">
            <p className="text-gray-400 text-sm">© 2024 HotspotShare. All rights reserved.</p>
            <div className="flex space-x-6 mt-4 md:mt-0">
              <a href="#" className="text-gray-400 hover:text-white transition-colors">
                <i className="fab fa-twitter"></i>
              </a>
              <a href="#" className="text-gray-400 hover:text-white transition-colors">
                <i className="fab fa-discord"></i>
              </a>
              <a href="#" className="text-gray-400 hover:text-white transition-colors">
                <i className="fab fa-github"></i>
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
