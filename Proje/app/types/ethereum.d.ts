interface EthereumRequestArguments {
  method: string;
  params?: unknown[] | object;
}

interface EthereumProvider {
  isMetaMask?: boolean;
  request: (args: EthereumRequestArguments) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
}

interface Window {
  ethereum?: EthereumProvider;
}
