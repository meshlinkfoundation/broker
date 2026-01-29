import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, CreditCard, CheckCircle, Clock, AlertCircle } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useWallet } from "@/hooks/use-wallet";
import { useToast } from "@/hooks/use-toast";
import type { BandwidthPackage, HotspotSession, Transaction } from "@shared/schema";

interface PaymentInterfaceProps {
  selectedPackage?: BandwidthPackage;
  onPaymentComplete?: (session: HotspotSession) => void;
}

export function PaymentInterface({ selectedPackage, onPaymentComplete }: PaymentInterfaceProps) {
  const [selectedPackageId, setSelectedPackageId] = useState<number | undefined>(selectedPackage?.id);
  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'processing' | 'confirming' | 'completed' | 'failed'>('idle');
  const [transactionHash, setTransactionHash] = useState<string>("");
  
  const { wallet, getCurrentNetwork } = useWallet();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const currentNetwork = getCurrentNetwork();

  const { data: packages } = useQuery<BandwidthPackage[]>({
    queryKey: ["/api/packages"],
  });

  const createSessionMutation = useMutation({
    mutationFn: async (data: { packageId: number; networkId: number }) => {
      const response = await apiRequest("POST", "/api/sessions", {
        walletAddress: wallet.address,
        packageId: data.packageId,
        networkId: data.networkId,
      });
      return response.json();
    },
  });

  const processPaymentMutation = useMutation({
    mutationFn: async (sessionId: number) => {
      const response = await apiRequest("POST", `/api/sessions/${sessionId}/pay`);
      return response.json();
    },
  });

  const selectedPkg = packages?.find(pkg => pkg.id === selectedPackageId) || selectedPackage;
  const canProceed = wallet.isConnected && currentNetwork && selectedPkg;

  const handlePayment = async () => {
    if (!canProceed || !selectedPkg) return;

    try {
      setPaymentStatus('processing');
      
      // Create session
      const session = await createSessionMutation.mutateAsync({
        packageId: selectedPkg.id,
        networkId: currentNetwork.chainId === 137 ? 1 : currentNetwork.chainId === 42161 ? 2 : 3,
      });

      setTransactionHash(session.transactionHash);
      setPaymentStatus('confirming');

      // Process payment
      const paymentResult = await processPaymentMutation.mutateAsync(session.id);
      
      // Wait for confirmation
      setTimeout(() => {
        setPaymentStatus('completed');
        onPaymentComplete?.(session);
        queryClient.invalidateQueries({ queryKey: ["/api/user"] });
        
        toast({
          title: "Payment Successful!",
          description: `Your ${selectedPkg.name} package is now active.`,
        });
      }, (paymentResult.estimatedConfirmation || 2) * 1000);

    } catch (error) {
      setPaymentStatus('failed');
      toast({
        title: "Payment Failed",
        description: "There was an error processing your payment. Please try again.",
        variant: "destructive",
      });
    }
  };

  const getStatusIcon = () => {
    switch (paymentStatus) {
      case 'processing':
        return <Loader2 className="w-5 h-5 animate-spin text-blue-600" />;
      case 'confirming':
        return <Clock className="w-5 h-5 text-yellow-600" />;
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'failed':
        return <AlertCircle className="w-5 h-5 text-red-600" />;
      default:
        return <CreditCard className="w-5 h-5 text-gray-600" />;
    }
  };

  const getStatusText = () => {
    switch (paymentStatus) {
      case 'processing':
        return 'Processing Transaction...';
      case 'confirming':
        return 'Confirming on Network...';
      case 'completed':
        return 'Payment Completed!';
      case 'failed':
        return 'Payment Failed';
      default:
        return 'Ready to Pay';
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <CreditCard className="w-6 h-6" />
            <span>Secure Crypto Payment</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Package Selection */}
          {!selectedPackage && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Package</label>
              <Select value={selectedPackageId?.toString()} onValueChange={(value) => setSelectedPackageId(parseInt(value))}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a bandwidth package" />
                </SelectTrigger>
                <SelectContent>
                  {packages?.map((pkg) => (
                    <SelectItem key={pkg.id} value={pkg.id.toString()}>
                      {pkg.name} - ${pkg.priceUSD} ({pkg.dataLimitMB / 1024}GB for {Math.floor(pkg.durationHours / 24)} days)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Selected Package */}
          {selectedPkg && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex justify-between items-start mb-2">
                <h3 className="font-semibold text-blue-900">{selectedPkg.name} Package</h3>
                <Badge className="bg-blue-600 text-white">${selectedPkg.priceUSD}</Badge>
              </div>
              <p className="text-sm text-blue-700 mb-3">{selectedPkg.description}</p>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-blue-600">Data Limit:</span>
                  <span className="ml-2 font-medium">{selectedPkg.dataLimitMB / 1024}GB</span>
                </div>
                <div>
                  <span className="text-blue-600">Duration:</span>
                  <span className="ml-2 font-medium">{Math.floor(selectedPkg.durationHours / 24)} days</span>
                </div>
              </div>
            </div>
          )}

          {/* Network Info */}
          {currentNetwork && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <h4 className="font-medium mb-2">Payment Network</h4>
              <div className="flex justify-between items-center text-sm">
                <span>Network:</span>
                <Badge variant="outline">{currentNetwork.name}</Badge>
              </div>
              <div className="flex justify-between items-center text-sm mt-1">
                <span>Estimated Gas Fee:</span>
                <span className="font-medium text-green-600">${currentNetwork.gasPrice}</span>
              </div>
              <div className="flex justify-between items-center text-sm mt-1">
                <span>Confirmation Time:</span>
                <span className="font-medium">~{currentNetwork.confirmationTime}s</span>
              </div>
            </div>
          )}

          {/* Transaction Status */}
          {paymentStatus !== 'idle' && (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <h4 className="font-medium mb-3">Transaction Status</h4>
              <div className="flex items-center space-x-3 mb-3">
                {getStatusIcon()}
                <span className="font-medium">{getStatusText()}</span>
              </div>
              
              {transactionHash && (
                <div className="bg-gray-50 rounded p-3">
                  <div className="text-xs text-gray-600 mb-1">Transaction Hash</div>
                  <div className="font-mono text-sm text-gray-800 break-all">
                    {transactionHash}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Payment Button */}
          <Button
            onClick={handlePayment}
            disabled={!canProceed || paymentStatus !== 'idle'}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 text-lg"
            size="lg"
          >
            {paymentStatus === 'idle' && (
              <>
                <CreditCard className="w-5 h-5 mr-2" />
                {selectedPkg ? `Pay $${selectedPkg.priceUSD}` : 'Select Package'}
              </>
            )}
            {paymentStatus === 'processing' && (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Processing Payment...
              </>
            )}
            {paymentStatus === 'confirming' && (
              <>
                <Clock className="w-5 h-5 mr-2" />
                Confirming Transaction...
              </>
            )}
            {paymentStatus === 'completed' && (
              <>
                <CheckCircle className="w-5 h-5 mr-2" />
                Payment Complete!
              </>
            )}
            {paymentStatus === 'failed' && 'Try Again'}
          </Button>

          {!wallet.isConnected && (
            <div className="text-center py-4">
              <p className="text-sm text-gray-500">Please connect your wallet to proceed with payment</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
