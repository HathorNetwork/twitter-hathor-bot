/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import hathorLib from '@hathor/wallet-lib';
import MemoryStore from './store';

import EventEmitter from 'events';

/**
 * This is a Wallet that is supposed to be simple to be used by a third-party app.
 *
 * This class handles all the details of syncing, including receiving the same transaction
 * multiple times from the server. It also keeps the balance of the tokens updated.
 *
 * It has the following states:
 * - CLOSED: When it is disconnected from the server.
 * - CONNECTING: When it is connecting to the server.
 * - SYNCING: When it has connected and is syncing the transaction history.
 * - READY: When it is ready to be used.
 *
 * You can subscribe for the following events:
 * - state: When the state of the Wallet changes.
 * - new-tx: When a new tx arrives.
 **/
class Wallet extends EventEmitter {
  constructor({ server, seed }) {
    super();

    this.state = this.CLOSED;

    this.onConnectionChange = this.onConnectionChange.bind(this);
    this.handleWebsocketMsg = this.handleWebsocketMsg.bind(this);

    this.server = server;
    this.seed = seed;

    this.passphrase = '';
    this.pinCode = '123';
    this.password = '123';
  }

  /**
   * Called when the connection to the websocket changes.
   * It is also called if the network is down.
   **/
  onConnectionChange(value) {
    console.log('Websocket connection:', value);
    if (value) {
      this.setState(Wallet.SYNCING);
      hathorLib.wallet.loadAddressHistory(0, hathorLib.constants.GAP_LIMIT).then(() => {
        this.setState(Wallet.READY);
      }); // TODO Catch exception.
    }
  }

  getCurrentAddress() {
    return hathorLib.wallet.getCurrentAddress();
  }

  /**
   * Called when a new message arrives from websocket.
   **/
  handleWebsocketMsg(wsData) {
    if (wsData.type === 'wallet:address_history') {
      // TODO we also have to update some wallet lib data? Lib should do it by itself
      const walletData = hathorLib.wallet.getWalletData();
      const historyTransactions = 'historyTransactions' in walletData ? walletData.historyTransactions : {};
      const allTokens = 'allTokens' in walletData ? walletData.allTokens : [];
      hathorLib.wallet.updateHistoryData(historyTransactions, allTokens, [wsData.history], null, walletData);

      const newWalletData = hathorLib.wallet.getWalletData();
      const { keys } = newWalletData;
      //this.props.newTx(wsData.history, keys);

      this.emit('new-tx', wsData.history);
    }
  }

  reloadData() {
    console.log('reloadData');
  }

  getAllBalances() {
  }

  setState(state) {
    this.state = state;
    this.emit('state', state);
  }

  onNewTx(tx, addresses) {
    const updatedHistoryMap = {};
    const updatedBalanceMap = {};
    const balances = this.getTxBalance(tx);

    // we now loop through all tokens present in the new tx to get the new history and balance
    for (const [tokenUid, tokenTxBalance] of Object.entries(balances)) {
      // we may not have this token yet, so state.tokensHistory[tokenUid] would return undefined
      const currentHistory = state.tokensHistory[tokenUid] || [];
      const newTokenHistory = addTxToSortedList(tokenUid, tx, tokenTxBalance, currentHistory);
      updatedHistoryMap[tokenUid] = newTokenHistory;
      // totalBalance should not be confused with tokenTxBalance. The latter is the balance of the new
      // tx, while the former is the total balance of the token, considering all tx history
      const totalBalance = getBalance(tokenUid);
      updatedBalanceMap[tokenUid] = totalBalance;
    }
    const newTokensHistory = Object.assign({}, state.tokensHistory, updatedHistoryMap);
    const newTokensBalance = Object.assign({}, state.tokensBalance, updatedBalanceMap);
  };

  /**
   * Send tokens to only one address.
   **/
  sendTransaction(address, value, token) {
    const isHathorToken = token.uid === hathorLib.constants.HATHOR_TOKEN_CONFIG.uid;
    const data = {
      tokens: isHathorToken ? [] : [token.uid],
      inputs: [],
      outputs: [{
        address, value, tokenData: token.uid,
      }],
    };

    const walletData = hathorLib.wallet.getWalletData();
    const historyTxs = 'historyTransactions' in walletData ? walletData.historyTransactions : {};
    const ret = hathorLib.wallet.prepareSendTokensData(data, token, true, historyTxs, [token]);

    if (!ret.success) {
      console.log('Error sending tx:', ret.message);
      return;
    }

    try {
      hathorLib.transaction.sendTransaction(ret.data, this.pinCode).then((response) => {
        console.log('sendTransaction', response);
      }, (error) => {
        console.log('sendTransaction error:', error);
      });
    } catch(e) {
      console.log('sendTransaction exception:', e);
    }
  }

  /**
   * Connect to the server and start emitting events.
   **/
  start() {
    const store = new MemoryStore();
    hathorLib.storage.setStore(store);
    hathorLib.storage.setItem('wallet:server', this.server);

    hathorLib.wallet.executeGenerateWallet(this.seed, this.passphrase, this.pinCode, this.password, false);

    this.setState(Wallet.CONNECTING);

    const promise = new Promise((resolve, reject) => {
      hathorLib.version.checkApiVersion().then((version) => {
        console.log('Server info:', version);
        hathorLib.WebSocketHandler.on('is_online', this.onConnectionChange);
        hathorLib.WebSocketHandler.on('reload_data', this.reloadData);
        hathorLib.WebSocketHandler.on('wallet', this.handleWebsocketMsg);
        hathorLib.WebSocketHandler.setup();
        resolve();
      }, (error) => {
        console.log('Version error:', error);
        this.setState(Wallet.CLOSED);
        reject(error);
      });
    });
    return promise;
  }

  /**
   * Close the connections and stop emitting events.
   **/
  stop() {
    hathorLib.WebSocketHandler.stop()
    hathorLib.WebSocketHandler.removeListener('is_online', this.onConnectionChange);
    hathorLib.WebSocketHandler.removeListener('reload_data', this.reloadData);
    hathorLib.WebSocketHandler.removeListener('wallet', this.handleWebsocketMsg);
    this.setState(Wallet.CLOSED);
  }

  /**
   * Returns the balance for each token in tx, if the input/output belongs to this wallet
   */
  getTxBalance(tx) {
    const myKeys = []; // TODO
    const balance = {};
    for (const txout of tx.outputs) {
      if (hathorLib.wallet.isAuthorityOutput(txout)) {
        continue;
      }
      if (txout.decoded && txout.decoded.address
          && txout.decoded.address in myKeys) {
        if (!balance[txout.token]) {
          balance[txout.token] = 0;
        }
        balance[txout.token] += txout.value;
      }
    }

    for (const txin of tx.inputs) {
      if (hathorLib.wallet.isAuthorityOutput(txin)) {
        continue;
      }
      if (txin.decoded && txin.decoded.address
          && txin.decoded.address in myKeys) {
        if (!balance[txin.token]) {
          balance[txin.token] = 0;
        }
        balance[txin.token] -= txin.value;
      }
    }

    return balance;
  }
}

Wallet.CLOSED =  0;
Wallet.CONNECTING = 1;
Wallet.SYNCING = 2;
Wallet.READY = 3;

export default Wallet;
