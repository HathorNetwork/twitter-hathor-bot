/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import Twitter from 'twitter';
import config from './config';
import Wallet from './wallet';
import hathorLib from '@hathor/wallet-lib';


class Manager {
  constructor(config) {
    this.onWalletStateChange = this.onWalletStateChange.bind(this);
    this.onNewTx = this.onNewTx.bind(this);
    this.onNewTweet = this.onNewTweet.bind(this);

    this.wallet = new Wallet(config);
    this.wallet.on('state', this.onWalletStateChange);
    this.wallet.on('new-tx', this.onNewTx);

    this.twitter = new Twitter(config);
  }

  onWalletStateChange(state) {
    if (state === Wallet.CLOSED) {
      console.log('Wallet is disconnected.');

    } else if (state === Wallet.CONNECTING) {
      console.log('Wallet is connecting...');

    } else if (state === Wallet.SYNCING) {
      console.log('Wallet is connected and syncing...');

    } else if (state === Wallet.READY) {
      console.log('Wallet is ready!');
      console.log('Current address:', this.wallet.getCurrentAddress());
      // this.onNewTweet({text: 'Give me a beer! Wig1U2TXnHXdMmXVQGAXmaGU66Gg76NXuj @Hathor #Testnet #JustTesting'})

    } else {
      console.log('Wallet unknown state:', state);
    }
  }

  onNewTx(tx) {
    console.log('onNewTx', tx);
  }

  matchAddresses(text) {
    return text.match(/\bW[a-zA-Z0-9]{33}\b/g) || [];
  }

  matchHashtags(text) {
    return text.match(/\B#\w*[a-zA-Z]+\w*\b/g);
  }

  matchMentions(text) {
    return text.match(/\B@\w*[a-zA-Z]+\w*\b/g);
  }

  onNewTweet(tweet) {
    console.log(tweet.text);

    const addresses = this.matchAddresses(tweet.text);
    if (addresses.length !== 1) {
      console.log('No address found. Skipping tweet...');
      return;
    }

    // Exactly one address found.
    const address = addresses[0];
    const value = 1;
    const token = hathorLib.constants.HATHOR_TOKEN_CONFIG;
    this.wallet.sendTransaction(address, value, token);
  }

  start() {
    this.wallet.start();
    /*
    this.twitter.stream('statuses/filter', {track:'#Hathor, #IWantHTR'}, (stream) => {
      console.log('Twitter ready!');
      stream.on('data', this.onNewTweet);
      stream.on('error', (error) => {
        throw error;
      });
    });
    */
  }
}

const manager = new Manager(config);
manager.start();
