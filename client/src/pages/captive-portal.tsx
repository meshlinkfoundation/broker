import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { WalletConnect } from "@/components/wallet-connect";
import { useWallet } from "@/hooks/use-wallet";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import {
  Wifi,
  Users,
  Globe,
  ArrowRight,
  CheckCircle,
  Clock,
  Shield,
  CreditCard,
  Wallet,
  Smartphone
} from "lucide-react";
import { web3Provider } from "@/lib/web3-mock";

interface ConfigTier {
  id: string;
  name: string;
  description: string;
  price: number;
  fiatPrice: number;
  dataLimitMB: number;
  durationHours: number;
  speedMbps: number | string;
  features: string[];
  buttonText: string;
  buttonColor: string;
  isFree: boolean;
  isPopular: boolean;
  acceptStripePayments: boolean;
  acceptCryptoPayments: boolean;
  stripePaymentLink?: string;
}

interface CryptoNetworkConfig {
  chainId: number;
  chainName: string;
  rpcUrl: string;
  contractAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
}

interface PaymentsConfig {
  stripe: {
    enabled: boolean;
    paymentMethods: Array<'card' | 'apple_pay' | 'google_pay' | 'link'>;
    currency: string;
  };
  crypto: {
    enabled: boolean;
    network: CryptoNetworkConfig;
  };
}

interface NodeConfig {
  nodeInfo: {
    name: string;
    location: string;
    operator: string;
  };
  pricing: {
    currency: string;
    fiatCurrency: string;
    tiers: ConfigTier[];
  };
  network: {
    contractAddress: string;
    chainId: number;
    chainName: string;
    rpcUrl: string;
  };
  branding: {
    primaryColor: string;
    secondaryColor: string;
    logoText: string;
    tagline: string;
    showCommunityBadge: boolean;
  };
  features: {
    enableCrypto: boolean;
    enableWalletConnection: boolean;
    requireWalletForPremium: boolean;
    showTransactionDetails: boolean;
    redirectAfterPayment: string;
  };
  stripe: {
    enabled: boolean;
    expressCheckout: boolean;
    currency: string;
  };
  payments?: PaymentsConfig;
}

export default function CaptivePortal() {
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [paymentStep, setPaymentStep] = useState<'select' | 'method' | 'paying' | 'confirming' | 'complete'>('select');
  const [paymentMethod, setPaymentMethod] = useState<'stripe' | 'crypto' | null>(null);
  const [transactionHash, setTransactionHash] = useState<string>('');
  const [accessSession, setAccessSession] = useState<any>(null);
  
  const { wallet, getCurrentNetwork, switchNetwork } = useWallet();
  const { toast } = useToast();
  const currentNetwork = getCurrentNetwork();

  // Load node configuration
  const { data: config, isLoading: configLoading } = useQuery<NodeConfig>({
    queryKey: ["/api/config"],
  });

  // Load live network status
  const { data: networkStatus } = useQuery<{
    connectedClients: number;
    clients: Array<{
      ip: string;
      tier: string;
      expiryDate: string;
    }>;
  }>({
    queryKey: ["/api/network/status"],
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  // Check for payment success on page load
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const paymentSuccess = urlParams.get('payment_success');
    const tierId = urlParams.get('tier_id');
    const userId = urlParams.get('user_id');

    if (paymentSuccess === 'true' && tierId && userId) {
      handlePaymentSuccess(tierId, userId);
    }
  }, []);

  const handlePaymentSuccess = async (tierId: string, userId: string) => {
    try {
      setPaymentStep('confirming');
      setIsConnecting(true);

      // Complete payment and create access session
      const response = await fetch('/api/complete-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tierId,
          userIdentifier: userId,
          paymentMethod: 'stripe',
          paymentReference: `stripe_${Date.now()}`
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to complete payment');
      }

      const sessionData = await response.json();
      setAccessSession(sessionData);
      setPaymentStep('complete');

      toast({
        title: "Payment Successful!",
        description: `Access granted for ${sessionData.tierName}`,
      });

      // Clean up URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);

      // Redirect to internet after delay
      setTimeout(() => {
        window.location.href = config?.features.redirectAfterPayment || "https://www.google.com";
      }, 3000);

    } catch (error) {
      setIsConnecting(false);
      setPaymentStep('select');
      toast({
        title: "Payment Processing Failed",
        description: "Please contact support or try again.",
        variant: "destructive",
      });
    }
  };

  const handleConnect = async (planId: string) => {
    setSelectedPlan(planId);
    
    if (!config) return;
    
    const tier = config.pricing.tiers.find(t => t.id === planId);
    if (!tier) return;
    
    if (tier.isFree) {
      await processFreeAccess(tier);
      return;
    }

    // Check available payment methods
    const hasStripe = tier.acceptStripePayments;
    const hasCrypto = tier.acceptCryptoPayments;
    
    // If tier has multiple payment methods, show selection
    if (hasStripe && hasCrypto) {
      setPaymentStep('method');
      return;
    }

    // Single payment method - proceed directly
    const method = hasStripe ? 'stripe' : 'crypto';
    setPaymentMethod(method);
    await initiatePayment(tier, method);
  };

  const handlePaymentMethodSelect = async (method: 'stripe' | 'crypto') => {
    setPaymentMethod(method);
    
    if (!config || !selectedPlan) return;
    
    const tier = config.pricing.tiers.find(t => t.id === selectedPlan);
    if (!tier) return;

    await initiatePayment(tier, method);
  };

  const initiatePayment = async (tier: ConfigTier, method: 'stripe' | 'crypto') => {
    if (method === 'stripe') {
      await processStripePayment(tier);
    } else {
      // For crypto payments, check wallet connection
      if (!wallet.isConnected) {
        toast({
          title: "Wallet Required",
          description: "Please connect your wallet to purchase with crypto.",
          variant: "destructive",
        });
        return;
      }

      // Use payments.crypto.network with fallback to top-level network
      const cryptoNetwork = config!.payments?.crypto?.network ?? config!.network;

      // Check if on correct network
      if (wallet.chainId !== cryptoNetwork.chainId) {
        try {
          await switchNetwork(cryptoNetwork.chainId);
          toast({
            title: "Network Switched",
            description: `Switched to ${cryptoNetwork.chainName} for crypto payments.`,
          });
        } catch (error) {
          toast({
            title: "Network Switch Failed",
            description: `Please manually switch to ${cryptoNetwork.chainName} network.`,
            variant: "destructive",
          });
          return;
        }
      }

      await processCryptoPayment(tier);
    }
  };

  const processStripePayment = async (tier: ConfigTier) => {
    try {
      setPaymentStep('paying');
      setIsConnecting(true);

      if (!tier.stripePaymentLink) {
        throw new Error('Stripe payment link not configured');
      }
      
      toast({
        title: "Payment Processing",
        description: "Redirecting to secure checkout...",
      });

      setPaymentStep('confirming');

      // Generate user identifier (in real app, this would be MAC address or device ID)
      const userIdentifier = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('meshlink_user_id', userIdentifier);
      localStorage.setItem('meshlink_tier_id', tier.id);

      // Create success URL that returns to our app for session creation
      const successUrl = encodeURIComponent(`${window.location.origin}/?payment_success=true&tier_id=${tier.id}&user_id=${userIdentifier}`);
      const checkoutUrl = `${tier.stripePaymentLink}?success_url=${successUrl}`;

      // Redirect to Stripe Payment Link
      window.location.href = checkoutUrl;

    } catch (error) {
      setIsConnecting(false);
      setPaymentStep('select');
      toast({
        title: "Payment Failed",
        description: "Unable to process payment. Please try again.",
        variant: "destructive",
      });
    }
  };

  const processFreeAccess = async (tier: ConfigTier) => {
    try {
      setIsConnecting(true);
      setPaymentStep('confirming');

      // Generate device identifier from available sources
      const deviceId = generateDeviceIdentifier();

      // Create free access session
      const response = await fetch('/api/complete-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tierId: tier.id,
          userIdentifier: deviceId,
          paymentMethod: 'free',
          paymentReference: `free_access_${Date.now()}`
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create free access session');
      }

      const sessionData = await response.json();
      setAccessSession(sessionData);
      setPaymentStep('complete');

      toast({
        title: "Free Access Granted!",
        description: `Welcome to ${sessionData.tierName}. Happy interneting!`,
      });

      // Clean up URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);

      // Redirect to internet after delay
      setTimeout(() => {
        window.location.href = config?.features.redirectAfterPayment || "https://www.google.com";
      }, 4000);

    } catch (error) {
      setIsConnecting(false);
      setPaymentStep('select');
      toast({
        title: "Connection Failed",
        description: "Unable to establish free access. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Generate device identifier from available browser/network information
  const generateDeviceIdentifier = (): string => {
    const components = [];
    
    // Browser fingerprinting components
    components.push(navigator.userAgent);
    components.push(screen.width + 'x' + screen.height);
    components.push(navigator.language);
    components.push(Intl.DateTimeFormat().resolvedOptions().timeZone);
    
    // Add random component to ensure uniqueness
    components.push(Date.now().toString());
    components.push(Math.random().toString(36).substring(2));
    
    // Create hash-like identifier
    const deviceString = components.join('|');
    let hash = 0;
    for (let i = 0; i < deviceString.length; i++) {
      const char = deviceString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    // Format as device ID
    return `device_${Math.abs(hash).toString(36)}_${Date.now()}`;
  };

  const processCryptoPayment = async (tier: ConfigTier) => {
    const amount = tier.price.toString();
    // Use payments.crypto.network with fallback to top-level network
    const cryptoNetwork = config!.payments?.crypto?.network ?? config!.network;

    try {
      setPaymentStep('paying');
      setIsConnecting(true);

      // Simulate transaction submission delay
      await new Promise(resolve => setTimeout(resolve, 1500));

      const transaction = await web3Provider.sendTransaction({
        from: wallet.address!,
        to: cryptoNetwork.contractAddress,
        value: amount,
        gasPrice: currentNetwork?.gasPrice || "20000000000",
        gasLimit: "100000",
        chainId: wallet.chainId!
      });

      setTransactionHash(transaction);
      setPaymentStep('confirming');

      toast({
        title: "Transaction Submitted",
        description: `Transaction ${transaction.substring(0, 10)}... submitted successfully`,
      });

      // Simulate confirmation delay
      await new Promise(resolve => setTimeout(resolve, 3000));

      const receipt = await web3Provider.waitForTransaction(transaction);
      
      if (receipt.status === 'success') {
        setPaymentStep('complete');
        setTimeout(() => {
          window.location.href = config!.features.redirectAfterPayment;
        }, 2000);
      }

    } catch (error) {
      setIsConnecting(false);
      setPaymentStep('select');
      toast({
        title: "Payment Failed",
        description: "Crypto transaction failed. Please try again.",
        variant: "destructive",
      });
    }
  };

  if (configLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50 flex items-center justify-center">
        <div className="text-center">
          <Wifi className="w-12 h-12 text-blue-600 mx-auto mb-4 animate-pulse" />
          <p className="text-gray-600">Loading configuration...</p>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600">Failed to load node configuration</p>
        </div>
      </div>
    );
  }

  const getButtonColorClass = (color: string) => {
    switch (color) {
      case 'green':
        return 'bg-green-600 hover:bg-green-700 text-white w-full';
      case 'blue':
        return 'inline-flex items-center justify-center whitespace-nowrap rounded-md text-[13px] font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-blue-600 text-primary-foreground hover:bg-blue-700 h-10 px-4 py-2 w-full text-white mt-1';
      case 'purple':
        return 'bg-purple-600 hover:bg-purple-700 text-white w-full';
      default:
        return 'bg-blue-600 hover:bg-blue-700 text-white w-full';
    }
  };

  const getBorderColor = (color: string) => {
    switch (color) {
      case 'green':
        return 'border-green-200 bg-green-50/50';
      case 'blue':
        return 'border-blue-200 bg-blue-50/50';
      case 'purple':
        return 'border-purple-200 bg-purple-50/50';
      default:
        return 'border-gray-200 bg-gray-50/50';
    }
  };

  const getBadgeColor = (color: string) => {
    switch (color) {
      case 'green':
        return 'bg-green-600 text-white';
      case 'blue':
        return 'bg-blue-600 text-white';
      case 'purple':
        return 'bg-purple-600 text-white';
      default:
        return 'bg-gray-600 text-white';
    }
  };

  const getTextColor = (color: string) => {
    switch (color) {
      case 'green':
        return 'text-green-800';
      case 'blue':
        return 'text-blue-800';
      case 'purple':
        return 'text-purple-800';
      default:
        return 'text-gray-800';
    }
  };

  const getBoldTextColor = (color: string) => {
    switch (color) {
      case 'green':
        return 'text-green-900';
      case 'blue':
        return 'text-blue-900';
      case 'purple':
        return 'text-purple-900';
      default:
        return 'text-gray-900';
    }
  };

  const getDescTextColor = (color: string) => {
    switch (color) {
      case 'green':
        return 'text-green-700';
      case 'blue':
        return 'text-blue-700';
      case 'purple':
        return 'text-purple-700';
      default:
        return 'text-gray-700';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-r from-blue-600 to-green-600 rounded-xl flex items-center justify-center">
                <Wifi className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900">{config.branding.logoText}</h1>
            </div>
            <div className="flex items-center space-x-4">
              {currentNetwork && wallet.isConnected && (
                <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                  <div className="w-2 h-2 bg-red-500 rounded-full mr-2 animate-pulse" />
                  {currentNetwork.name}
                </Badge>
              )}
              {(config.payments?.crypto?.enabled ?? config.features.enableCrypto) && config.features.enableWalletConnection && <WalletConnect />}
            </div>
          </div>
          <div className="text-center pb-4">
            <p className="text-lg text-gray-600">{config.branding.tagline}</p>
            {config.branding.showCommunityBadge && (
              <Badge className="mt-2 bg-green-100 text-green-700 border-green-200">
                <Users className="w-4 h-4 mr-1" />
                Community-Powered Network
              </Badge>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!isConnecting && paymentStep === 'select' ? (
          <>
            {/* Welcome Section */}
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                Welcome to {config.nodeInfo.name}
              </h2>
              <p className="text-xl text-gray-600 mb-6">
                Connect to our decentralized network and choose your access level
              </p>
              <div className="flex items-center justify-center space-x-6 text-sm text-gray-500">
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                  <span>Node Online</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Globe className="w-4 h-4" />
                  <span>{config.nodeInfo.location}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Users className="w-4 h-4" />
                  <span>{config.nodeInfo.operator}</span>
                </div>
                {(networkStatus?.connectedClients ?? 0) > 1 && (
                  <div className="flex items-center space-x-2">
                    <Wifi className="w-4 h-4" />
                    <span>{networkStatus?.connectedClients} Connected Clients</span>
                  </div>
                )}
              </div>
            </div>

            {/* Smart Contract Info */}
            {(() => {
              const cryptoEnabled = config.payments?.crypto?.enabled ?? config.features.enableCrypto;
              const cryptoNetwork = config.payments?.crypto?.network ?? config.network;

              if (!cryptoEnabled || !wallet.isConnected || !config.features.showTransactionDetails) return null;

              return (
                <div className="mb-8">
                  <Card className="bg-blue-50 border-blue-200">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <Shield className="w-5 h-5 text-blue-600" />
                          <div>
                            <h3 className="font-semibold text-blue-900">Smart Contract Ready</h3>
                            <p className="text-sm text-blue-700">Connected to {cryptoNetwork.chainName}</p>
                          </div>
                        </div>
                        <Badge className="bg-blue-600 text-white">
                          {currentNetwork?.name || cryptoNetwork.chainName}
                        </Badge>
                      </div>
                      <div className="mt-3 text-xs text-blue-600 font-mono bg-white/50 rounded p-2 break-all">
                        Contract: {cryptoNetwork.contractAddress}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              );
            })()}

            {/* Plans */}
            <div className={`grid gap-6 mb-12 ${
              config.pricing.tiers.length === 1 ? 'max-w-md mx-auto' :
              config.pricing.tiers.length === 2 ? 'md:grid-cols-2 max-w-4xl mx-auto' :
              config.pricing.tiers.length === 3 ? 'md:grid-cols-3' :
              config.pricing.tiers.length === 4 ? 'md:grid-cols-2 lg:grid-cols-4' :
              'md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
            }`}>
              {config.pricing.tiers.map((tier) => (
                <Card key={tier.id} className={`relative border-2 ${getBorderColor(tier.buttonColor)}`}>
                  {tier.isPopular && (
                    <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                      <Badge className="bg-orange-500 text-white">Most Popular</Badge>
                    </div>
                  )}
                  {tier.isFree && (
                    <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                      <Badge className={getBadgeColor(tier.buttonColor)}>Always Free</Badge>
                    </div>
                  )}
                  <CardHeader className="text-center pt-6">
                    <CardTitle className={`text-xl ${getTextColor(tier.buttonColor)}`}>
                      {tier.name}
                    </CardTitle>
                    <div className={`text-3xl font-bold ${getBoldTextColor(tier.buttonColor)}`}>
                      {tier.isFree ? '$0' : (
                        <>
                          <div>${tier.fiatPrice}</div>
                          {(config.payments?.crypto?.enabled ?? config.features.enableCrypto) && tier.acceptCryptoPayments && (
                            <div className="text-sm font-normal opacity-75">
                              or {tier.price} {config.pricing.currency}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    <p className={getDescTextColor(tier.buttonColor)}>
                      {tier.description}
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <ul className="space-y-3 text-sm">
                      {tier.features.map((feature, index) => (
                        <li key={index} className="flex items-center space-x-2">
                          <CheckCircle className="w-4 h-4 text-green-600" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                    <Button 
                      className={getButtonColorClass(tier.buttonColor)}
                      onClick={() => handleConnect(tier.id)}
                      disabled={isConnecting}
                    >
                      {isConnecting && selectedPlan === tier.id ? 'Connecting...' : tier.buttonText}
                      {tier.isFree && <ArrowRight className="w-4 h-4 ml-2" />}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        ) : paymentStep === 'method' ? (
          <div className="max-w-md mx-auto">
            {/* Payment Method Selection */}
            <Card>
              <CardHeader className="text-center">
                <CardTitle className="text-blue-700">Choose Payment Method</CardTitle>
                <p className="text-gray-600">
                  {config.pricing.tiers.find(t => t.id === selectedPlan)?.name}
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Stripe Payment Methods */}
                {(() => {
                  const tier = config.pricing.tiers.find(t => t.id === selectedPlan);
                  const stripeEnabled = config.payments?.stripe?.enabled ?? config.stripe.enabled;
                  const paymentMethods = config.payments?.stripe?.paymentMethods ?? ['card'];

                  if (!tier?.acceptStripePayments || !stripeEnabled) return null;

                  return (
                    <div className="space-y-2">
                      <p className="text-sm text-gray-500 font-medium">Pay ${tier.fiatPrice}</p>

                      {paymentMethods.includes('card') && (
                        <Button
                          className="w-full bg-purple-600 hover:bg-purple-700 text-white flex items-center justify-center gap-2"
                          onClick={() => handlePaymentMethodSelect('stripe')}
                        >
                          <CreditCard className="w-5 h-5" />
                          Credit / Debit Card
                        </Button>
                      )}

                      {paymentMethods.includes('apple_pay') && (
                        <Button
                          className="w-full bg-black hover:bg-gray-800 text-white flex items-center justify-center gap-2"
                          onClick={() => handlePaymentMethodSelect('stripe')}
                        >
                          <Smartphone className="w-5 h-5" />
                          Apple Pay
                        </Button>
                      )}

                      {paymentMethods.includes('google_pay') && (
                        <Button
                          className="w-full bg-white hover:bg-gray-100 text-gray-800 border border-gray-300 flex items-center justify-center gap-2"
                          onClick={() => handlePaymentMethodSelect('stripe')}
                        >
                          <Wallet className="w-5 h-5" />
                          Google Pay
                        </Button>
                      )}

                      {paymentMethods.includes('link') && (
                        <Button
                          className="w-full bg-green-600 hover:bg-green-700 text-white flex items-center justify-center gap-2"
                          onClick={() => handlePaymentMethodSelect('stripe')}
                        >
                          <ArrowRight className="w-5 h-5" />
                          Pay with Link
                        </Button>
                      )}
                    </div>
                  );
                })()}

                {/* Crypto Payment Option */}
                {(() => {
                  const tier = config.pricing.tiers.find(t => t.id === selectedPlan);
                  const cryptoEnabled = config.payments?.crypto?.enabled ?? config.features.enableCrypto;
                  const cryptoNetwork = config.payments?.crypto?.network ?? config.network;

                  if (!tier?.acceptCryptoPayments || !cryptoEnabled) return null;

                  return (
                    <div className="space-y-2 pt-2 border-t border-gray-200">
                      <p className="text-sm text-gray-500 font-medium">
                        Or pay {tier.price} {config.pricing.currency} on {cryptoNetwork.chainName}
                      </p>
                      <Button
                        className="w-full bg-orange-600 hover:bg-orange-700 text-white flex items-center justify-center gap-2"
                        onClick={() => handlePaymentMethodSelect('crypto')}
                      >
                        <Wallet className="w-5 h-5" />
                        Pay with Crypto
                      </Button>
                    </div>
                  );
                })()}

                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setPaymentStep('select');
                    setSelectedPlan(null);
                  }}
                >
                  Back to Plans
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="max-w-md mx-auto">
            {/* Connection Progress */}
            {paymentStep === 'select' && isConnecting && (
              <Card>
                <CardHeader className="text-center">
                  <CardTitle className="text-green-700">Connecting to Free Network</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
                  </div>
                  <Progress value={66} className="w-full" />
                  <p className="text-center text-sm text-gray-600">
                    Establishing secure connection...
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Payment Processing */}
            {(paymentStep === 'paying' || paymentStep === 'confirming' || paymentStep === 'complete') && (() => {
              const cryptoEnabled = config.payments?.crypto?.enabled ?? config.features.enableCrypto;
              const cryptoNetwork = config.payments?.crypto?.network ?? config.network;

              return (
              <Card>
                <CardHeader className="text-center">
                  <CardTitle className="text-blue-700">Processing Payment</CardTitle>
                  <p className="text-gray-600">
                    {paymentMethod === 'stripe' ? 'Secure card payment' : (cryptoEnabled ? `Secure transaction on ${cryptoNetwork.chainName}` : 'Processing payment')}
                  </p>
                </CardHeader>
                <CardContent className="space-y-6">
                  {config.features.showTransactionDetails && (
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <label className="text-gray-600">Payment Method</label>
                        <div className="font-medium">
                          {paymentMethod === 'stripe' ? 'Credit Card' : (cryptoEnabled ? 'Cryptocurrency' : 'Alternative Payment')}
                        </div>
                      </div>
                      <div>
                        <label className="text-gray-600">Amount</label>
                        <div className="font-medium">
                          {paymentMethod === 'stripe'
                            ? `$${config.pricing.tiers.find(t => t.id === selectedPlan)?.fiatPrice || 0}`
                            : `${config.pricing.tiers.find(t => t.id === selectedPlan)?.price || 0} ${config.pricing.currency}`
                          }
                        </div>
                      </div>
                      {paymentMethod === 'crypto' && cryptoEnabled && (
                        <>
                          <div>
                            <label className="text-gray-600">Network</label>
                            <div className="font-medium">{cryptoNetwork.chainName}</div>
                          </div>
                          <div>
                            <label className="text-gray-600">Contract</label>
                            <div className="font-mono text-xs break-all">{cryptoNetwork.contractAddress}</div>
                          </div>
                        </>
                      )}
                      <div>
                        <label className="text-gray-600">Status</label>
                        <div className="flex items-center space-x-2">
                          {paymentStep === 'paying' && (
                            <>
                              <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
                              <span className="text-yellow-600">Submitting</span>
                            </>
                          )}
                          {paymentStep === 'confirming' && (
                            <>
                              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                              <span className="text-blue-600">Confirming</span>
                            </>
                          )}
                          {paymentStep === 'complete' && (
                            <>
                              <CheckCircle className="w-4 h-4 text-green-600" />
                              <span className="text-green-600">Complete</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {transactionHash && (
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <label className="text-sm text-gray-600">Transaction Hash</label>
                      <div className="font-mono text-xs break-all mt-1">{transactionHash}</div>
                    </div>
                  )}

                  <div className="text-center">
                    {paymentStep === 'paying' && (
                      <div className="flex items-center justify-center space-x-2">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                        <span className="text-sm">Submitting transaction...</span>
                      </div>
                    )}
                    {paymentStep === 'confirming' && (
                      <div className="flex items-center justify-center space-x-2">
                        <Clock className="w-4 h-4 text-blue-600 animate-pulse" />
                        <span className="text-sm">Waiting for confirmation...</span>
                      </div>
                    )}
                    {paymentStep === 'complete' && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-center space-x-2 text-green-600">
                          <CheckCircle className="w-6 h-6" />
                          <span className="font-medium text-lg">
                            {accessSession?.tierName === 'Free Access' ? 'Free Access Granted!' : 'Payment Successful!'}
                          </span>
                        </div>
                        
                        {accessSession && (
                          <div className="bg-green-50 p-4 rounded-lg space-y-2">
                            <h3 className="font-semibold text-green-800">Welcome to {accessSession.tierName}</h3>
                            <div className="grid grid-cols-2 gap-2 text-sm text-green-700">
                              <div>
                                <span className="font-medium">Data Limit:</span> 
                                {accessSession.dataLimitMB === -1 ? 'Unlimited' : `${accessSession.dataLimitMB} MB`}
                              </div>
                              <div>
                                <span className="font-medium">Speed:</span> 
                                {accessSession.speedMbps === 'unlimited' ? 'Unlimited' : `${accessSession.speedMbps} Mbps`}
                              </div>
                              <div className="col-span-2">
                                <span className="font-medium">Expires:</span> 
                                {new Date(accessSession.expiryDate).toLocaleDateString('en-US', {
                                  weekday: 'long',
                                  year: 'numeric', 
                                  month: 'long', 
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </div>
                            </div>
                          </div>
                        )}
                        
                        <div className="text-center">
                          <p className="text-xl font-bold text-blue-600 mb-1">Happy Interneting! 🌐</p>
                          <p className="text-sm text-gray-600">Redirecting to internet access in a few seconds...</p>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
              );
            })()}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white/50 border-t border-gray-200 mt-16">
        <div className="max-w-4xl mx-auto px-4 py-6 text-center text-sm text-gray-500">
          <p>Powered by MeshLink Decentralized Network • Secure • Community-Driven</p>
        </div>
      </footer>
    </div>
  );
}