
import { NfcPayload } from '../types';

let abortController: AbortController | null = null;

export const nfcService = {
  isSupported: () => 'NDEFReader' in window,

  stopScan: () => {
    if (abortController) {
      abortController.abort();
      abortController = null;
      console.log("NFC Scan parado.");
    }
  },

  scan: async (onReading: (payload: NfcPayload, serialNumber: string) => void, onError: (err: any) => void) => {
    try {
      // Cancela qualquer scan anterior antes de começar um novo
      if (abortController) {
        abortController.abort();
      }
      
      abortController = new AbortController();
      const ndef = new (window as any).NDEFReader();
      
      await ndef.scan({ signal: abortController.signal });
      
      ndef.onreading = (event: any) => {
        const { message, serialNumber } = event;
        for (const record of message.records) {
          if (record.recordType === "mime" && record.mediaType === "application/json") {
            const textDecoder = new TextDecoder();
            try {
              const data = JSON.parse(textDecoder.decode(record.data));
              onReading(data, serialNumber);
            } catch (e) {
              console.error("Erro ao processar JSON da tag", e);
            }
          }
        }
      };

      ndef.onreadingerror = () => {
        onError("Erro ao ler o cartão NFC. Tente novamente.");
      };

    } catch (error: any) {
      if (error.name !== 'AbortError') {
        onError(error);
      }
    }
  },

  write: async (payload: any) => {
    try {
      // Para o scan antes de tentar escrever para evitar conflitos
      nfcService.stopScan();
      
      const ndef = new (window as any).NDEFReader();
      const encoder = new TextEncoder();
      await ndef.write({
        records: [{
          recordType: "mime",
          mediaType: "application/json",
          data: encoder.encode(JSON.stringify(payload))
        }]
      });
      return true;
    } catch (error) {
      console.error("NFC Write Error:", error);
      throw error;
    }
  },

  clear: async () => {
    try {
      nfcService.stopScan();
      const ndef = new (window as any).NDEFReader();
      await ndef.write({
        records: [{
          recordType: "mime",
          mediaType: "application/json",
          data: new TextEncoder().encode(JSON.stringify({}))
        }]
      });
      return true;
    } catch (error) {
      console.error("NFC Clear Error:", error);
      throw error;
    }
  }
};
