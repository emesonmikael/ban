
import React, { useState, useEffect, useCallback } from 'react';
import { Player, Transaction, TransactionType, NfcPayload, AppSettings } from './types';
import { storageService } from './services/storageService';
import { nfcService } from './services/nfcService';
import { TRANSACTION_LABELS } from './constants';
import { Button } from './components/Button';

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
  }).format(val).replace('R$', '₩');
};

const App: React.FC = () => {
  const [players, setPlayers] = useState<Player[]>([]);
  const [settings, setSettings] = useState<AppSettings>(storageService.getSettings());
  const [activePlayer, setActivePlayer] = useState<Player | null>(null);
  const [view, setView] = useState<'home' | 'player' | 'bank' | 'register'>('home');
  const [isNfcScanning, setIsNfcScanning] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string, type: 'info' | 'error' | 'success' } | null>(null);
  
  const [bankAuth, setBankAuth] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [newName, setNewName] = useState('');
  const [transAmount, setTransAmount] = useState<number | ''>('');

  useEffect(() => {
    setPlayers(storageService.getPlayers());
  }, []);

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
    notify("Aproxime seu cartão NFC...", "info");

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
            notify("Cartão não vinculado a nenhum jogador.", "error");
            setIsNfcScanning(false);
          }
        },
        (err) => {
          setIsNfcScanning(false);
          notify("Erro na leitura NFC.", "error");
        }
      );
    } catch (e) {
      setIsNfcScanning(false);
      notify("NFC indisponível.", "error");
    }
  };

  const updatePlayersState = (updater: (prev: Player[]) => Player[]) => {
    setPlayers(prev => {
      const next = updater(prev);
      storageService.savePlayers(next);
      // Atualiza o player ativo se ele estiver na lista modificada
      if (activePlayer) {
        const updatedActive = next.find(p => p.id === activePlayer.id);
        if (updatedActive) setActivePlayer(updatedActive);
      }
      return next;
    });
  };

  const processTransaction = (
    playerId: string, 
    type: TransactionType, 
    amount: number, 
    description: string,
    otherPlayerId?: string
  ) => {
    updatePlayersState(prev => prev.map(p => {
      if (p.id === playerId) {
        const isDeduction = type.includes('PAY') || type === 'TRANSFER_OUT';
        const newBalance = isDeduction ? p.balance - amount : p.balance + amount;
        
        const trans: Transaction = {
          id: crypto.randomUUID(),
          type,
          amount,
          date: Date.now(),
          description,
          targetPlayerName: otherPlayerId ? prev.find(x => x.id === otherPlayerId)?.name : undefined
        };

        return {
          ...p,
          balance: newBalance,
          history: [trans, ...p.history].slice(0, 50)
        };
      }
      return p;
    }));
    playSound('cash');
  };

  const handleQuickAction = (type: TransactionType, amount: number) => {
    if (!activePlayer || amount <= 0) return;
    if ((type.includes('PAY') || type === 'TRANSFER_OUT') && activePlayer.balance < amount) {
      notify("Saldo insuficiente!", "error");
      playSound('error');
      return;
    }
    if (confirm(`Confirmar ${TRANSACTION_LABELS[type]} de ${formatCurrency(amount)}?`)) {
      processTransaction(activePlayer.id, type, amount, TRANSACTION_LABELS[type]);
    }
  };

  const handleTransferInit = () => {
    const amount = Number(transAmount);
    if (amount <= 0) return notify("Valor inválido", "error");
    if (activePlayer && activePlayer.balance < amount) return notify("Saldo insuficiente", "error");
    
    setIsNfcScanning(true);
    notify("Aproxime o cartão do DESTINATÁRIO...", "info");

    nfcService.scan(
      (payload) => {
        setIsNfcScanning(false);
        const recipientId = payload.playerId;
        
        if (activePlayer && recipientId && recipientId !== activePlayer.id) {
          // Explicitly type transactions to avoid type widening issues
          // This fixes the error on line 169 by ensuring history array matches Player interface
          updatePlayersState(prev => {
            const recipient = prev.find(p => p.id === recipientId);
            if (!recipient) {
              notify("Destinatário não encontrado no banco local.", "error");
              return prev;
            }

            return prev.map(p => {
              if (p.id === activePlayer.id) {
                const transOut: Transaction = {
                  id: crypto.randomUUID(),
                  type: 'TRANSFER_OUT',
                  amount,
                  date: Date.now(),
                  description: 'Transferência enviada',
                  targetPlayerName: recipient.name
                };
                return {
                  ...p,
                  balance: p.balance - amount,
                  history: [transOut, ...p.history].slice(0, 50)
                };
              }
              if (p.id === recipientId) {
                const transIn: Transaction = {
                  id: crypto.randomUUID(),
                  type: 'TRANSFER_IN',
                  amount,
                  date: Date.now(),
                  description: 'Transferência recebida',
                  targetPlayerName: activePlayer.name
                };
                return {
                  ...p,
                  balance: p.balance + amount,
                  history: [transIn, ...p.history].slice(0, 50)
                };
              }
              return p;
            });
          });

          playSound('cash');
          notify(`Enviado ${formatCurrency(amount)} para ${payload.name}!`, "success");
          setTransAmount('');
          setView('player');
        } else {
          notify("Cartão inválido para transferência.", "error");
        }
      },
      (err) => {
        setIsNfcScanning(false);
        notify("Erro na leitura NFC.", "error");
      }
    );
  };

  const handleRegisterNew = async () => {
    if (!newName.trim()) return notify("Digite um nome!", "error");
    setIsNfcScanning(true);
    notify("Aproxime o cartão para gravar...", "info");

    try {
      const newId = crypto.randomUUID();
      const payload: NfcPayload = { playerId: newId, name: newName };
      await nfcService.write(payload);
      
      const newPlayer: Player = {
        id: newId,
        name: newName,
        balance: settings.initialBalance,
        nfcId: null,
        history: [{
          id: crypto.randomUUID(),
          type: 'RECEIVE_BANK' as TransactionType,
          amount: settings.initialBalance,
          date: Date.now(),
          description: 'Saldo Inicial'
        }]
      };

      updatePlayersState(prev => [...prev, newPlayer]);
      playSound('success');
      notify(`${newName} registrado!`, "success");
      setNewName('');
      setIsNfcScanning(false);
      setView('bank');
    } catch (e) {
      setIsNfcScanning(false);
      notify("Erro ao gravar NFC.", "error");
    }
  };

  const handleClearTag = async () => {
    setIsNfcScanning(true);
    notify("Aproxime o cartão para LIMPAR...", "info");
    try {
      await nfcService.clear();
      playSound('success');
      notify("Cartão formatado com sucesso!", "success");
    } catch (e) {
      notify("Erro ao formatar cartão.", "error");
    } finally {
      setIsNfcScanning(false);
    }
  };

  const handleExport = () => {
    const data = JSON.stringify(players);
    navigator.clipboard.writeText(data);
    alert("Dados do jogo copiados! Cole em outro dispositivo no menu Importar.");
  };

  const handleImport = () => {
    const data = prompt("Cole os dados do jogo aqui:");
    if (data) {
      try {
        const imported = JSON.parse(data);
        if (Array.isArray(imported)) {
          updatePlayersState(() => imported);
          notify("Dados importados!", "success");
        }
      } catch (e) {
        notify("Dados inválidos!", "error");
      }
    }
  };

  const resetGame = () => {
    if (confirm("Resetar saldos de todos os jogadores?")) {
      // Fix for Error in file App.tsx on line 297 by ensuring history array matches Player interface
      updatePlayersState(prev => prev.map(p => {
        const trans: Transaction = {
          id: crypto.randomUUID(),
          type: 'ADJUSTMENT',
          amount: settings.initialBalance,
          date: Date.now(),
          description: 'Reinício de Jogo'
        };
        return {
          ...p,
          balance: settings.initialBalance,
          history: [trans, ...p.history].slice(0, 10)
        };
      }));
      notify("Jogo resetado!", "success");
    }
  };

  const deleteAll = () => {
    if (confirm("Apagar todos os jogadores do banco?")) {
      storageService.clearAll();
      setPlayers([]);
      setView('home');
      notify("Banco de dados limpo.", "info");
    }
  };

  // Views
  const renderHome = () => (
    <div className="flex flex-col items-center justify-center min-h-[80vh] gap-8 p-6">
      <div className="text-center">
        <div className="w-24 h-24 bg-green-600 rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-xl">
          <span className="text-white text-5xl font-bold">₩</span>
        </div>
        <h1 className="text-3xl font-extrabold text-gray-800 tracking-tight">NFC Bank</h1>
        <p className="text-gray-500 mt-2">Aproxime seu cartão para entrar</p>
      </div>
      <div className="w-full max-w-xs flex flex-col gap-4">
        <Button fullWidth onClick={handleStartScan} className="h-20 text-lg">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" /></svg>
          Entrar com Cartão
        </Button>
        <Button fullWidth variant="outline" onClick={() => setView('bank')}>
          🏦 Acesso ao Banco
        </Button>
      </div>
    </div>
  );

  const renderPlayer = () => {
    if (!activePlayer) return null;
    return (
      <div className="p-6 pb-24 space-y-8 animate-in slide-in-from-right duration-300">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-black text-gray-800">{activePlayer.name}</h1>
          <Button variant="outline" onClick={() => setView('home')} className="px-4 py-2">Sair</Button>
        </div>

        <div className="bg-gradient-to-br from-green-600 to-emerald-700 p-8 rounded-3xl text-white shadow-2xl relative overflow-hidden">
          <p className="text-green-100 text-sm font-medium uppercase tracking-widest">Saldo Disponível</p>
          <h2 className="text-5xl font-bold mt-1">{formatCurrency(activePlayer.balance)}</h2>
          <div className="absolute top-[-20px] right-[-20px] text-[120px] opacity-10 font-black">₩</div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Button variant="success" onClick={() => handleQuickAction('RECEIVE_BANK', 200)} className="flex-col h-24">
            <span className="text-xs opacity-80 uppercase">Passou no Início</span>
            <span className="text-lg">+₩ 200</span>
          </Button>
          <Button variant="danger" onClick={() => handleQuickAction('PAY_RENT', 100)} className="flex-col h-24">
            <span className="text-xs opacity-80 uppercase">Pagar Aluguel</span>
            <span className="text-lg">₩ 100</span>
          </Button>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-gray-400 uppercase">Transferir ou Pagar</h3>
          <input 
            type="number" 
            placeholder="Valor (Ex: 500)" 
            className="w-full p-4 rounded-2xl border-2 border-gray-100 focus:border-green-500 outline-none text-xl font-bold"
            value={transAmount}
            onChange={e => setTransAmount(e.target.value ? Number(e.target.value) : '')}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button variant="danger" onClick={() => handleQuickAction('PAY_TAX', Number(transAmount))} disabled={!transAmount}>Pagar</Button>
            <Button variant="secondary" onClick={handleTransferInit} disabled={!transAmount}>Transferir</Button>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-bold text-gray-800">Histórico Recente</h3>
          <div className="space-y-3">
            {activePlayer.history.map(t => (
              <div key={t.id} className="flex justify-between items-center p-4 bg-white rounded-2xl border border-gray-100 shadow-sm">
                <div className="flex flex-col">
                  <span className="font-bold text-gray-800">{TRANSACTION_LABELS[t.type] || t.description}</span>
                  <span className="text-xs text-gray-400">{t.targetPlayerName ? `P/ ${t.targetPlayerName}` : new Date(t.date).toLocaleTimeString()}</span>
                </div>
                <span className={`font-black ${t.type.includes('PAY') || t.type === 'TRANSFER_OUT' ? 'text-red-500' : 'text-green-600'}`}>
                  {t.type.includes('PAY') || t.type === 'TRANSFER_OUT' ? '-' : '+'} {formatCurrency(t.amount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderBank = () => {
    if (!bankAuth) {
      return (
        <div className="p-6 flex flex-col items-center justify-center min-h-[60vh] gap-6">
          <h2 className="text-2xl font-bold">Painel de Controle</h2>
          <input 
            type="password" 
            placeholder="Senha Mestra"
            className="w-full max-w-xs p-4 rounded-xl border-2 border-gray-200 text-center text-2xl tracking-widest outline-none focus:border-blue-500"
            value={passwordInput}
            onChange={e => setPasswordInput(e.target.value)}
          />
          <Button fullWidth onClick={() => {
            if (passwordInput === settings.bankPassword) setBankAuth(true);
            else notify("Senha incorreta!", "error");
          }}>Acessar</Button>
          <Button variant="outline" onClick={() => setView('home')}>Voltar</Button>
        </div>
      );
    }

    return (
      <div className="p-6 space-y-8 animate-in fade-in duration-300">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-black">🏦 Banco</h1>
          <Button variant="outline" onClick={() => { setBankAuth(false); setView('home'); }}>Sair</Button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Button variant="secondary" onClick={() => setView('register')}>Novo Jogador</Button>
          <Button variant="outline" onClick={handleClearTag}>Limpar Cartão</Button>
        </div>

        <div className="space-y-4">
          <h2 className="text-xl font-bold text-gray-800">Jogadores no Banco ({players.length})</h2>
          <div className="space-y-3">
            {players.map(p => (
              <div key={p.id} className="p-4 bg-white rounded-2xl border border-gray-100 flex justify-between items-center shadow-sm">
                <div>
                  <p className="font-bold text-lg">{p.name}</p>
                  <p className="text-green-600 font-bold">{formatCurrency(p.balance)}</p>
                </div>
                <Button variant="outline" onClick={() => { setActivePlayer(p); setView('player'); }} className="px-4 py-2 text-sm">Painel</Button>
              </div>
            ))}
          </div>
        </div>

        <div className="p-6 bg-blue-50 rounded-3xl space-y-4">
          <h2 className="text-lg font-bold text-blue-800">Sincronização / Backup</h2>
          <p className="text-sm text-blue-600">Como os dados ficam no navegador, use estas opções para levar o jogo para outro celular:</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={handleExport} className="!border-blue-200 !text-blue-700 bg-white">Exportar</Button>
            <Button variant="outline" onClick={handleImport} className="!border-blue-200 !text-blue-700 bg-white">Importar</Button>
          </div>
        </div>

        <div className="pt-8 border-t space-y-4">
          <Button variant="outline" fullWidth onClick={resetGame}>Reiniciar Partida (Reset Saldo)</Button>
          <Button variant="danger" fullWidth onClick={deleteAll}>Deletar Todo o Banco</Button>
        </div>
      </div>
    );
  };

  const renderRegister = () => (
    <div className="p-6 space-y-8">
      <h1 className="text-3xl font-black text-gray-800">Novo Jogador</h1>
      <div className="space-y-6">
        <div className="space-y-2">
          <label className="text-sm font-bold text-gray-400 uppercase">Nome Completo</label>
          <input 
            type="text" 
            className="w-full p-5 rounded-2xl border-2 border-gray-100 outline-none focus:border-green-500 text-xl"
            placeholder="Nome do Jogador"
            value={newName}
            onChange={e => setNewName(e.target.value)}
          />
        </div>
        <div className="p-4 bg-green-50 rounded-2xl border border-green-100">
           <p className="text-green-700 text-sm">Saldo inicial configurado: <strong>{formatCurrency(settings.initialBalance)}</strong></p>
        </div>
        <Button fullWidth onClick={handleRegisterNew} loading={isNfcScanning} className="h-20 text-lg">Gravar Cartão NFC</Button>
        <Button variant="outline" fullWidth onClick={() => setView('bank')}>Voltar</Button>
      </div>
    </div>
  );

  return (
    <div className="max-w-md mx-auto min-h-screen bg-gray-50 relative">
      {statusMessage && (
        <div className={`fixed top-4 left-4 right-4 z-50 px-6 py-4 rounded-2xl shadow-2xl transition-all duration-300 animate-in slide-in-from-top-10
          ${statusMessage.type === 'error' ? 'bg-red-500 text-white' : 
            statusMessage.type === 'success' ? 'bg-green-600 text-white' : 'bg-blue-600 text-white'}`}>
          <p className="text-center font-bold">{statusMessage.text}</p>
        </div>
      )}

      {isNfcScanning && (
        <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-md flex flex-col items-center justify-center p-8 text-white text-center">
          <div className="w-40 h-40 border-8 border-white/10 rounded-full flex items-center justify-center mb-8 relative">
             <div className="absolute inset-0 border-8 border-green-400 rounded-full nfc-scan-animation"></div>
             <svg className="w-20 h-20 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
             </svg>
          </div>
          <h2 className="text-3xl font-black mb-4 tracking-tight">Aproxime o Cartão</h2>
          <p className="text-white/60 text-lg leading-relaxed">Mantenha o cartão encostado na parte de trás do celular.</p>
          <Button variant="outline" className="mt-12 !text-white !border-white/30" onClick={() => setIsNfcScanning(false)}>Cancelar</Button>
        </div>
      )}

      <main>
        {view === 'home' && renderHome()}
        {view === 'player' && renderPlayer()}
        {view === 'bank' && renderBank()}
        {view === 'register' && renderRegister()}
      </main>

      {view === 'home' && (
        <footer className="absolute bottom-8 w-full text-center px-6 opacity-40">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400">NFC Bank System 2.0</p>
        </footer>
      )}
    </div>
  );
};

export default App;
