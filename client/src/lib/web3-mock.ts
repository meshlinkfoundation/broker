export interface MockWallet {
  address: string | null;
  isConnected: boolean;
  chainId: number | null;
}

export interface MockNetwork {
  chainId: number;
  name: string;
  gasPrice: string;
  confirmationTime: number;
}

export interface MockTransaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  gasPrice: string;
  gasLimit: string;
  chainId: number;
}

class MockWeb3Provider {
  private wallet: MockWallet = {
    address: null,
    isConnected: false,
    chainId: null,
  };

  private networks: MockNetwork[] = [
    { chainId: 10, name: "Optimism", gasPrice: "0.000005", confirmationTime: 3 },
    { chainId: 8453, name: "Base", gasPrice: "0.000003", confirmationTime: 2 },
    { chainId: 42161, name: "Arbitrum", gasPrice: "0.00001", confirmationTime: 1 },
  ];

  async connectWallet(): Promise<string> {
    // Simulate wallet connection delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const mockAddress = `0x742d35cc6abc0532925bd6ab1d2982ea87b25ff7`;
    this.wallet = {
      address: mockAddress,
      isConnected: true,
      chainId: 10, // Default to Optimism
    };
    
    return mockAddress;
  }

  async disconnectWallet(): Promise<void> {
    this.wallet = {
      address: null,
      isConnected: false,
      chainId: null,
    };
  }

  async switchNetwork(chainId: number): Promise<void> {
    const network = this.networks.find(n => n.chainId === chainId);
    if (!network) {
      throw new Error(`Unsupported network: ${chainId}`);
    }
    
    // Simulate network switching delay
    await new Promise(resolve => setTimeout(resolve, 500));
    
    this.wallet.chainId = chainId;
  }

  async estimateGas(transaction: Partial<MockTransaction>): Promise<string> {
    const currentNetwork = this.networks.find(n => n.chainId === this.wallet.chainId);
    if (!currentNetwork) {
      throw new Error("No network selected");
    }
    
    // Simulate gas estimation
    const baseGas = parseFloat(currentNetwork.gasPrice);
    const estimatedGas = (baseGas * (21000 + Math.random() * 5000)).toFixed(9);
    
    return estimatedGas;
  }

  async sendTransaction(transaction: Partial<MockTransaction>): Promise<string> {
    if (!this.wallet.isConnected) {
      throw new Error("Wallet not connected");
    }
    
    // Generate mock transaction hash
    const hash = `0x${Math.random().toString(16).substr(2, 64)}`;
    
    // Simulate transaction broadcast delay
    await new Promise(resolve => setTimeout(resolve, 500));
    
    return hash;
  }

  async waitForTransaction(hash: string): Promise<{ status: string; blockNumber: number }> {
    const currentNetwork = this.networks.find(n => n.chainId === this.wallet.chainId);
    if (!currentNetwork) {
      throw new Error("No network selected");
    }
    
    // Simulate confirmation time
    await new Promise(resolve => setTimeout(resolve, currentNetwork.confirmationTime * 1000));
    
    return {
      status: "success",
      blockNumber: Math.floor(Math.random() * 1000000) + 1000000,
    };
  }

  getWallet(): MockWallet {
    return { ...this.wallet };
  }

  getNetworks(): MockNetwork[] {
    return [...this.networks];
  }

  getCurrentNetwork(): MockNetwork | null {
    if (!this.wallet.chainId) return null;
    return this.networks.find(n => n.chainId === this.wallet.chainId) || null;
  }
}

export const web3Provider = new MockWeb3Provider();
