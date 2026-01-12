
import { NfcPayload } from '../types';

export const nfcService = {
  isSupported: () => 'NDEFReader' in window,

  scan: async (onReading: (payload: NfcPayload, serialNumber: string) => void, onError: (err: any) => void) => {
    try {
      const ndef = new (window as any).NDEFReader();
      await ndef.scan();
      
      ndef.onreading = (event: any) => {
        const { message, serialNumber } = event;
        for (const record of message.records) {
          if (record.recordType === "mime" && record.mediaType === "application/json") {
            const textDecoder = new TextDecoder();
            const data = JSON.parse(textDecoder.decode(record.data));
            onReading(data, serialNumber);
          }
        }
      };

      ndef.onreadingerror = () => {
        onError("Erro ao ler o cartão NFC. Tente novamente.");
      };
    } catch (error) {
      onError(error);
    }
  },

  write: async (payload: NfcPayload) => {
    try {
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
  }
};
