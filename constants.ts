
import { AppSettings } from './types';

export const STORAGE_KEYS = {
  PLAYERS: 'bi_nfc_players',
  SETTINGS: 'bi_nfc_settings',
  ACTIVE_GAME: 'bi_nfc_active'
};

export const DEFAULT_SETTINGS: AppSettings = {
  initialBalance: 3000,
  bankPassword: '1234'
};

export const TRANSACTION_LABELS: Record<string, string> = {
  RECEIVE_BANK: 'Recebido do Banco',
  PAY_RENT: 'Pagamento de Aluguel',
  BUY_PROPERTY: 'Compra de Propriedade',
  PAY_TAX: 'Pagamento de Imposto',
  BONUS: 'Bônus Recebido',
  TRANSFER_OUT: 'Transferência Enviada',
  TRANSFER_IN: 'Transferência Recebida',
  ADJUSTMENT: 'Ajuste Manual'
};
