
import React, { useState, useEffect, useCallback } from 'react';
import { Player, Transaction, TransactionType, NfcPayload, AppSettings } from './types';
import { storageService } from './services/storageService';
import { nfcService } from './services/nfcService';
import { TRANSACTION_LABELS } from './constants';
import { Button } from './components/Button';

// Utility to play sound
const playSound = (type: 'success' | 'error' | 'cash') => {
  const frequencies = { success: 880, error: 220, cash: 440 };
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  
  osc.frequency.setValueAtTime(frequencies[type], ctx.currentTime);
  osc.type = 'sine';
  
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.05);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
  
  osc.connect(gain);
  gain.connect(ctx.destination);
  
  osc.start();
  osc.stop(ctx.currentTime + 0.3);

  if (navigator.vibrate) {
    navigator.vibrate(type === 'error' ? [100, 50, 100] : 100);
  }
};

const formatCurrency = (val: number) => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0
  }).format(val).replace('R$', '₩'); // We'll use a custom symbol or just '₩' for fun
};

const App: React.FC = () => {
  const [players, setPlayers] = useState<Player[]>([]);
  const [settings, setSettings] = useState<AppSettings>(storageService.getSettings());
  const [activePlayer, setActivePlayer] = useState<Player | null>(null);
  const [view, setView] = useState<'home' | 'player' | 'bank' | 'register' | 'transfer'>('home');
  const [isNfcScanning, setIsNfcScanning] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string, type: 'info' | 'error' | 'success' } | null>(null);
  
  // Bank Admin State
  const [bankAuth, setBankAuth] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  
  // Registration State
  const [newName, setNewName] = useState('');

  // Transaction State
  const [transAmount, setTransAmount] = useState<number | ''>('');
  const [targetPlayer, setTargetPlayer] = useState<Player | null>(null);

  useEffect(() => {
    setPlayers(storageService.getPlayers());
  }, []);

  const saveAndRefresh = (updatedPlayers: Player[]) => {
    setPlayers(updatedPlayers);
    storageService.savePlayers(updatedPlayers);
    if (activePlayer) {
      const updatedActive = updatedPlayers.find(p => p.id === activePlayer.id);
      if (updatedActive) setActivePlayer(updatedActive);
    }
  };

  const notify = (text: string, type: 'info' | 'error' | 'success' = 'info') => {
    setStatusMessage({ text, type });
    setTimeout(() => setStatusMessage(null), 3000);
  };

  const handleStartScan = async () => {
    if (!nfcService.isSupported()) {
      notify("Seu navegador não suporta NFC. Use o Chrome no Android.", "error");
      return;
    }

    setIsNfcScanning(true);
    notify("Aproxime seu cartão NFC do celular...", "info");

    try {
      await nfcService.scan(
        (payload) => {
          const player = players.find(p => p.id === payload.playerId);
          if (player) {
            playSound('success');
            setActivePlayer(player);
            setView('player');
            setIsNfcScanning(false);
          } else {
            playSound('error');
            notify("Cartão não reconhecido como jogador.", "error");
            setIsNfcScanning(false);
          }
        },
        (err) => {
          setIsNfcScanning(false);
          notify("Erro na leitura NFC. Tente novamente.", "error");
        }
      );
    } catch (e) {
      setIsNfcScanning(false);
      notify("NFC desativado ou sem permissão.", "error");
    }
  };

  const handleRegisterNew = async () => {
    if (!newName.trim()) return notify("Digite um nome!", "error");
    
    setIsNfcScanning(true);
    notify("Aproxime um cartão NOVO para gravar...", "info");

    try {
      const newId = crypto.randomUUID();
      const payload: NfcPayload = { playerId: newId, name: newName };
      
      await nfcService.write(payload);
      
      const newPlayer: Player = {
        id: newId,
        name: newName,
        balance: settings.initialBalance,
        nfcId: null, // serial number is optional for this logic
        history: [{
          id: crypto.randomUUID(),
          type: 'RECEIVE_BANK',
          amount: settings.initialBalance,
          date: Date.now(),
          description: 'Saldo Inicial'
        }]
      };

      const updated = [...players, newPlayer];
      saveAndRefresh(updated);
      
      playSound('success');
      notify(`Jogador ${newName} registrado com sucesso!`, "success");
      setNewName('');
      setIsNfcScanning(false);
      setView('bank');
    } catch (e) {
      setIsNfcScanning(false);
      notify("Erro ao gravar cartão NFC.", "error");
    }
  };

  const processTransaction = (
    playerId: string, 
    type: TransactionType, 
    amount: number, 
    description: string,
    otherPlayerId?: string
  ) => {
    const updatedPlayers = players.map(p => {
      if (p.id === playerId) {
        const newBalance = type.includes('PAY') || type === 'TRANSFER_OUT' ? p.balance - amount : p.balance + amount;
        
        if (newBalance < 0 && (type.includes('PAY') || type === 'TRANSFER_OUT')) {
           // Should be handled before calling this, but safety check
           return p;
        }

        const trans: Transaction = {
          id: crypto.randomUUID(),
          type,
          amount,
          date: Date.now(),
          description,
          targetPlayerName: otherPlayerId ? players.find(x => x.id === otherPlayerId)?.name : undefined
        };

        return {
          ...p,
          balance: newBalance,
          history: [trans, ...p.history].slice(0, 50)
        };
      }
      return p;
    });

    saveAndRefresh(updatedPlayers);
    playSound('cash');
  };

  const handleQuickAction = (type: TransactionType, amount: number) => {
    if (!activePlayer) return;
    if (amount <= 0) return;
    
    if ((type.includes('PAY') || type === 'TRANSFER_OUT') && activePlayer.balance < amount) {
      notify("Saldo insuficiente!", "error");
      playSound('error');
      return;
    }

    if (confirm(`Confirmar transação de ${formatCurrency(amount)}?`)) {
      processTransaction(activePlayer.id, type, amount, TRANSACTION_LABELS[type]);
    }
  };

  const handleTransferInit = () => {
    if (Number(transAmount) <= 0) return notify("Valor inválido", "error");
    if (activePlayer && activePlayer.balance < Number(transAmount)) return notify("Saldo insuficiente", "error");
    
    setIsNfcScanning(true);
    notify("Aproxime o cartão do DESTINATÁRIO...", "info");

    nfcService.scan(
      (payload) => {
        const recipient = players.find(p => p.id === payload.playerId);
        if (recipient && activePlayer && recipient.id !== activePlayer.id) {
          const amount = Number(transAmount);
          processTransaction(activePlayer.id, 'TRANSFER_OUT', amount, 'Transferência enviada', recipient.id);
          processTransaction(recipient.id, 'TRANSFER_IN', amount, 'Transferência recebida', activePlayer.id);
          
          setIsNfcScanning(false);
          notify(`Transferência de ${formatCurrency(amount)} enviada para ${recipient.name}!`, "success");
          setTransAmount('');
          setView('player');
        } else {
          setIsNfcScanning(false);
          notify("Cartão inválido para transferência.", "error");
        }
      },
      (err) => {
        setIsNfcScanning(false);
        notify("Erro na leitura NFC.", "error");
      }
    );
  };

  const resetGame = () => {
    if (confirm("Resetar o jogo? Todos os jogadores voltarão ao saldo inicial.")) {
      const resetPlayers = players.map(p => ({
        ...p,
        balance: settings.initialBalance,
        history: [{
          id: crypto.randomUUID(),
          type: 'ADJUSTMENT' as TransactionType,
          amount: settings.initialBalance,
          date: Date.now(),
          description: 'Reinício de Jogo'
        }]
      }));
      saveAndRefresh(resetPlayers);
      notify("Jogo resetado!", "success");
    }
  };

  const deleteAll = () => {
    if (confirm("APAGAR TUDO? Isso deleta todos os jogadores registrados do banco de dados local.")) {
      storageService.clearAll();
      setPlayers([]);
      setView('home');
      notify("Dados apagados.", "info");
    }
  };

  // Views
  const renderHome = () => (
    <div className="flex flex-col items-center justify-center min-h-[80vh] gap-8 p-6">
      <div className="text-center">
        <div className="w-24 h-24 bg-green-600 rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-xl">
          <span className="text-white text-5xl font-bold">₩</span>
        </div>
        <h1 className="text-3xl font-extrabold text-gray-800">Bank Imobiliário</h1>
        <p className="text-gray-500 mt-2">Toque para começar</p>
      </div>
      
      <div className="w-full max-w-xs flex flex-col gap-4">
        <Button fullWidth onClick={handleStartScan} className="h-20 text-lg">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" /></svg>
          Ler Cartão NFC
        </Button>
        <Button fullWidth variant="outline" onClick={() => setView('bank')}>
          🏦 Modo Banco
        </Button>
      </div>
    </div>
  );

  const renderPlayer = () => {
    if (!activePlayer) return null;
    return (
      <div className="p-6 pb-24 space-y-8 animate-in slide-in-from-right duration-300">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-sm font-medium text-gray-400 uppercase tracking-widest">Jogador</h2>
            <h1 className="text-4xl font-black text-gray-800">{activePlayer.name}</h1>
          </div>
          <Button variant="outline" onClick={() => setView('home')} className="px-4 py-2">Sair</Button>
        </div>

        <div className="bg-gradient-to-br from-green-600 to-emerald-700 p-8 rounded-3xl text-white shadow-2xl relative overflow-hidden">
          <div className="relative z-10">
            <p className="text-green-100 text-sm font-medium">Saldo Atual</p>
            <h2 className="text-5xl font-bold mt-1 tracking-tight">{formatCurrency(activePlayer.balance)}</h2>
          </div>
          <div className="absolute top-[-20px] right-[-20px] text-[120px] opacity-10 font-black">₩</div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Button variant="success" onClick={() => handleQuickAction('RECEIVE_BANK', 200)} className="flex-col h-24">
            <span className="text-xs">Receber</span>
            <span className="text-lg">₩ 200</span>
          </Button>
          <Button variant="danger" onClick={() => handleQuickAction('PAY_RENT', 100)} className="flex-col h-24">
            <span className="text-xs">Pagar Aluguel</span>
            <span className="text-lg">₩ 100</span>
          </Button>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-bold text-gray-800">Ações</h3>
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input 
                type="number" 
                placeholder="Valor Customizado" 
                className="flex-1 p-3 rounded-xl border-2 border-gray-200 focus:border-green-500 outline-none"
                value={transAmount}
                onChange={e => setTransAmount(e.target.value ? Number(e.target.value) : '')}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button onClick={() => handleQuickAction('RECEIVE_BANK', Number(transAmount))} disabled={!transAmount}>Receber</Button>
              <Button variant="danger" onClick={() => handleQuickAction('PAY_RENT', Number(transAmount))} disabled={!transAmount}>Pagar</Button>
              <Button variant="secondary" onClick={() => handleTransferInit()} disabled={!transAmount}>Transferir</Button>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-bold text-gray-800">Histórico</h3>
          <div className="space-y-3">
            {activePlayer.history.map(t => (
              <div key={t.id} className="flex justify-between items-center p-4 bg-white rounded-2xl border border-gray-100 shadow-sm">
                <div>
                  <p className="font-bold text-gray-800">{TRANSACTION_LABELS[t.type] || t.description}</p>
                  <p className="text-xs text-gray-400">
                    {new Date(t.date).toLocaleTimeString()} - {t.targetPlayerName ? `Para: ${t.targetPlayerName}` : ''}
                  </p>
                </div>
                <p className={`font-black ${t.type.includes('PAY') || t.type === 'TRANSFER_OUT' ? 'text-red-500' : 'text-green-600'}`}>
                  {t.type.includes('PAY') || t.type === 'TRANSFER_OUT' ? '-' : '+'} {formatCurrency(t.amount)}
                </p>
              </div>
            ))}
            {activePlayer.history.length === 0 && <p className="text-center text-gray-400 py-4">Nenhuma transação ainda.</p>}
          </div>
        </div>
      </div>
    );
  };

  const renderBank = () => {
    if (!bankAuth) {
      return (
        <div className="p-6 flex flex-col items-center justify-center min-h-[60vh] gap-6">
          <h2 className="text-2xl font-bold">Acesso Restrito</h2>
          <input 
            type="password" 
            placeholder="Senha do Banco"
            className="w-full max-w-xs p-4 rounded-xl border-2 border-gray-200 text-center text-2xl tracking-widest outline-none focus:border-blue-500"
            value={passwordInput}
            onChange={e => setPasswordInput(e.target.value)}
          />
          <Button fullWidth onClick={() => {
            if (passwordInput === settings.bankPassword) setBankAuth(true);
            else notify("Senha incorreta!", "error");
          }}>Entrar</Button>
          <Button variant="outline" onClick={() => setView('home')}>Voltar</Button>
        </div>
      );
    }

    return (
      <div className="p-6 space-y-8 animate-in fade-in duration-300">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-black">Banco</h1>
          <Button variant="outline" onClick={() => { setBankAuth(false); setView('home'); }}>Sair</Button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Button variant="secondary" onClick={() => setView('register')}>Criar Jogador</Button>
          <Button variant="outline" onClick={resetGame}>Resetar Partida</Button>
        </div>

        <div className="space-y-4">
          <h2 className="text-xl font-bold">Jogadores Ativos ({players.length})</h2>
          <div className="space-y-3">
            {players.map(p => (
              <div key={p.id} className="p-4 bg-white rounded-2xl border border-gray-100 flex justify-between items-center shadow-sm">
                <div>
                  <p className="font-bold text-lg">{p.name}</p>
                  <p className="text-green-600 font-mono">{formatCurrency(p.balance)}</p>
                </div>
                <Button variant="outline" onClick={() => { setActivePlayer(p); setView('player'); }}>Ver</Button>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-8 border-t">
          <Button variant="danger" fullWidth onClick={deleteAll}>DELETAR TODOS OS DADOS</Button>
        </div>
      </div>
    );
  };

  const renderRegister = () => (
    <div className="p-6 space-y-8">
      <h1 className="text-3xl font-black">Novo Jogador</h1>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-bold text-gray-500 mb-1">Nome do Jogador</label>
          <input 
            type="text" 
            className="w-full p-4 rounded-xl border-2 border-gray-200 outline-none focus:border-green-500"
            placeholder="Ex: Tio Patinhas"
            value={newName}
            onChange={e => setNewName(e.target.value)}
          />
        </div>
        <p className="text-sm text-gray-500 italic">O saldo inicial será de {formatCurrency(settings.initialBalance)}</p>
        <Button fullWidth onClick={handleRegisterNew} loading={isNfcScanning}>Gravar Cartão NFC</Button>
        <Button variant="outline" fullWidth onClick={() => setView('bank')}>Cancelar</Button>
      </div>
    </div>
  );

  return (
    <div className="max-w-md mx-auto min-h-screen bg-gray-50 relative overflow-hidden">
      {/* Top Status Bar */}
      {statusMessage && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-full shadow-2xl transition-all duration-300 animate-in slide-in-from-top-10
          ${statusMessage.type === 'error' ? 'bg-red-500 text-white' : 
            statusMessage.type === 'success' ? 'bg-green-600 text-white' : 'bg-blue-600 text-white'}`}>
          <p className="text-sm font-bold whitespace-nowrap">{statusMessage.text}</p>
        </div>
      )}

      {/* NFC Scanning Overlay */}
      {isNfcScanning && (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center p-8 text-white text-center">
          <div className="w-32 h-32 border-4 border-white/20 rounded-full flex items-center justify-center mb-6 relative">
             <div className="absolute inset-0 border-4 border-green-400 rounded-full nfc-scan-animation"></div>
             <svg className="w-16 h-16 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
             </svg>
          </div>
          <h2 className="text-2xl font-bold mb-2">Pronto para ler</h2>
          <p className="opacity-80">Aproxime o cartão NFC da parte de trás do seu celular.</p>
          <Button variant="outline" className="mt-8 !text-white !border-white" onClick={() => setIsNfcScanning(false)}>Cancelar</Button>
        </div>
      )}

      {/* Main Views */}
      <main className="pb-8">
        {view === 'home' && renderHome()}
        {view === 'player' && renderPlayer()}
        {view === 'bank' && renderBank()}
        {view === 'register' && renderRegister()}
      </main>

      {/* Bottom Footer Info */}
      {view === 'home' && (
        <footer className="absolute bottom-6 w-full text-center px-6">
          <p className="text-xs text-gray-400 font-medium">NFC BANK IMOBILIÁRIO v1.0 • {players.length} jogadores ativos</p>
        </footer>
      )}
    </div>
  );
};

export default App;
