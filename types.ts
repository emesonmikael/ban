
export type TransactionType = 'RECEIVE_BANK' | 'PAY_RENT' | 'BUY_PROPERTY' | 'PAY_TAX' | 'BONUS' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'ADJUSTMENT';

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  date: number;
  description: string;
  targetPlayerName?: string;
}

export interface Player {
  id: string;
  name: string;
  balance: number;
  nfcId: string | null;
  history: Transaction[];
}

export interface AppSettings {
  initialBalance: number;
  bankPassword: string;
}

export interface NfcPayload {
  playerId: string;
  name: string;
}
